/**
 * resumable upload queue (tus-js-client). Module-level state
 * (not React state) so uploads keep running while the sheet is closed, the
 * user switches tabs, or the PIN gate reappears after a 401.
 *
 * Resume story:
 *  - Dropped connection mid-file: tus-js-client retries with backoff; we
 *    reflect that as "Waiting for connection" / "Retrying" on the row.
 *  - Reload, then re-pick the same file: tus-js-client's own fingerprint
 *    bookkeeping (localStorage, independent of this store) finds the
 *    previous upload and resumes from its offset.
 *  - 401 mid-upload (session expired): pause (abort without terminating),
 *    show the PIN gate; once the session is 'ready' again, resume the same
 *    in-memory Upload objects (no reload happened, so the File is still
 *    there — no re-pick needed).
 *  - Phones with Background Fetch (Android Chrome): bytes go through the
 *    browser's download manager instead ('background' rows, background.ts),
 *    so they survive the app being minimised or the tab reloaded. Anything
 *    it doesn't finish is resumed here with tus-js-client from the server's
 *    offset (the entry keeps its uploadUrl).
 */
import { create } from 'zustand';
import { DetailedError, Upload as TusUpload } from 'tus-js-client';
import {
  isAcceptedFile,
  LIMITS,
  UPLOAD_HEADERS,
  UPLOAD_METADATA_KEYS,
  type DayKey,
} from '@shared/api';
import { api, uploadsEndpoint, UNAUTHENTICATED_EVENT } from '@/lib/api';
import { useLibrary } from '@/state/library';
import { useSession } from '@/state/session';
import {
  backgroundUploadsEnabled,
  BG_MAX_BYTES,
  copyForBackground,
  createUpload,
  CreateError,
  disableBackgroundUploads,
  headUpload,
  patchRequest,
  serviceWorkerRegistration,
  uploadIdOf,
  type BgFetchRegistration,
} from './background';
import { releasePickedFiles } from './picker';

export type EntryStatus =
  | 'queued'
  | 'uploading'
  | 'waiting'
  | 'background'
  | 'done'
  | 'duplicate'
  | 'error'
  | 'unsupported'
  | 'needs-file';

export interface QueueEntry {
  clientId: string;
  name: string;
  size: number;
  lastModified: number;
  mime: string;
  status: EntryStatus;
  bytesSent: number;
  message: string | null;
  itemId: string | null;
  day: DayKey | null;
  duplicate: boolean;
  addedAt: number;
  /** tus upload URL once created: lets a later tus-js-client run resume it. */
  uploadUrl?: string | null;
  /** Background Fetch registration id while status is 'background'. */
  bgId?: string | null;
}

const STORAGE_KEY = 'faelles:uploadQueue';
const ACTIVE_STATUSES: EntryStatus[] = ['queued', 'uploading', 'waiting', 'background', 'needs-file'];

function loadPersisted(): QueueEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as QueueEntry[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e && ACTIVE_STATUSES.includes(e.status))
      // The browser holds the file of a 'background' row, so a reload loses
      // nothing there; reconcileBackground() picks it up again.
      .map((e) =>
        e.status === 'background'
          ? e
          : { ...e, status: 'needs-file' as const, bytesSent: 0, message: 'Reload lost the file. Tap to add it again.' },
      );
  } catch {
    return [];
  }
}

function persist(entries: QueueEntry[]) {
  try {
    const toSave = entries.filter((e) => ACTIVE_STATUSES.includes(e.status) || e.status === 'error');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    /* private mode / quota: pending count just won't survive reload */
  }
}

interface QueueState {
  entries: QueueEntry[];
  add(entry: QueueEntry): void;
  update(clientId: string, patch: Partial<QueueEntry>): void;
  remove(clientId: string): void;
  acknowledge(): void;
}

export const useUploadQueue = create<QueueState>((set, get) => ({
  entries: loadPersisted(),
  add(entry) {
    const entries = [...get().entries, entry];
    set({ entries });
    persist(entries);
  },
  update(clientId, patch) {
    const entries = get().entries.map((e) => (e.clientId === clientId ? { ...e, ...patch } : e));
    set({ entries });
    persist(entries);
  },
  remove(clientId) {
    const entries = get().entries.filter((e) => e.clientId !== clientId);
    set({ entries });
    persist(entries);
  },
  acknowledge() {
    const entries = get().entries.filter((e) => ACTIVE_STATUSES.includes(e.status));
    set({ entries });
    persist(entries);
  },
}));

export function useUploadEntries(): QueueEntry[] {
  return useUploadQueue((st) => st.entries);
}

export function usePendingUploadCount(): number {
  return useUploadQueue((st) => st.entries.filter((e) => ACTIVE_STATUSES.includes(e.status)).length);
}

export type UploadSheetStage = 'pick' | 'progress' | 'done';

/**
 * The sheet's stage, purely from the queue: 'pick' with no entries, 'progress'
 * while anything is still queued/uploading/waiting/background/needs-file, else 'done'.
 * Pulled out so it's testable without mounting the component.
 */
export function stageOf(entries: readonly QueueEntry[]): UploadSheetStage {
  if (!entries.length) return 'pick';
  const active = entries.some(
    (e) =>
      e.status === 'queued' ||
      e.status === 'uploading' ||
      e.status === 'waiting' ||
      e.status === 'background' ||
      e.status === 'needs-file',
  );
  return active ? 'progress' : 'done';
}

// ── runtime (module-level, outlives React unmounts) ──────────────────────

const liveUploads = new Map<string, TusUpload>();
const fileRefs = new Map<string, File>();
const pendingStart: string[] = [];
/** Entries that must go through tus-js-client even when Background Fetch is on. */
const forceTus = new Set<string>();
let activeCount = 0;
let wakeLock: { release(): Promise<void>; addEventListener(t: string, cb: () => void): void } | null = null;

function newClientId(): string {
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function updateWakeLock() {
  const shouldHold = activeCount > 0;
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<typeof wakeLock> } };
    if (shouldHold && !wakeLock && nav.wakeLock) {
      wakeLock = await nav.wakeLock.request('screen');
      wakeLock?.addEventListener('release', () => {
        wakeLock = null;
      });
    } else if (!shouldHold && wakeLock) {
      const w = wakeLock;
      wakeLock = null;
      await w.release();
    }
  } catch {
    /* not supported, or denied (e.g. low battery) — fine, best-effort only */
  }
}

function pump() {
  if (backgroundUploadsEnabled()) {
    const entries = useUploadQueue.getState().entries;
    const batch = pendingStart.filter(
      (id) =>
        !forceTus.has(id) &&
        (fileRefs.get(id)?.size ?? Infinity) <= BG_MAX_BYTES &&
        !entries.find((e) => e.clientId === id)?.uploadUrl,
    );
    if (batch.length) {
      for (const id of batch) pendingStart.splice(pendingStart.indexOf(id), 1);
      void startBackgroundBatch(batch);
    }
  }
  while (activeCount < LIMITS.uploadConcurrency && pendingStart.length > 0) {
    const clientId = pendingStart.shift()!;
    const file = fileRefs.get(clientId);
    if (!file) continue;
    forceTus.delete(clientId);
    const entry = useUploadQueue.getState().entries.find((e) => e.clientId === clientId);
    startTusUpload(clientId, file, entry?.uploadUrl ?? null);
  }
  const live = new Set(fileRefs.values());
  releasePickedFiles((f) => live.has(f));
  void updateWakeLock();
}

function finalizeSuccess(clientId: string, itemId: string, duplicate: boolean) {
  const entry = useUploadQueue.getState().entries.find((e) => e.clientId === clientId);
  useUploadQueue.getState().update(clientId, {
    status: duplicate ? 'duplicate' : 'done',
    itemId,
    duplicate,
    bytesSent: entry?.size ?? 0,
    message: duplicate ? 'Already in the album' : null,
  });
  const existing = useLibrary.getState().byId[itemId];
  if (existing) {
    useUploadQueue.getState().update(clientId, { day: existing.day });
    return;
  }
  let tries = 0;
  const t = window.setInterval(() => {
    tries++;
    const it = useLibrary.getState().byId[itemId];
    if (it) {
      useUploadQueue.getState().update(clientId, { day: it.day });
      window.clearInterval(t);
    } else if (tries > 20) {
      window.clearInterval(t);
    }
  }, 300);
}

async function pollUploadResult(clientId: string, uploadId: string | null) {
  if (!uploadId) {
    useUploadQueue.getState().update(clientId, {
      status: 'error',
      message: 'Uploaded, but we lost track of it here. Check the library.',
    });
    return;
  }
  for (let i = 0; i < 20; i++) {
    try {
      const r = await api.uploadResult(uploadId);
      if (r) {
        finalizeSuccess(clientId, r.item.id, r.duplicate);
        return;
      }
    } catch {
      /* keep trying */
    }
    await new Promise((res) => window.setTimeout(res, 500));
  }
  useUploadQueue.getState().update(clientId, {
    status: 'error',
    message: 'Uploaded, but we lost track of it here. Check the library.',
  });
}

/** No progress for this long on an 'uploading' row → abort and resume. */
const STALL_MS = 45_000;
const stopWatchdog = new Map<string, () => void>();

function isNoPersonError(error: Error): boolean {
  if (!(error instanceof DetailedError)) return false;
  try {
    return (JSON.parse(error.originalResponse?.getBody() ?? '') as { error?: string }).error === 'no_person';
  } catch {
    return false;
  }
}

function startTusUpload(clientId: string, file: File, uploadUrl: string | null = null) {
  activeCount++;
  useUploadQueue.getState().update(clientId, { status: 'uploading', message: null });

  let lastProgressAt = Date.now();
  // A request can stall without ever erroring (mobile browsers freeze
  // backgrounded tabs; proxies keep dead sockets open). If an 'uploading' row
  // makes no progress for STALL_MS, abort and start again: tus-js-client
  // re-reads the offset with HEAD and continues from there.
  const watchdog = window.setInterval(() => {
    const entry = useUploadQueue.getState().entries.find((e) => e.clientId === clientId);
    if (!entry || entry.status !== 'uploading') {
      lastProgressAt = Date.now();
      return;
    }
    if (Date.now() - lastProgressAt < STALL_MS) return;
    lastProgressAt = Date.now();
    useUploadQueue.getState().update(clientId, { status: 'waiting', message: 'Retrying…' });
    void upload.abort(false).then(() => upload.start());
  }, 5_000);
  stopWatchdog.set(clientId, () => window.clearInterval(watchdog));

  const upload: TusUpload = new TusUpload(file, {
    endpoint: uploadsEndpoint(),
    // Set when a background upload stopped part-way: resume that one.
    uploadUrl,
    chunkSize: LIMITS.uploadChunkBytes,
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000],
    removeFingerprintOnSuccess: true,
    metadata: {
      [UPLOAD_METADATA_KEYS.filename]: file.name,
      [UPLOAD_METADATA_KEYS.filetype]: file.type || '',
      [UPLOAD_METADATA_KEYS.lastModified]: String(file.lastModified),
    },
    onProgress(bytesSent) {
      lastProgressAt = Date.now();
      useUploadQueue.getState().update(clientId, { bytesSent, status: 'uploading', message: null });
    },
    onShouldRetry(error) {
      const status = error.originalResponse?.getStatus();
      // 409 on a PATCH is usually an offset mismatch after a stalled or
      // replayed request (phone slept, app switch) and 423 a held lock: both
      // heal on retry, which re-reads the offset with HEAD. Only our own
      // 'no_person' 409 is permanent.
      const recoverable =
        status === 429 || status === 423 || (status === 409 && !isNoPersonError(error));
      // Permanent, non-retryable outcomes: let onError handle them.
      if (status != null && !recoverable && status < 500) return false;
      useUploadQueue.getState().update(clientId, {
        status: 'waiting',
        message: navigator.onLine ? 'Retrying…' : 'Waiting for connection',
      });
      return true;
    },
    onError(error) {
      activeCount--;
      stopWatchdog.get(clientId)?.();
      stopWatchdog.delete(clientId);
      liveUploads.delete(clientId);
      fileRefs.delete(clientId);
      const status = error instanceof DetailedError ? error.originalResponse?.getStatus() : undefined;
      if (status === 401) {
        useUploadQueue.getState().update(clientId, {
          status: 'waiting',
          message: 'Signed out — resumes after you log in.',
        });
        window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
      } else if (status === 415) {
        useUploadQueue.getState().update(clientId, { status: 'unsupported', message: 'Not a supported photo or video.' });
      } else if (status === 413) {
        useUploadQueue.getState().update(clientId, { status: 'error', message: 'File is too large.' });
      } else if (status === 507) {
        useUploadQueue.getState().update(clientId, { status: 'error', message: 'Not enough space on the server.' });
      } else if (status === 409 && isNoPersonError(error)) {
        useUploadQueue.getState().update(clientId, { status: 'error', message: 'Choose who you are, then retry.' });
      } else {
        useUploadQueue.getState().update(clientId, { status: 'error', message: 'Upload failed. Tap to retry.' });
      }
      pump();
    },
    onSuccess(payload) {
      activeCount--;
      stopWatchdog.get(clientId)?.();
      stopWatchdog.delete(clientId);
      liveUploads.delete(clientId);
      const res = payload.lastResponse;
      const itemId = res.getHeader(UPLOAD_HEADERS.itemId) ?? null;
      const duplicate = res.getHeader(UPLOAD_HEADERS.duplicate) === '1';
      if (itemId) {
        finalizeSuccess(clientId, itemId, duplicate);
      } else {
        const id = upload.url ? upload.url.split('/').filter(Boolean).pop() ?? null : null;
        void pollUploadResult(clientId, id);
      }
      fileRefs.delete(clientId);
      pump();
    },
  });

  liveUploads.set(clientId, upload);
  if (uploadUrl) {
    upload.start();
    return;
  }
  upload
    .findPreviousUploads()
    .then((prev) => {
      if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]!);
      upload.start();
    })
    .catch(() => upload.start());
}

/** Add files (from the drop zone, file input, or page-level drop). */
export function enqueueFiles(list: FileList | File[]): void {
  const files = Array.from(list);
  if (!files.length) return;
  const state = useUploadQueue.getState();
  for (const file of files) {
    const match = state.entries.find(
      (e) => e.status === 'needs-file' && e.name === file.name && e.size === file.size && e.lastModified === file.lastModified,
    );
    if (match) {
      retryWithFile(match.clientId, file);
      continue;
    }
    const clientId = newClientId();
    const accepted = isAcceptedFile(file.name, file.type || '');
    state.add({
      clientId,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      mime: file.type || '',
      status: accepted ? 'queued' : 'unsupported',
      bytesSent: 0,
      message: accepted ? null : 'Not a supported photo or video.',
      itemId: null,
      day: null,
      duplicate: false,
      addedAt: Date.now(),
    });
    if (accepted) {
      fileRefs.set(clientId, file);
      pendingStart.push(clientId);
    }
  }
  pump();
}

/** Re-attach a File to a 'needs-file' row (reload + re-pick) or retry a failed one. */
export function retryWithFile(clientId: string, file: File): void {
  fileRefs.set(clientId, file);
  const prev = entryOf(clientId);
  const sameFile = prev && prev.name === file.name && prev.size === file.size && prev.lastModified === file.lastModified;
  useUploadQueue.getState().update(clientId, {
    ...(sameFile ? {} : { uploadUrl: null }),
    status: 'queued',
    message: null,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    mime: file.type || '',
  });
  pendingStart.push(clientId);
  pump();
}

export function dismissEntry(clientId: string): void {
  stopWatchdog.get(clientId)?.();
  stopWatchdog.delete(clientId);
  fileRefs.delete(clientId);
  liveUploads.delete(clientId);
  useUploadQueue.getState().remove(clientId);
}

export function acknowledgeFinished(): void {
  useUploadQueue.getState().acknowledge();
}

// ── background uploads (Background Fetch, see background.ts) ─────────────

const watchedBatches = new Set<string>();

function entryOf(clientId: string): QueueEntry | undefined {
  return useUploadQueue.getState().entries.find((e) => e.clientId === clientId);
}

/** Send to tus-js-client instead (Background Fetch refused, or it stopped part-way). */
function toTus(clientId: string, message: string | null = null) {
  forceTus.add(clientId);
  useUploadQueue.getState().update(clientId, { status: 'queued', bgId: null, message });
  pendingStart.push(clientId);
}

function createErrorPatch(status: number): Partial<QueueEntry> | null {
  if (status === 415) return { status: 'unsupported', message: 'Not a supported photo or video.' };
  if (status === 413) return { status: 'error', message: 'File is too large.' };
  if (status === 507) return { status: 'error', message: 'Not enough space on the server.' };
  if (status === 409) return { status: 'error', message: 'Choose who you are, then retry.' };
  return null;
}

async function startBackgroundBatch(ids: string[]) {
  for (const id of ids) useUploadQueue.getState().update(id, { status: 'uploading', message: 'Preparing…' });
  const reg = await serviceWorkerRegistration();
  if (!reg) {
    disableBackgroundUploads();
    ids.forEach((id) => toTus(id));
    pump();
    return;
  }

  const created: { id: string; url: string; file: File; body: Blob }[] = [];
  for (const id of ids) {
    const file = fileRefs.get(id);
    if (!file) continue;
    let body: Blob;
    try {
      body = await copyForBackground(file);
    } catch {
      toTus(id); // unreadable right now; tus-js-client reports it properly
      continue;
    }
    try {
      const url = await createUpload(file);
      created.push({ id, url, file, body });
      useUploadQueue.getState().update(id, { uploadUrl: url });
    } catch (e) {
      const patch = e instanceof CreateError ? createErrorPatch(e.status) : null;
      if (patch) {
        fileRefs.delete(id);
        useUploadQueue.getState().update(id, patch);
      } else {
        // offline, 401, 5xx…: tus-js-client already knows how to wait and retry
        toTus(id);
      }
    }
  }
  if (!created.length) {
    pump();
    return;
  }

  const bgId = `faelles-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const total = created.reduce((a, c) => a + c.file.size, 0);
  let bg: BgFetchRegistration;
  try {
    bg = await reg.backgroundFetch.fetch(
      bgId,
      created.map((c) => patchRequest(c.url, c.body)),
      { title: created.length === 1 ? `Uploading ${created[0]!.file.name}` : `Uploading ${created.length} files to Øresund`, uploadTotal: total },
    );
  } catch {
    // Unsupported request, no permission, not enough quota…: stay in the page.
    disableBackgroundUploads();
    created.forEach((c) => toTus(c.id));
    pump();
    return;
  }
  for (const c of created) {
    useUploadQueue.getState().update(c.id, { status: 'background', bgId, message: null, bytesSent: 0 });
  }
  watchBatch(bg);
  pump();
}

/**
 * While the page is on screen, a batch that sends nothing for this long is
 * taken back from the browser (it may be holding it for Wi-Fi, or not
 * running it at all) and uploaded from the page instead.
 */
const BG_STALL_MS = 30_000;
/** Batches we aborted ourselves (stalled), as opposed to the user from the notification. */
const selfAborted = new Set<string>();

function watchBatch(bg: BgFetchRegistration) {
  if (watchedBatches.has(bg.id)) return;
  watchedBatches.add(bg.id);
  let lastUploaded = -1;
  let lastChangeAt = Date.now();
  const stallTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') {
      lastChangeAt = Date.now(); // only count time the user is watching
      return;
    }
    if (bg.result || Date.now() - lastChangeAt < BG_STALL_MS) return;
    window.clearInterval(stallTimer);
    selfAborted.add(bg.id);
    disableBackgroundUploads(); // don't make the next pick wait out a stall too
    void bg.abort().catch(() => false).then(() => reconcileBackground());
  }, 5_000);
  const onProgress = () => {
    if (bg.uploaded !== lastUploaded) {
      lastUploaded = bg.uploaded;
      lastChangeAt = Date.now();
    }
    const frac = bg.uploadTotal ? Math.min(1, bg.uploaded / bg.uploadTotal) : 0;
    for (const e of useUploadQueue.getState().entries) {
      if (e.bgId === bg.id && e.status === 'background') {
        useUploadQueue.getState().update(e.clientId, { bytesSent: Math.round(e.size * frac) });
      }
    }
    if (bg.result) {
      window.clearInterval(stallTimer);
      bg.removeEventListener('progress', onProgress);
      watchedBatches.delete(bg.id);
      void reconcileBackground(bg.failureReason === 'aborted' ? bg.id : null);
    }
  };
  bg.addEventListener('progress', onProgress);
  onProgress();
}

/** Batches the user cancelled from the notification: their unfinished rows stay stopped. */
const abortedBatches = new Set<string>();

let reconciling: Promise<void> | null = null;

/**
 * Brings 'background' rows up to date with the browser and the server: still
 * running → keep watching; finished → done; stopped part-way → resume with
 * tus-js-client if the file is still here, else ask for it again.
 */
export function reconcileBackground(abortedId: string | null = null): Promise<void> {
  if (abortedId && !selfAborted.has(abortedId)) abortedBatches.add(abortedId);
  const run = async () => {
    const rows = useUploadQueue.getState().entries.filter((e) => e.status === 'background');
    if (!rows.length) return;
    const reg = await serviceWorkerRegistration();
    const running = new Map<string, BgFetchRegistration | undefined>();
    for (const e of rows) {
      const clientId = e.clientId;
      if (e.bgId && reg) {
        if (!running.has(e.bgId)) running.set(e.bgId, await reg.backgroundFetch.get(e.bgId).catch(() => undefined));
        const bg = running.get(e.bgId);
        if (bg && !bg.result && !selfAborted.has(e.bgId)) {
          watchBatch(bg);
          continue;
        }
      }
      await settleBackgroundRow(clientId, e.uploadUrl ?? null, !!e.bgId && abortedBatches.has(e.bgId));
    }
    pump();
  };
  // one pass at a time; a request arriving mid-pass runs once more after it
  const next = (reconciling ?? Promise.resolve()).then(run, run);
  reconciling = next.finally(() => {
    if (reconciling === next) reconciling = null;
  });
  return next;
}

async function settleBackgroundRow(clientId: string, uploadUrl: string | null, aborted: boolean) {
  const uploadId = uploadUrl ? uploadIdOf(uploadUrl) : null;
  if (uploadId) {
    try {
      const r = await api.uploadResult(uploadId);
      if (r) {
        fileRefs.delete(clientId);
        finalizeSuccess(clientId, r.item.id, r.duplicate);
        return;
      }
    } catch {
      /* 404: tus lost it (purged); fall through */
    }
    try {
      const head = await headUpload(uploadUrl!);
      if (head && head.length >= 0 && head.offset >= head.length) {
        // all bytes arrived, the server is still sorting it
        fileRefs.delete(clientId);
        void pollUploadResult(clientId, uploadId);
        return;
      }
      if (!head) useUploadQueue.getState().update(clientId, { uploadUrl: null });
    } catch {
      // offline or signed out right now: leave the row, the next reconcile retries
      return;
    }
  }
  if (aborted) {
    useUploadQueue.getState().update(clientId, { status: 'error', bgId: null, message: 'Upload cancelled. Tap to retry.' });
    return;
  }
  if (fileRefs.has(clientId)) {
    toTus(clientId, 'Continuing here…');
  } else {
    useUploadQueue.getState().update(clientId, {
      status: 'needs-file',
      bgId: null,
      bytesSent: 0,
      message: 'The upload stopped. Tap to add the file again.',
    });
  }
}

// ── auth pause/resume: 401 mid-queue → PIN gate → resume after login ─────

let wasReady = useSession.getState().status === 'ready';
useSession.subscribe((state) => {
  const nowReady = state.status === 'ready';
  if (wasReady && !nowReady) {
    for (const [clientId, up] of liveUploads) {
      void up.abort(false);
      useUploadQueue.getState().update(clientId, { status: 'waiting', message: 'Signed out — resumes after you log in.' });
    }
  }
  // also covers the first load: rows the browser kept uploading after a reload
  if (!wasReady && nowReady) void reconcileBackground();
  if (!wasReady && nowReady && liveUploads.size > 0) {
    for (const [clientId, up] of liveUploads) {
      useUploadQueue.getState().update(clientId, { status: 'uploading', message: null });
      up.start();
    }
  }
  wasReady = nowReady;
});

// ── page lifecycle guards ─────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    const active = useUploadQueue.getState().entries.some((en) => en.status === 'uploading' || en.status === 'queued' || en.status === 'waiting');
    if (active) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && useSession.getState().status === 'ready') void reconcileBackground();
  });
  if (backgroundUploadsEnabled()) {
    // registers the worker early, so the first upload doesn't wait for it
    void serviceWorkerRegistration();
    navigator.serviceWorker.addEventListener('message', (ev: MessageEvent) => {
      const data = ev.data as { type?: string; id?: string; failureReason?: string } | null;
      if (data?.type === 'faelles:bgfetch') {
        void reconcileBackground(data.failureReason === 'aborted' ? (data.id ?? null) : null);
      }
    });
  }
  window.addEventListener('online', () => {
    for (const en of useUploadQueue.getState().entries) {
      if (en.status === 'waiting') useUploadQueue.getState().update(en.clientId, { message: 'Reconnecting…' });
    }
  });
}

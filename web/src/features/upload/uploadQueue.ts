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

export type EntryStatus =
  | 'queued'
  | 'uploading'
  | 'waiting'
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
}

const STORAGE_KEY = 'faelles:uploadQueue';
const ACTIVE_STATUSES: EntryStatus[] = ['queued', 'uploading', 'waiting', 'needs-file'];

function loadPersisted(): QueueEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as QueueEntry[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e && ACTIVE_STATUSES.includes(e.status))
      .map((e) => ({ ...e, status: 'needs-file' as const, bytesSent: 0, message: 'Reload lost the file. Tap to add it again.' }));
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

// ── runtime (module-level, outlives React unmounts) ──────────────────────

const liveUploads = new Map<string, TusUpload>();
const fileRefs = new Map<string, File>();
const pendingStart: string[] = [];
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
  while (activeCount < LIMITS.uploadConcurrency && pendingStart.length > 0) {
    const clientId = pendingStart.shift()!;
    const file = fileRefs.get(clientId);
    if (!file) continue;
    startTusUpload(clientId, file);
  }
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

function startTusUpload(clientId: string, file: File) {
  activeCount++;
  useUploadQueue.getState().update(clientId, { status: 'uploading', message: null });

  const upload: TusUpload = new TusUpload(file, {
    endpoint: uploadsEndpoint(),
    chunkSize: LIMITS.uploadChunkBytes,
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000],
    removeFingerprintOnSuccess: true,
    metadata: {
      [UPLOAD_METADATA_KEYS.filename]: file.name,
      [UPLOAD_METADATA_KEYS.filetype]: file.type || '',
      [UPLOAD_METADATA_KEYS.lastModified]: String(file.lastModified),
    },
    onProgress(bytesSent) {
      useUploadQueue.getState().update(clientId, { bytesSent, status: 'uploading', message: null });
    },
    onShouldRetry(error) {
      const status = error.originalResponse?.getStatus();
      // Permanent, non-retryable outcomes: let onError handle them.
      if (status != null && status !== 429 && status < 500) return false;
      useUploadQueue.getState().update(clientId, {
        status: 'waiting',
        message: navigator.onLine ? 'Retrying…' : 'Waiting for connection',
      });
      return true;
    },
    onError(error) {
      activeCount--;
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
      } else if (status === 409) {
        useUploadQueue.getState().update(clientId, { status: 'error', message: 'Choose who you are, then retry.' });
      } else {
        useUploadQueue.getState().update(clientId, { status: 'error', message: 'Upload failed. Tap to retry.' });
      }
      pump();
    },
    onSuccess(payload) {
      activeCount--;
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
  useUploadQueue.getState().update(clientId, {
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
  fileRefs.delete(clientId);
  liveUploads.delete(clientId);
  useUploadQueue.getState().remove(clientId);
}

export function acknowledgeFinished(): void {
  useUploadQueue.getState().acknowledge();
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
  } else if (!wasReady && nowReady && liveUploads.size > 0) {
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
  window.addEventListener('online', () => {
    for (const en of useUploadQueue.getState().entries) {
      if (en.status === 'waiting') useUploadQueue.getState().update(en.clientId, { message: 'Reconnecting…' });
    }
  });
}

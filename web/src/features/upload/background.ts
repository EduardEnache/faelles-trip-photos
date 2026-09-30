/**
 * uploads that keep going while the browser is in the background.
 *
 * Where the browser has Background Fetch (Chrome on Android), each file is
 * created as a tus upload from the page (a tiny POST, so errors like "wrong
 * person" or "disk full" still show up on its row), then its bytes are handed
 * to the browser's download manager as one PATCH (sent as POST +
 * X-HTTP-Method-Override, which the server maps back). The browser shows a
 * notification with progress and finishes even if the tab is minimised,
 * frozen or closed. If it fails part-way, the tus upload on the server keeps
 * the bytes it got, and the page resumes it with tus-js-client next time it
 * runs.
 *
 * Elsewhere (iOS Safari, desktop) nothing here is used and uploads go
 * through tus-js-client from the page as before.
 */
import { BASE, uploadsEndpoint } from '@/lib/api';
import { UPLOAD_METADATA_KEYS } from '@shared/api';

// ── Background Fetch typings (not in lib.dom yet) ─────────────────────────

export interface BgFetchRegistration extends EventTarget {
  readonly id: string;
  readonly uploadTotal: number;
  readonly uploaded: number;
  readonly result: '' | 'success' | 'failure';
  readonly failureReason: string;
  abort(): Promise<boolean>;
}

interface BgFetchManager {
  fetch(
    id: string,
    requests: Request[],
    options?: { title?: string; uploadTotal?: number },
  ): Promise<BgFetchRegistration>;
  get(id: string): Promise<BgFetchRegistration | undefined>;
}

type BgServiceWorkerRegistration = ServiceWorkerRegistration & { backgroundFetch: BgFetchManager };

// ── availability ──────────────────────────────────────────────────────────

const supported =
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  !!window.matchMedia?.('(pointer: coarse)').matches &&
  'serviceWorker' in navigator &&
  'BackgroundFetchManager' in window;

let disabled = false;
let regPromise: Promise<BgServiceWorkerRegistration | null> | null = null;

/** True while this browser should hand uploads to Background Fetch. */
export function backgroundUploadsEnabled(): boolean {
  return supported && !disabled;
}

/** Stop using Background Fetch for this page load (it refused a request). */
export function disableBackgroundUploads(): void {
  disabled = true;
}

export function serviceWorkerRegistration(): Promise<BgServiceWorkerRegistration | null> {
  if (!supported) return Promise.resolve(null);
  regPromise ??= navigator.serviceWorker
    .register(`${BASE}sw.js`, { scope: BASE })
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => ('backgroundFetch' in reg ? (reg as BgServiceWorkerRegistration) : null))
    .catch(() => null);
  return regPromise;
}

// ── tus over plain fetch ──────────────────────────────────────────────────

const TUS_VERSION = '1.0.0';

function b64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export class CreateError extends Error {
  constructor(readonly status: number) {
    super(`create failed: ${status}`);
  }
}

/** tus creation (no body). Resolves to the absolute upload URL. */
export async function createUpload(file: File): Promise<string> {
  const meta: [string, string][] = [
    [UPLOAD_METADATA_KEYS.filename, file.name],
    [UPLOAD_METADATA_KEYS.filetype, file.type || ''],
    [UPLOAD_METADATA_KEYS.lastModified, String(file.lastModified)],
  ];
  const endpoint = uploadsEndpoint();
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Tus-Resumable': TUS_VERSION,
        'Upload-Length': String(file.size),
        'Upload-Metadata': meta.map(([k, v]) => (v ? `${k} ${b64(v)}` : k)).join(','),
      },
    });
  } catch {
    throw new CreateError(0);
  }
  const location = res.headers.get('Location');
  if (res.status !== 201 || !location) throw new CreateError(res.status);
  return new URL(location, endpoint).toString();
}

/** Bigger files stay with the page's tus upload (the copy below lives in the browser's blob store). */
export const BG_MAX_BYTES = 1024 ** 3;
const COPY_CHUNK = 8 * 1024 ** 2;

/**
 * Chrome's Background Fetch sends an EMPTY body for a File that came from a
 * file input (it still reports success). A Blob built from the file's bytes
 * is sent correctly, so copy it, 8 MB at a time to keep page memory flat.
 */
export async function copyForBackground(file: File): Promise<Blob> {
  const parts: Blob[] = [];
  for (let offset = 0; offset < file.size; offset += COPY_CHUNK) {
    parts.push(new Blob([await file.slice(offset, offset + COPY_CHUNK).arrayBuffer()]));
  }
  return new Blob(parts);
}

/** The request the browser sends in the background: the whole file from offset 0. */
export function patchRequest(uploadUrl: string, body: Blob): Request {
  return new Request(uploadUrl, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Tus-Resumable': TUS_VERSION,
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
      'X-HTTP-Method-Override': 'PATCH',
    },
    body,
  });
}

/** Server-side progress of a tus upload; null once tus no longer knows it (finished or purged). */
export async function headUpload(uploadUrl: string): Promise<{ offset: number; length: number } | null> {
  const res = await fetch(uploadUrl, {
    method: 'HEAD',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Tus-Resumable': TUS_VERSION },
  });
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new Error(`HEAD ${res.status}`);
  return {
    offset: Number(res.headers.get('Upload-Offset') ?? 0),
    length: Number(res.headers.get('Upload-Length') ?? -1),
  };
}

export function uploadIdOf(uploadUrl: string): string | null {
  return uploadUrl.split('/').filter(Boolean).pop() ?? null;
}

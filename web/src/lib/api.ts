/**
 * Typed HTTP client for @shared/api. SCAFFOLD-OWNED.
 * All URLs are built from import.meta.env.BASE_URL ('/photos/') so the app
 * works whether the proxy strips the prefix or not.
 */
import {
  API_PATHS,
  type ApiError,
  type CaptionDTO,
  type DayKey,
  type ItemDTO,
  type LibraryDTO,
  type MediaVariant,
  type PersonId,
  type SessionDTO,
  type UploadResultDTO,
  type ZipRequest,
  type ZipTicketDTO,
} from '@shared/api';

export const BASE = import.meta.env.BASE_URL; // '/photos/'

/** Relative API path → same-origin path with the base prefix. */
export function url(path: string): string {
  return `${BASE}${path}`;
}

/** Absolute URL (needed for tus-js-client endpoint, Web Share, EventSource). */
export function absoluteUrl(path: string): string {
  return new URL(url(path), window.location.origin).toString();
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError;
  constructor(status: number, body: ApiError) {
    super(body.message || body.error);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }
  get code() {
    return this.body.error;
  }
}

/** Fired on any 401 'unauthenticated' so the session store can show the PIN gate. */
export const UNAUTHENTICATED_EVENT = 'faelles:unauthenticated';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url(path), {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiRequestError(0, { error: 'internal', message: 'No connection' });
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err: ApiError =
      json && typeof json === 'object' && 'error' in json
        ? (json as ApiError)
        : { error: res.status === 401 ? 'unauthenticated' : 'internal', message: text || res.statusText };
    if (res.status === 401 && err.error === 'unauthenticated') {
      window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    }
    throw new ApiRequestError(res.status, err);
  }
  return json as T;
}

export const api = {
  getSession: () => request<SessionDTO>('GET', API_PATHS.session),
  login: (pin: string) => request<SessionDTO>('POST', API_PATHS.session, { pin }),
  setPerson: (person: PersonId) => request<SessionDTO>('PUT', API_PATHS.sessionPerson, { person }),
  logout: () => request<void>('DELETE', API_PATHS.session),

  getLibrary: () => request<LibraryDTO>('GET', API_PATHS.library),
  getItem: (id: string) => request<ItemDTO>('GET', API_PATHS.item(id)),
  deleteItem: (id: string) => request<void>('DELETE', API_PATHS.item(id)),
  restoreItem: (id: string) => request<ItemDTO>('POST', API_PATHS.restore(id)),

  heart: (id: string, on: boolean) => request<ItemDTO>(on ? 'PUT' : 'DELETE', API_PATHS.heart(id)),
  highlight: (id: string, on: boolean) => request<ItemDTO>(on ? 'PUT' : 'DELETE', API_PATHS.highlight(id)),

  setCaption: (day: DayKey, text: string) =>
    request<CaptionDTO | { day: DayKey; text: null }>('PUT', API_PATHS.caption(day), { text }),

  /** Resolves null while the server is still finalising (202). */
  uploadResult: async (uploadId: string): Promise<UploadResultDTO | null> => {
    const r = await request<UploadResultDTO | { pending: true }>('GET', API_PATHS.uploadResult(uploadId));
    return r && 'item' in r ? r : null;
  },

  createZip: (req: ZipRequest) => request<ZipTicketDTO>('POST', API_PATHS.zip, req),
};

// ── URL builders for non-JSON routes ──────────────────────────────

export function mediaUrl(item: Pick<ItemDTO, 'id' | 'rev'>, variant: MediaVariant): string {
  return url(API_PATHS.media(item.id, variant, variant === 'original' ? {} : { rev: item.rev }));
}

/** Original with Content-Disposition: attachment and the original filename. */
export function originalDownloadUrl(item: Pick<ItemDTO, 'id'>): string {
  return url(API_PATHS.media(item.id, 'original', { download: true }));
}

export function zipDownloadUrl(token: string): string {
  return url(API_PATHS.zipDownload(token));
}

export function eventsUrl(): string {
  return url(API_PATHS.events);
}

/** tus endpoint (absolute, trailing slash). */
export function uploadsEndpoint(): string {
  return absoluteUrl(API_PATHS.uploads);
}

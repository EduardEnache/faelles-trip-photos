/**
 * fælles. — HTTP API contract (single source of truth).
 *
 * Three agents code against this blind. Do not change it without the
 * orchestrator. If something is missing, write it in notes/<pkg>.md.
 *
 * ── Paths ──────────────────────────────────────────────────────────────
 * All paths below are RELATIVE (no leading slash). The web client prefixes
 * them with import.meta.env.BASE_URL ('/photos/'). The server registers them
 * with a leading '/' and ALSO accepts them under '/photos/' (Tailscale Funnel
 * `--set-path=/photos` strips the prefix; local access keeps it). So both
 *   GET /photos/api/library   and   GET /api/library
 * hit the same handler.
 *
 * ── Auth ───────────────────────────────────────────────────────────────
 * Every /api/* route except `health` and `session` (GET/POST) requires the
 * signed httpOnly cookie `faelles_session` (Path=/, SameSite=Lax, 90 days).
 * Without it: 401 { error: 'unauthenticated' }.
 * Mutations that attribute to a person (upload, heart, highlight, caption,
 * delete) additionally require a person on the session: else 409 'no_person'.
 *
 * ── Errors ─────────────────────────────────────────────────────────────
 * Every non-2xx JSON response has the ApiError shape. Media/zip routes may
 * return plain-text errors with the same status codes.
 *
 * ── JSON conventions ───────────────────────────────────────────────────
 * Timestamps are ISO-8601 UTC strings ('2026-09-26T12:03:11.000Z').
 * Sizes are bytes (number). Durations are milliseconds. Absent = null (never
 * undefined) in DTOs.
 */
import type { DayKey, PersonId, TripDayKey } from './trip';

export type { DayKey, PersonId, TripDayKey };

// ═════════════════════════════ errors ═════════════════════════════

export type ErrorCode =
  | 'unauthenticated' // 401 no/invalid session cookie
  | 'wrong_pin' // 401 POST session with wrong PIN (attemptsLeft set)
  | 'locked' // 429 too many PIN attempts (retryAfterSec set); also global backoff
  | 'no_person' // 409 action needs a person on the session (PUT session/person first)
  | 'not_found' // 404
  | 'not_owner' // 403 delete/restore of someone else's upload
  | 'bad_request' // 400 validation failed
  | 'unsupported_type' // 415 upload of a non image/video file
  | 'too_large' // 413 upload bigger than LIMITS.maxUploadBytes
  | 'insufficient_storage' // 507 disk-free guard tripped
  | 'gone' // 410 zip token expired / item purged from trash
  | 'internal'; // 500

export interface ApiError {
  error: ErrorCode;
  /** Human-readable, safe to show as-is (sentence case, no trailing period needed). */
  message: string;
  /** For 'locked'. */
  retryAfterSec?: number;
  /** For 'wrong_pin': attempts left before this IP is locked. */
  attemptsLeft?: number;
}

// ═════════════════════════════ DTOs ═════════════════════════════

export type ItemKind = 'photo' | 'video';

/**
 * processing: original stored, derivatives not all done yet (see `media`).
 * ready:      all derivatives for this kind exist.
 * failed:     derivatives could not be made. Original is safe & downloadable.
 */
export type ItemStatus = 'processing' | 'ready' | 'failed';

/**
 * Where `takenAt` came from (shown in the viewer's EXIF line when not 'exif'):
 *  exif        EXIF/XMP date WITH offset (OffsetTimeOriginal, Keys:CreationDate+tz)  → exact
 *  exif-local  EXIF date WITHOUT offset, interpreted as Europe/Copenhagen wall time
 *  video-utc   QuickTime CreateDate (UTC by spec), no better tag available
 *  file        device file date (tus metadata lastModified) → UI says "date from file"
 *  upload      nothing usable; time the server received it → UI says "date unknown"
 */
export type DateSource = 'exif' | 'exif-local' | 'video-utc' | 'file' | 'upload';

export type MediaVariant = 'thumb' | 'display' | 'preview' | 'original';

export interface ItemMedia {
  /** webp, fits in 640×640, EXIF-rotated, sRGB. Videos: from the poster frame. */
  thumb: boolean;
  /** webp, fits in 2048×2048. Videos: poster frame. */
  display: boolean;
  /** Videos only: H.264/AAC mp4, long edge ≤1280, faststart, SDR. Always false for photos. */
  preview: boolean;
}

export interface ItemDTO {
  /** ULID (26 chars, sortable by upload time). */
  id: string;
  kind: ItemKind;
  status: ItemStatus;
  /** Only when status === 'failed'; short, human-readable. */
  error: string | null;
  media: ItemMedia;
  /** Bumped whenever derivatives change. Used as ?v= cache-buster in media URLs. */
  rev: number;

  uploader: PersonId;
  uploadedAt: string;

  /** Original file name as uploaded ('IMG_5120.HEIC'). Used for downloads. */
  fileName: string;
  /** Best-effort MIME ('image/heic', 'video/quicktime'). */
  mime: string;
  /** Size of the original in bytes. */
  bytes: number;

  /** Capture instant, ISO UTC. Always set (see dateSource for how trustworthy). */
  takenAt: string;
  dateSource: DateSource;
  /** Library section computed with shared/trip.ts dayOf(takenAt). */
  day: DayKey;

  /** Display dimensions (after EXIF rotation / video rotation). */
  width: number | null;
  height: number | null;
  /** Videos only. */
  durationMs: number | null;

  lat: number | null;
  lon: number | null;

  /** 'Apple iPhone 16 Pro' → normalised to 'iPhone 16 Pro' when Model starts with Make. */
  camera: string | null;
  /** '24mm' style string from FocalLengthIn35mmFormat (fallback FocalLength). */
  lens: string | null;
  fNumber: number | null;
  /** '1/250' or '2s'. */
  exposure: string | null;
  iso: number | null;

  /** Dominant colour '#8FA9B6' of the image (tile underlay while loading), null until thumb exists. */
  tone: string | null;

  /** People who hearted it (personal, coloured dots). */
  hearts: PersonId[];
  /** Shared highlight star. */
  highlighted: boolean;
  highlightedBy: PersonId | null;
}

export interface CaptionDTO {
  day: DayKey;
  /** 1..LIMITS.captionMaxChars chars, single line. */
  text: string;
  by: PersonId;
  updatedAt: string;
}

export interface AlbumDTO {
  /** 'Denmark 2026' (env ALBUM_TITLE overrides). */
  title: string;
  firstDay: TripDayKey;
  lastDay: TripDayKey;
  timeZone: string;
}

export interface SessionDTO {
  authenticated: boolean;
  /** Person chosen on this device ("Who's this?"). null until chosen. */
  person: PersonId | null;
  album: AlbumDTO;
}

export interface DiskDTO {
  freeBytes: number;
  totalBytes: number;
  /** free < LIMITS.lowSpaceBytes → UI shows a quiet warning in the upload sheet. */
  lowSpace: boolean;
  /** free < LIMITS.minFreeBytes → uploads are refused with 507. */
  uploadsBlocked: boolean;
}

export interface LibraryDTO {
  /** All non-deleted items, sorted by takenAt ASC then id ASC. */
  items: ItemDTO[];
  captions: CaptionDTO[];
  disk: DiskDTO;
  serverTime: string;
}

export interface UploadResultDTO {
  item: ItemDTO;
  /** True when the bytes were already in the album (same sha256); `item` is the existing one. */
  duplicate: boolean;
}

export interface ZipTicketDTO {
  token: string;
  /** 'denmark-2026-all.zip' | 'denmark-2026-selection-12.zip' */
  fileName: string;
  count: number;
  /** Exact byte size of the ZIP (sent as Content-Length). */
  bytes: number;
  expiresAt: string;
}

export interface HealthDTO {
  ok: true;
  version: string;
  /** Which media tools the server found at boot. */
  tools: { vips: boolean; heif: boolean; ffmpeg: boolean; exiftool: boolean };
}

// ═════════════════════════════ requests ═════════════════════════════

export interface LoginRequest {
  /** 4 digits as a string. */
  pin: string;
}
export interface SetPersonRequest {
  person: PersonId;
}
export interface CaptionRequest {
  /** Trimmed server-side. Empty string deletes the caption. Max LIMITS.captionMaxChars. */
  text: string;
}
export type ZipRequest = { ids: string[] } | { all: true };

// ═════════════════════════════ endpoints ═════════════════════════════

/**
 * Every endpoint. `res` is the 2xx JSON body (void = 204 No Content).
 * Status codes other than those listed are 500 'internal'.
 */
export interface Endpoints {
  /** Liveness + tool detection. No auth. */
  'GET api/health': { req: void; res: HealthDTO };

  /** Current device session. No auth required: returns authenticated:false instead of 401. */
  'GET api/session': { req: void; res: SessionDTO };
  /**
   * Log in with the PIN. Sets `faelles_session` (person carried over if the
   * cookie already had one). 200 SessionDTO | 400 bad_request | 401 wrong_pin
   * (attemptsLeft) | 429 locked (retryAfterSec, also sent as Retry-After header).
   */
  'POST api/session': { req: LoginRequest; res: SessionDTO };
  /** Choose/change "who's this" for this device. Re-issues the cookie. 200 | 400 | 401. */
  'PUT api/session/person': { req: SetPersonRequest; res: SessionDTO };
  /** Forget this device (clears cookie). 204. */
  'DELETE api/session': { req: void; res: void };

  /** Everything the client needs to render. 200 | 401. */
  'GET api/library': { req: void; res: LibraryDTO };

  /** One item (also returns items in trash to their owner for undo). 200 | 404. */
  'GET api/items/:id': { req: void; res: ItemDTO };
  /**
   * Remove own upload: moves original + derivatives to storage/trash (kept
   * LIMITS.trashDays). Broadcasts item.deleted. 204 | 403 not_owner | 404 | 409 no_person.
   */
  'DELETE api/items/:id': { req: void; res: void };
  /** Undo a delete (own item, still in trash). Broadcasts item.added. 200 | 403 | 404 | 410 gone. */
  'POST api/items/:id/restore': { req: void; res: ItemDTO };

  /** Heart as the session person (idempotent). Broadcasts item.updated. 200 | 404 | 409. */
  'PUT api/items/:id/heart': { req: void; res: ItemDTO };
  'DELETE api/items/:id/heart': { req: void; res: ItemDTO };
  /** Shared highlight star (idempotent). Broadcasts item.updated. 200 | 404 | 409. */
  'PUT api/items/:id/highlight': { req: void; res: ItemDTO };
  'DELETE api/items/:id/highlight': { req: void; res: ItemDTO };

  /** Set/clear the one-line caption of a section. Broadcasts caption.updated. 200 | 400 | 409. */
  'PUT api/days/:day/caption': { req: CaptionRequest; res: CaptionDTO | { day: DayKey; text: null } };

  /**
   * Result of a finished tus upload (for clients that missed the
   * Faelles-Item-Id header). 200 UploadResultDTO | 202 {pending:true} while
   * finalising | 404 unknown upload id.
   */
  'GET api/upload-results/:uploadId': { req: void; res: UploadResultDTO };

  /** Prepare a ZIP of originals. Token valid LIMITS.zipTicketMinutes. 200 | 400 | 404 (unknown id). */
  'POST api/zip': { req: ZipRequest; res: ZipTicketDTO };
}

/**
 * Non-JSON routes (browser-navigated or streamed):
 *
 * GET api/media/:id/:variant[?v=rev][&download=1]
 *   variant: MediaVariant. thumb/display → image/webp; preview → video/mp4;
 *   original → the stored bytes, byte-identical, with its mime.
 *   Range requests supported (required for iOS video). Derived variants:
 *   Cache-Control: private, max-age=31536000, immutable. original: private, max-age=3600.
 *   download=1 → Content-Disposition: attachment; filename="IMG_5120.HEIC"; filename*=UTF-8''…
 *   404 when the variant doesn't exist (yet).
 *
 * GET api/zip/:token
 *   application/zip, STORE (no compression), zip64 when needed, exact
 *   Content-Length, Content-Disposition attachment with ZipTicketDTO.fileName.
 *   Entries: '<zipFolderName(day)>/<fileName>' (dupes → 'IMG_1 (2).HEIC'),
 *   entry mtime = takenAt. 410 gone when expired.
 *
 * GET api/events   (Server-Sent Events, text/event-stream)
 *   One default-typed message per event: `data: <JSON ServerEvent>\n\n`.
 *   Comment ping `: ping` every 25 s. First message is always 'hello'.
 *   Client strategy: on every (re)open → GET api/library again, then apply events.
 *
 * tus 1.0.0 resumable uploads  (endpoint: API_PATHS.uploads, trailing slash!)
 *   POST   api/uploads/          create. Upload-Metadata keys (base64 per tus):
 *            filename (required), filetype, lastModified (ms since epoch, string)
 *          401 | 409 no_person | 413 too_large | 415 unsupported_type | 507 insufficient_storage
 *          Location header is RELATIVE (just the upload id) so it resolves
 *          against the endpoint URL and keeps the /photos prefix.
 *   HEAD   api/uploads/:uploadId  offset
 *   PATCH  api/uploads/:uploadId  bytes (Content-Type application/offset+octet-stream)
 *          The final PATCH response carries headers
 *            Faelles-Item-Id: <item id>
 *            Faelles-Duplicate: 1|0
 *          after the server has moved the file into originals, hashed it,
 *          inserted the item (status 'processing') and broadcast item.added.
 *   DELETE api/uploads/:uploadId  abort (tus termination extension)
 *   Incomplete uploads older than LIMITS.staleUploadHours are purged.
 */
export const API_PATHS = {
  health: 'api/health',
  session: 'api/session',
  sessionPerson: 'api/session/person',
  library: 'api/library',
  item: (id: string) => `api/items/${encodeURIComponent(id)}`,
  restore: (id: string) => `api/items/${encodeURIComponent(id)}/restore`,
  heart: (id: string) => `api/items/${encodeURIComponent(id)}/heart`,
  highlight: (id: string) => `api/items/${encodeURIComponent(id)}/highlight`,
  caption: (day: DayKey) => `api/days/${day}/caption`,
  uploadResult: (uploadId: string) => `api/upload-results/${encodeURIComponent(uploadId)}`,
  zip: 'api/zip',
  zipDownload: (token: string) => `api/zip/${encodeURIComponent(token)}`,
  events: 'api/events',
  /** tus endpoint. Keep the trailing slash. */
  uploads: 'api/uploads/',
  media: (id: string, variant: MediaVariant, opts: { rev?: number; download?: boolean } = {}) => {
    const q: string[] = [];
    if (opts.rev != null) q.push(`v=${opts.rev}`);
    if (opts.download) q.push('download=1');
    return `api/media/${encodeURIComponent(id)}/${variant}${q.length ? `?${q.join('&')}` : ''}`;
  },
} as const;

export const UPLOAD_HEADERS = {
  itemId: 'Faelles-Item-Id',
  duplicate: 'Faelles-Duplicate',
} as const;

export const UPLOAD_METADATA_KEYS = {
  filename: 'filename',
  filetype: 'filetype',
  lastModified: 'lastModified',
} as const;

export const SESSION_COOKIE = 'faelles_session';

// ═════════════════════════════ live events (SSE) ═════════════════════════════

export type ServerEvent =
  | { type: 'hello'; serverTime: string; version: string }
  /** New item (upload finalised, or restored from trash). Status usually 'processing'. */
  | { type: 'item.added'; item: ItemDTO }
  /** Any change: derivatives done, hearts, highlight, status. Full item, replace wholesale. */
  | { type: 'item.updated'; item: ItemDTO }
  | { type: 'item.deleted'; id: string; by: PersonId }
  | { type: 'caption.updated'; day: DayKey; caption: CaptionDTO | null }
  | { type: 'disk'; disk: DiskDTO };

// ═════════════════════════════ limits & policy ═════════════════════════════

export const LIMITS = {
  /** Largest single original accepted (10 GiB). */
  maxUploadBytes: 10 * 1024 ** 3,
  /** tus chunk size used by the web client. Small enough to lose little on a dropped connection. */
  uploadChunkBytes: 8 * 1024 ** 2,
  /** Parallel uploads per device. */
  uploadConcurrency: 3,
  /** Refuse uploads below this much free disk (plus the upload's own size). */
  minFreeBytes: 10 * 1024 ** 3,
  lowSpaceBytes: 40 * 1024 ** 3,
  captionMaxChars: 140,
  trashDays: 30,
  zipTicketMinutes: 30,
  staleUploadHours: 72,
  /** Web Share with files: above these the client offers a ZIP instead. */
  shareMaxFiles: 30,
  shareMaxBytes: 400 * 1e6,
  /** PIN throttling (server). */
  pinMaxFailuresPerIp: 5,
  pinIpWindowMinutes: 15,
  /** First lockout; doubles on each further lockout for the same IP, capped. */
  pinLockoutBaseSec: 60,
  pinLockoutMaxSec: 3600,
  /** Global backoff: this many failures across ALL IPs in the window locks PIN entry for everyone. */
  pinGlobalMaxFailures: 20,
  pinGlobalWindowMinutes: 60,
  pinGlobalLockoutSec: 900,
  sessionDays: 90,
} as const;

/** Extensions accepted even when the browser sends an empty/odd MIME (HEIC, DNG on Windows etc.). */
export const ACCEPTED_EXTENSIONS = [
  '.jpg', '.jpeg', '.heic', '.heif', '.hif', '.png', '.webp', '.avif', '.gif', '.tif', '.tiff',
  '.dng', '.arw', '.cr2', '.cr3', '.nef', '.raf', '.orf', '.rw2',
  '.mov', '.mp4', '.m4v', '.3gp', '.webm', '.avi', '.mts', '.m2ts',
] as const;

/** For the <input accept>. */
export const ACCEPT_ATTR = ['image/*', 'video/*', ...ACCEPTED_EXTENSIONS].join(',');

export const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.3gp', '.webm', '.avi', '.mts', '.m2ts'] as const;

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i).toLowerCase() : '';
}

export function isAcceptedFile(fileName: string, mime: string): boolean {
  if (mime.startsWith('image/') || mime.startsWith('video/')) return true;
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

export function kindOf(fileName: string, mime: string): ItemKind {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'photo';
  return (VIDEO_EXTENSIONS as readonly string[]).includes(extensionOf(fileName)) ? 'video' : 'photo';
}

/** Sort comparator used everywhere: takenAt ASC, then id ASC. */
export function compareItems(a: Pick<ItemDTO, 'takenAt' | 'id'>, b: Pick<ItemDTO, 'takenAt' | 'id'>): number {
  if (a.takenAt !== b.takenAt) return a.takenAt < b.takenAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

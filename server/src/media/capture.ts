/**
 * Pure metadata resolution from exiftool JSON tags (PLAN.md §1.5). No I/O,
 * no Node APIs beyond what shared/trip.ts already uses — fully unit
 * testable with fixture tag objects.
 */
import { zonedWallTimeToUtc } from '@shared/trip';
import type { DateSource, ItemKind } from '@shared/api';

export type ExifTags = Record<string, unknown>;

export interface CaptureOptions {
  kind: ItemKind;
  /** tus metadata lastModified, ms since epoch, or null if absent/unparseable. */
  lastModifiedMs: number | null;
  /** Server receive time, ms since epoch — always plausible, last-resort fallback. */
  receivedAtMs: number;
}

export interface CaptureResult {
  takenAt: string; // ISO UTC
  dateSource: DateSource;
}

const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);
const FUTURE_SLACK_MS = 2 * 24 * 3600_000;

function plausible(ms: number, nowMs: number): boolean {
  return Number.isFinite(ms) && ms >= MIN_PLAUSIBLE_MS && ms <= nowMs + FUTURE_SLACK_MS;
}

function str(tags: ExifTags, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = tags[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function num(tags: ExifTags, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = tags[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

interface ParsedDateTime {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  /** Offset from UTC in minutes, or null when the string carried no zone. */
  offsetMin: number | null;
}

/**
 * Parses both exiftool's native "YYYY:MM:DD HH:MM:SS[+HH:MM]" and ISO
 * "YYYY-MM-DDTHH:MM:SS[+HH:MM]" (as XMP dates come out). Rejects the
 * all-zero sentinel some cameras/QuickTime atoms write.
 */
export function parseExifDateTime(raw: string): ParsedDateTime | null {
  const m = raw.match(
    /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?/,
  );
  if (!m) return null;
  const [, ys, mos, ds, hs, mis, ss, tz] = m;
  const y = Number(ys);
  const mo = Number(mos);
  const d = Number(ds);
  const h = Number(hs);
  const mi = Number(mis);
  const s = Number(ss);
  if (y === 0 && mo === 0 && d === 0) return null; // "0000:00:00 00:00:00" sentinel
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let offsetMin: number | null = null;
  if (tz) {
    if (tz === 'Z') offsetMin = 0;
    else {
      const tm = tz.match(/^([+-])(\d{2}):?(\d{2})$/);
      if (tm) {
        const sign = tm[1] === '-' ? -1 : 1;
        offsetMin = sign * (Number(tm[2]) * 60 + Number(tm[3]));
      }
    }
  }
  return { y, mo, d, h, mi, s, offsetMin };
}

function toUtcMs(p: ParsedDateTime, assumeUtcIfNoZone: boolean): number | null {
  if (p.offsetMin != null) return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - p.offsetMin * 60_000;
  if (assumeUtcIfNoZone) return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return null;
}

function tryCandidate(
  tags: ExifTags,
  keys: string[],
  offsetKeys: string[] | null,
  requireZone: boolean,
  nowMs: number,
): { ms: number; hadZone: boolean } | null {
  const raw = str(tags, ...keys);
  if (!raw) return null;
  const parsed = parseExifDateTime(raw);
  if (!parsed) return null;
  let offsetMin = parsed.offsetMin;
  if (offsetMin == null && offsetKeys) {
    const offRaw = str(tags, ...offsetKeys);
    if (offRaw) {
      const tm = offRaw.match(/^([+-])(\d{2}):?(\d{2})$/);
      if (tm) offsetMin = (tm[1] === '-' ? -1 : 1) * (Number(tm[2]) * 60 + Number(tm[3]));
    }
  }
  if (requireZone && offsetMin == null) return null;
  const ms = offsetMin != null ? Date.UTC(parsed.y, parsed.mo - 1, parsed.d, parsed.h, parsed.mi, parsed.s) - offsetMin * 60_000 : null;
  if (ms == null || !plausible(ms, nowMs)) return null;
  return { ms, hadZone: offsetMin != null };
}

export function resolveCapture(tags: ExifTags, opts: CaptureOptions): CaptureResult {
  const nowMs = opts.receivedAtMs;

  if (opts.kind === 'photo') {
    // 1. ExifIFD:DateTimeOriginal + OffsetTimeOriginal/OffsetTime
    const r1 = tryCandidate(
      tags,
      ['ExifIFD:DateTimeOriginal', 'DateTimeOriginal'],
      ['ExifIFD:OffsetTimeOriginal', 'OffsetTimeOriginal', 'ExifIFD:OffsetTime', 'OffsetTime'],
      true,
      nowMs,
    );
    if (r1) return { takenAt: new Date(r1.ms).toISOString(), dateSource: 'exif' };

    // 2. XMP dates with a zone (XMP dates already carry it inline)
    const r2 = tryCandidate(
      tags,
      ['XMP-exif:DateTimeOriginal', 'XMP-photoshop:DateCreated'],
      null,
      true,
      nowMs,
    );
    if (r2) return { takenAt: new Date(r2.ms).toISOString(), dateSource: 'exif' };

    // 3. DateTimeOriginal / CreateDate / PNG:CreationTime without a zone → Copenhagen wall time
    const raw = str(
      tags,
      'ExifIFD:DateTimeOriginal',
      'DateTimeOriginal',
      'ExifIFD:CreateDate',
      'CreateDate',
      'PNG:CreationTime',
    );
    if (raw) {
      const p = parseExifDateTime(raw);
      if (p) {
        const ms = zonedWallTimeToUtc(p.y, p.mo, p.d, p.h, p.mi, p.s);
        if (plausible(ms, nowMs)) return { takenAt: new Date(ms).toISOString(), dateSource: 'exif-local' };
      }
    }
  } else {
    // video 1. Keys:CreationDate / ItemList:CreationDate / QuickTime:CreationDate WITH zone
    const r1 = tryCandidate(
      tags,
      ['Keys:CreationDate', 'ItemList:CreationDate', 'QuickTime:CreationDate'],
      null,
      true,
      nowMs,
    );
    if (r1) return { takenAt: new Date(r1.ms).toISOString(), dateSource: 'exif' };

    // video 2. QuickTime:CreateDate / MediaCreateDate — UTC per spec, unless the zero sentinel
    const r2 = tryCandidate(tags, ['QuickTime:CreateDate', 'QuickTime:MediaCreateDate', 'MediaCreateDate'], null, false, nowMs);
    if (r2) return { takenAt: new Date(r2.ms).toISOString(), dateSource: 'video-utc' };
  }

  // any: tus lastModified
  if (opts.lastModifiedMs != null && plausible(opts.lastModifiedMs, nowMs)) {
    return { takenAt: new Date(opts.lastModifiedMs).toISOString(), dateSource: 'file' };
  }

  // any: server receive time
  return { takenAt: new Date(nowMs).toISOString(), dateSource: 'upload' };
}

// ── GPS ──────────────────────────────────────────────────────────

export function resolveGps(tags: ExifTags): { lat: number | null; lon: number | null } {
  const lat = num(tags, 'Composite:GPSLatitude', 'GPSLatitude');
  const lon = num(tags, 'Composite:GPSLongitude', 'GPSLongitude');
  if (lat == null || lon == null) return { lat: null, lon: null };
  if (lat === 0 && lon === 0) return { lat: null, lon: null };
  return { lat, lon };
}

// ── camera / lens ────────────────────────────────────────────────

export function resolveCamera(tags: ExifTags, kind: ItemKind): string | null {
  if (kind === 'video') {
    const model = str(tags, 'Keys:Model', 'Model');
    return model;
  }
  const make = str(tags, 'IFD0:Make', 'Make');
  const model = str(tags, 'IFD0:Model', 'Model');
  if (!model) return null;
  if (make && model.toLowerCase().startsWith(make.toLowerCase())) {
    const stripped = model.slice(make.length).trim();
    return stripped || model;
  }
  return model;
}

function formatExposure(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds < 1) return `1/${Math.round(1 / seconds)}`;
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

export interface LensInfo {
  lens: string | null;
  fNumber: number | null;
  exposure: string | null;
  iso: number | null;
}

export function resolveLens(tags: ExifTags): LensInfo {
  const focal = num(
    tags,
    'ExifIFD:FocalLengthIn35mmFormat',
    'Composite:FocalLengthIn35mmFormat',
    'FocalLengthIn35mmFormat',
    'ExifIFD:FocalLength',
    'Composite:FocalLength',
    'FocalLength',
  );
  const fNumber = num(tags, 'ExifIFD:FNumber', 'Composite:FNumber', 'FNumber');
  const exposureSec = num(tags, 'ExifIFD:ExposureTime', 'ExposureTime');
  const iso = num(tags, 'ExifIFD:ISO', 'Composite:ISO', 'ISO');
  return {
    lens: focal != null ? `${Math.round(focal)}mm` : null,
    fNumber: fNumber != null ? fNumber : null,
    exposure: exposureSec != null ? formatExposure(exposureSec) || null : null,
    iso: iso != null ? Math.round(iso) : null,
  };
}

// ── dimensions (photos; videos use ffprobe) ─────────────────────

export function resolveDimensions(tags: ExifTags): { width: number | null; height: number | null } {
  let width = num(tags, 'Composite:ImageWidth', 'ExifIFD:ExifImageWidth', 'File:ImageWidth', 'ImageWidth');
  let height = num(tags, 'Composite:ImageHeight', 'ExifIFD:ExifImageHeight', 'File:ImageHeight', 'ImageHeight');
  const orientation = num(tags, 'IFD0:Orientation', 'Orientation');
  if (width != null && height != null && orientation != null && orientation >= 5 && orientation <= 8) {
    [width, height] = [height, width];
  }
  return { width, height };
}

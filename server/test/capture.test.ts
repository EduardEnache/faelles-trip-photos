import { describe, expect, it } from 'vitest';
import { parseExifDateTime, resolveCamera, resolveCapture, resolveDimensions, resolveGps, resolveLens } from '../src/media/capture';

const RECEIVED = Date.parse('2026-09-28T12:00:00Z');

describe('parseExifDateTime', () => {
  it('parses exiftool native format with an offset', () => {
    expect(parseExifDateTime('2026:09:26 14:03:11+02:00')).toEqual({
      y: 2026,
      mo: 9,
      d: 26,
      h: 14,
      mi: 3,
      s: 11,
      offsetMin: 120,
    });
  });
  it('parses ISO (XMP) format', () => {
    expect(parseExifDateTime('2026-09-26T14:03:11+02:00')?.offsetMin).toBe(120);
  });
  it('parses Z as UTC', () => {
    expect(parseExifDateTime('2026:09:26 14:03:11Z')?.offsetMin).toBe(0);
  });
  it('rejects the all-zero sentinel', () => {
    expect(parseExifDateTime('0000:00:00 00:00:00')).toBeNull();
  });
  it('negative offsets', () => {
    expect(parseExifDateTime('2026:09:26 14:03:11-05:00')?.offsetMin).toBe(-300);
  });
});

describe('resolveCapture — iPhone photos', () => {
  it('DateTimeOriginal + OffsetTimeOriginal → exact UTC, dateSource exif', () => {
    const r = resolveCapture(
      {
        'ExifIFD:DateTimeOriginal': '2026:09:26 14:03:11',
        'ExifIFD:OffsetTimeOriginal': '+02:00',
        'ExifIFD:SubSecTimeOriginal': '420', // ignored, must not break parsing
      },
      { kind: 'photo', lastModifiedMs: null, receivedAtMs: RECEIVED },
    );
    expect(r).toEqual({ takenAt: '2026-09-26T12:03:11.000Z', dateSource: 'exif' });
  });

  it('OffsetTime (not OffsetTimeOriginal) also works', () => {
    const r = resolveCapture(
      { 'ExifIFD:DateTimeOriginal': '2026:09:26 14:03:11', 'ExifIFD:OffsetTime': '+02:00' },
      { kind: 'photo', lastModifiedMs: null, receivedAtMs: RECEIVED },
    );
    expect(r.dateSource).toBe('exif');
    expect(r.takenAt).toBe('2026-09-26T12:03:11.000Z');
  });
});

describe('resolveCapture — Samsung photos', () => {
  it('recent One UI: OffsetTimeOriginal present → exact UTC', () => {
    const r = resolveCapture(
      { 'ExifIFD:DateTimeOriginal': '2026:09:27 10:15:00', 'ExifIFD:OffsetTimeOriginal': '+02:00' },
      { kind: 'photo', lastModifiedMs: null, receivedAtMs: RECEIVED },
    );
    expect(r).toEqual({ takenAt: '2026-09-27T08:15:00.000Z', dateSource: 'exif' });
  });

  it('older One UI: no OffsetTimeOriginal → Europe/Copenhagen wall-time fallback', () => {
    const r = resolveCapture(
      { 'ExifIFD:DateTimeOriginal': '2026:09:25 09:30:00' },
      { kind: 'photo', lastModifiedMs: null, receivedAtMs: RECEIVED },
    );
    // 09:30 Copenhagen time (CEST, UTC+2) on 25 Sept → 07:30 UTC
    expect(r).toEqual({ takenAt: '2026-09-25T07:30:00.000Z', dateSource: 'exif-local' });
  });
});

describe('resolveCapture — XMP dates with a zone', () => {
  it('XMP-exif:DateTimeOriginal', () => {
    const r = resolveCapture(
      { 'XMP-exif:DateTimeOriginal': '2026-09-26T14:03:11+02:00' },
      { kind: 'photo', lastModifiedMs: null, receivedAtMs: RECEIVED },
    );
    expect(r).toEqual({ takenAt: '2026-09-26T12:03:11.000Z', dateSource: 'exif' });
  });
});

describe('resolveCapture — PNG CreationTime fallback', () => {
  it('PNG:CreationTime without a zone → Copenhagen wall time', () => {
    const r = resolveCapture(
      { 'PNG:CreationTime': '2026:09:25 12:00:00' },
      { kind: 'photo', lastModifiedMs: null, receivedAtMs: RECEIVED },
    );
    expect(r.dateSource).toBe('exif-local');
  });
});

describe('resolveCapture — iPhone videos', () => {
  it('Keys:CreationDate (with offset) is preferred over a differing QuickTime:CreateDate (UTC)', () => {
    const r = resolveCapture(
      {
        'QuickTime:CreateDate': '2026:09:28 09:04:00', // would be video-utc if it were the only tag
        'Keys:CreationDate': '2026:09:28 11:04:00+02:00',
      },
      { kind: 'video', lastModifiedMs: null, receivedAtMs: RECEIVED },
    );
    expect(r).toEqual({ takenAt: '2026-09-28T09:04:00.000Z', dateSource: 'exif' });
  });

  it('ItemList:CreationDate also counts as the zoned Apple tag', () => {
    const r = resolveCapture(
      { 'ItemList:CreationDate': '2026:09:28 11:04:00+02:00' },
      { kind: 'video', lastModifiedMs: null, receivedAtMs: RECEIVED },
    );
    expect(r.dateSource).toBe('exif');
  });
});

describe('resolveCapture — Samsung videos', () => {
  it('only QuickTime:CreateDate (UTC per spec) → video-utc, taken literally as UTC', () => {
    const r = resolveCapture(
      { 'QuickTime:CreateDate': '2026:09:26 08:00:00' },
      { kind: 'video', lastModifiedMs: null, receivedAtMs: RECEIVED },
    );
    expect(r).toEqual({ takenAt: '2026-09-26T08:00:00.000Z', dateSource: 'video-utc' });
  });

  it('the 0000:00:00 sentinel is ignored, falls through to file/upload', () => {
    const r = resolveCapture(
      { 'QuickTime:CreateDate': '0000:00:00 00:00:00' },
      { kind: 'video', lastModifiedMs: Date.parse('2026-09-26T08:00:00Z'), receivedAtMs: RECEIVED },
    );
    expect(r.dateSource).toBe('file');
  });
});

describe('resolveCapture — fallbacks', () => {
  it('no exif at all → file (tus lastModified)', () => {
    const r = resolveCapture({}, { kind: 'photo', lastModifiedMs: Date.parse('2026-09-25T10:00:00Z'), receivedAtMs: RECEIVED });
    expect(r).toEqual({ takenAt: '2026-09-25T10:00:00.000Z', dateSource: 'file' });
  });
  it('nothing usable at all → upload (server receive time)', () => {
    const r = resolveCapture({}, { kind: 'photo', lastModifiedMs: null, receivedAtMs: RECEIVED });
    expect(r).toEqual({ takenAt: new Date(RECEIVED).toISOString(), dateSource: 'upload' });
  });
  it('implausible EXIF date (year 1980) falls through to file', () => {
    const r = resolveCapture(
      { 'ExifIFD:DateTimeOriginal': '1980:01:01 00:00:00', 'ExifIFD:OffsetTimeOriginal': '+02:00' },
      { kind: 'photo', lastModifiedMs: Date.parse('2026-09-25T10:00:00Z'), receivedAtMs: RECEIVED },
    );
    expect(r.dateSource).toBe('file');
  });
  it('implausible EXIF date (5 days in the future) falls through', () => {
    const future = new Date(RECEIVED + 5 * 24 * 3600_000);
    const raw = future.toISOString().replace(/-/g, ':').slice(0, 19).replace('T', ' ');
    const r = resolveCapture(
      { 'ExifIFD:DateTimeOriginal': raw, 'ExifIFD:OffsetTimeOriginal': '+00:00' },
      { kind: 'photo', lastModifiedMs: null, receivedAtMs: RECEIVED },
    );
    expect(r.dateSource).toBe('upload');
  });
});

describe('resolveGps', () => {
  it('reads Composite:GPSLatitude/Longitude', () => {
    expect(resolveGps({ 'Composite:GPSLatitude': 55.6798, 'Composite:GPSLongitude': 12.5911 })).toEqual({
      lat: 55.6798,
      lon: 12.5911,
    });
  });
  it('drops 0,0 as "no GPS"', () => {
    expect(resolveGps({ 'Composite:GPSLatitude': 0, 'Composite:GPSLongitude': 0 })).toEqual({ lat: null, lon: null });
  });
  it('missing → null', () => {
    expect(resolveGps({})).toEqual({ lat: null, lon: null });
  });
});

describe('resolveCamera', () => {
  it('strips a duplicated Make prefix (iPhone)', () => {
    expect(resolveCamera({ 'IFD0:Make': 'Apple', 'IFD0:Model': 'Apple iPhone 16 Pro' }, 'photo')).toBe('iPhone 16 Pro');
  });
  it('leaves Model alone when it does not start with Make (Samsung)', () => {
    expect(resolveCamera({ 'IFD0:Make': 'samsung', 'IFD0:Model': 'SM-S928B' }, 'photo')).toBe('SM-S928B');
  });
  it('videos read Keys:Model', () => {
    expect(resolveCamera({ 'Keys:Model': 'iPhone 16 Pro' }, 'video')).toBe('iPhone 16 Pro');
  });
});

describe('resolveLens', () => {
  it('formats focal length, exposure and ISO', () => {
    const r = resolveLens({
      'ExifIFD:FocalLengthIn35mmFormat': 24,
      'ExifIFD:FNumber': 1.8,
      'ExifIFD:ExposureTime': 1 / 250,
      'ExifIFD:ISO': 64,
    });
    expect(r).toEqual({ lens: '24mm', fNumber: 1.8, exposure: '1/250', iso: 64 });
  });
  it('exposures ≥1s render as "Ns"', () => {
    expect(resolveLens({ 'ExifIFD:ExposureTime': 2 }).exposure).toBe('2s');
  });
});

describe('resolveDimensions', () => {
  it('swaps width/height for Orientation 6 (portrait)', () => {
    expect(
      resolveDimensions({ 'Composite:ImageWidth': 640, 'Composite:ImageHeight': 480, 'IFD0:Orientation': 6 }),
    ).toEqual({ width: 480, height: 640 });
  });
  it('leaves dimensions alone for Orientation 1', () => {
    expect(
      resolveDimensions({ 'Composite:ImageWidth': 640, 'Composite:ImageHeight': 480, 'IFD0:Orientation': 1 }),
    ).toEqual({ width: 640, height: 480 });
  });
});

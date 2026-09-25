import { describe, expect, it } from 'vitest';
import { LIMITS, type ItemDTO } from '@shared/api';
import { saveMethodFor } from './save';

function item(bytes: number): ItemDTO {
  return {
    id: 'x',
    kind: 'photo',
    status: 'ready',
    error: null,
    media: { thumb: true, display: true, preview: false },
    rev: 1,
    uploader: 'alex',
    uploadedAt: '2026-09-25T10:00:00.000Z',
    fileName: 'a.jpg',
    mime: 'image/jpeg',
    bytes,
    takenAt: '2026-09-25T10:00:00.000Z',
    dateSource: 'exif',
    day: '2026-09-25',
    width: 100,
    height: 100,
    durationMs: null,
    lat: null,
    lon: null,
    camera: null,
    lens: null,
    fNumber: null,
    exposure: null,
    iso: null,
    tone: null,
    hearts: [],
    highlighted: false,
    highlightedBy: null,
  };
}

// jsdom/node has no navigator.canShare, so canShareFiles() always resolves to
// false here — every case below exercises the zip/single fallback branch,
// which is exactly what every non-Share-capable browser (most desktops, and
// mobile browsers without the Web Share Level 2 files support) sees too.
describe('saveMethodFor (no Web Share support)', () => {
  it('a single item downloads directly', () => {
    expect(saveMethodFor([item(1000)], false)).toBe('single');
    expect(saveMethodFor([item(1000)], true)).toBe('single');
  });

  it('multiple items become a zip', () => {
    expect(saveMethodFor([item(1000), item(2000)], false)).toBe('zip');
    expect(saveMethodFor([item(1000), item(2000)], true)).toBe('zip');
  });

  it('wide (desktop) never shares even under the share limits', () => {
    expect(saveMethodFor([item(1000)], true)).not.toBe('share');
  });

  it('over the share size/count limits would still not share (desktop has no share anyway)', () => {
    const many = Array.from({ length: LIMITS.shareMaxFiles + 1 }, () => item(10));
    expect(saveMethodFor(many, false)).toBe('zip');
  });
});

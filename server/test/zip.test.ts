import { describe, expect, it } from 'vitest';
import { uniqueEntryNames, zipFileName } from '../src/zip';

describe('uniqueEntryNames', () => {
  it('groups by day folder and dedupes same-name-in-same-folder', () => {
    const items = [
      { id: 'a', fileName: 'IMG_1.HEIC', day: '2026-09-26' as const, takenAt: '2026-09-26T10:00:00Z', storedPath: '/x/a' },
      { id: 'b', fileName: 'IMG_1.HEIC', day: '2026-09-26' as const, takenAt: '2026-09-26T11:00:00Z', storedPath: '/x/b' },
      { id: 'c', fileName: 'IMG_1.HEIC', day: '2026-09-27' as const, takenAt: '2026-09-27T09:00:00Z', storedPath: '/x/c' },
    ];
    const names = uniqueEntryNames(items);
    expect(names.get('a')).toBe('Day 2 - Sat 26 Sept/IMG_1.HEIC');
    expect(names.get('b')).toBe('Day 2 - Sat 26 Sept/IMG_1 (2).HEIC');
    // different day folder → no clash, no suffix
    expect(names.get('c')).toBe('Day 3 - Sun 27 Sept/IMG_1.HEIC');
  });

  it('before/after sections get their own folder names', () => {
    const items = [
      { id: 'a', fileName: 'x.jpg', day: 'before' as const, takenAt: '2026-09-24T10:00:00Z', storedPath: '/x/a' },
      { id: 'b', fileName: 'y.jpg', day: 'after' as const, takenAt: '2026-09-29T10:00:00Z', storedPath: '/x/b' },
    ];
    const names = uniqueEntryNames(items);
    expect(names.get('a')).toBe('0 Before the trip/x.jpg');
    expect(names.get('b')).toBe('5 After the trip/y.jpg');
  });

  it('handles triple duplicates', () => {
    const items = [
      { id: 'a', fileName: 'x.jpg', day: '2026-09-25' as const, takenAt: '2026-09-25T10:00:00Z', storedPath: '/x/a' },
      { id: 'b', fileName: 'x.jpg', day: '2026-09-25' as const, takenAt: '2026-09-25T10:01:00Z', storedPath: '/x/b' },
      { id: 'c', fileName: 'x.jpg', day: '2026-09-25' as const, takenAt: '2026-09-25T10:02:00Z', storedPath: '/x/c' },
    ];
    const names = uniqueEntryNames(items);
    expect([...names.values()]).toEqual([
      'Day 1 - Fri 25 Sept/x.jpg',
      'Day 1 - Fri 25 Sept/x (2).jpg',
      'Day 1 - Fri 25 Sept/x (3).jpg',
    ]);
  });
});

describe('zipFileName', () => {
  it('all vs selection naming', () => {
    expect(zipFileName(true, 42)).toBe('denmark-2026-all.zip');
    expect(zipFileName(false, 12)).toBe('denmark-2026-selection-12.zip');
  });
});

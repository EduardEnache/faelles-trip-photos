import { describe, expect, it } from 'vitest';
import type { ItemDTO } from '@shared/api';
import type { DayKey } from '@shared/trip';
import { dayRangeLabel, groupPlaces } from './placeGroups';

let seq = 0;
function item(overrides: Partial<ItemDTO> & { day: DayKey; takenAt: string }): ItemDTO {
  seq += 1;
  return {
    id: `it${seq.toString().padStart(3, '0')}`,
    kind: 'photo',
    status: 'ready',
    error: null,
    media: { thumb: true, display: true, preview: false },
    rev: 1,
    uploader: 'alex',
    uploadedAt: overrides.takenAt,
    fileName: `IMG_${seq}.HEIC`,
    mime: 'image/heic',
    bytes: 4_000_000,
    dateSource: 'exif',
    width: 4032,
    height: 3024,
    durationMs: null,
    lat: null,
    lon: null,
    camera: null,
    lens: null,
    fNumber: null,
    exposure: null,
    iso: null,
    tone: '#8FA9B6',
    hearts: [],
    highlighted: false,
    highlightedBy: null,
    ...overrides,
  };
}

const NYHAVN = { lat: 55.6798, lon: 12.5911 };
const TIVOLI = { lat: 55.6737, lon: 12.5681 };

describe('groupPlaces', () => {
  it('groups items with GPS near a known POI', () => {
    const items = [
      item({ day: '2026-09-25', takenAt: '2026-09-25T09:00:00.000Z', ...NYHAVN }),
      item({ day: '2026-09-25', takenAt: '2026-09-25T10:00:00.000Z', ...NYHAVN }),
      item({ day: '2026-09-26', takenAt: '2026-09-26T09:00:00.000Z', ...TIVOLI }),
    ];
    const groups = groupPlaces(items);
    expect(groups.map((g) => g.name)).toEqual(['Nyhavn', 'Tivoli']);
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[0]!.city).toBe('København');
    expect(groups[0]!.days).toEqual(['2026-09-25']);
  });

  it('groups points far from any POI under "Elsewhere in <city>"', () => {
    // Within København's city radius but not within any POI's radius.
    const items = [item({ day: '2026-09-25', takenAt: '2026-09-25T09:00:00.000Z', lat: 55.66, lon: 12.6 })];
    const groups = groupPlaces(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('elsewhere');
    expect(groups[0]!.name).toBe('Elsewhere in København');
  });

  it('groups points near no known city under "Other places", labelled by coordinates', () => {
    const items = [item({ day: '2026-09-27', takenAt: '2026-09-27T09:00:00.000Z', lat: 57.5, lon: 10.5 })];
    const groups = groupPlaces(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('other');
    expect(groups[0]!.name).toContain('N');
  });

  it('ignores items without GPS', () => {
    const items = [item({ day: '2026-09-25', takenAt: '2026-09-25T09:00:00.000Z' })];
    expect(groupPlaces(items)).toHaveLength(0);
  });

  it('orders groups: POIs, then Elsewhere, then Other', () => {
    const items = [
      item({ day: '2026-09-27', takenAt: '2026-09-27T09:00:00.000Z', lat: 57.5, lon: 10.5 }), // other
      item({ day: '2026-09-25', takenAt: '2026-09-25T09:00:00.000Z', lat: 55.66, lon: 12.6 }), // elsewhere
      item({ day: '2026-09-26', takenAt: '2026-09-26T09:00:00.000Z', ...TIVOLI }), // poi
    ];
    const groups = groupPlaces(items);
    expect(groups.map((g) => g.kind)).toEqual(['poi', 'elsewhere', 'other']);
  });
});

describe('dayRangeLabel', () => {
  it('formats a single trip day', () => {
    expect(dayRangeLabel(['2026-09-26'])).toBe('Day 2');
  });

  it('formats a span of trip days with an en dash', () => {
    expect(dayRangeLabel(['2026-09-25', '2026-09-26'])).toBe('Days 1–2');
  });
});

import { describe, expect, it } from 'vitest';
import type { ItemDTO } from '@shared/api';
import type { DayKey } from '@shared/trip';
import { memorySignature, pickFeatured, pickMemories } from './pickMemories';

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
    camera: 'iPhone 16 Pro',
    lens: '24mm',
    fNumber: 1.78,
    exposure: '1/250',
    iso: 64,
    tone: '#8FA9B6',
    hearts: [],
    highlighted: false,
    highlightedBy: null,
    ...overrides,
  };
}

// Real POI coordinates (shared/trip.ts) so cityOf()/nearestPoi() resolve.
const NYHAVN = { lat: 55.6798, lon: 12.5911 };
const TIVOLI = { lat: 55.6737, lon: 12.5681 };

function isoOnDay(day: '25' | '26' | '27' | '28', hour: number, min = 0): string {
  return `2026-09-${day}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`;
}

describe('pickMemories: trip', () => {
  it('does not exist below 8 items or below 2 days', () => {
    const items = Array.from({ length: 7 }, (_, i) => item({ day: '2026-09-25', takenAt: isoOnDay('25', 9, i) }));
    expect(pickMemories(items).find((m) => m.id === 'trip')).toBeUndefined();

    const oneDay = Array.from({ length: 10 }, (_, i) => item({ day: '2026-09-25', takenAt: isoOnDay('25', 9, i) }));
    expect(pickMemories(oneDay).find((m) => m.id === 'trip')).toBeUndefined();
  });

  it('exists across 2+ days with "so far" copy until all four days have items', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => item({ day: '2026-09-25', takenAt: isoOnDay('25', 9, i) })),
      ...Array.from({ length: 5 }, (_, i) => item({ day: '2026-09-26', takenAt: isoOnDay('26', 9, i) })),
    ];
    const trip = pickMemories(items).find((m) => m.id === 'trip');
    expect(trip).toBeDefined();
    expect(trip!.title).toBe('Denmark so far');
    expect(trip!.sub).toBe('Days 1–2 so far');
    expect(trip!.mood).toBe('kystlys');
  });

  it('says "Four days in Denmark" once every trip day has items', () => {
    const items = (['25', '26', '27', '28'] as const).flatMap((d) =>
      Array.from({ length: 3 }, (_, i) => item({ day: `2026-09-${d}` as DayKey, takenAt: isoOnDay(d, 9, i) })),
    );
    const trip = pickMemories(items).find((m) => m.id === 'trip')!;
    expect(trip.title).toBe('Four days in Denmark');
    expect(trip.sub).toBe('The whole trip');
  });

  it('caps at 18 slides, ordered chronologically', () => {
    const items = (['25', '26', '27', '28'] as const).flatMap((d) =>
      Array.from({ length: 10 }, (_, i) => item({ day: `2026-09-${d}` as DayKey, takenAt: isoOnDay(d, 8, i) })),
    );
    const trip = pickMemories(items).find((m) => m.id === 'trip')!;
    expect(trip.slides.length).toBeLessThanOrEqual(18);
    const times = trip.slides.map((s) => Date.parse(s.takenAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('prioritises hearted/highlighted items within a day\'s quota', () => {
    const plain = Array.from({ length: 20 }, (_, i) => item({ day: '2026-09-25', takenAt: isoOnDay('25', 8, i) }));
    const loved1 = item({ day: '2026-09-25', takenAt: isoOnDay('25', 20, 0), highlighted: true });
    const day2 = Array.from({ length: 5 }, (_, i) => item({ day: '2026-09-26', takenAt: isoOnDay('26', 9, i) }));
    const trip = pickMemories([...plain, loved1, ...day2]).find((m) => m.id === 'trip')!;
    expect(trip.slides.some((s) => s.id === loved1.id)).toBe(true);
  });
});

describe('pickMemories: loved', () => {
  it('does not exist below 5 scored items', () => {
    const items = Array.from({ length: 4 }, (_, i) => item({ day: '2026-09-25', takenAt: isoOnDay('25', 9, i), highlighted: true }));
    expect(pickMemories(items).find((m) => m.id === 'loved')).toBeUndefined();
  });

  it('exists at 5, capped at 12, sorted chronologically, mood Lys', () => {
    const scored = Array.from({ length: 20 }, (_, i) =>
      item({ day: '2026-09-25', takenAt: isoOnDay('25', 8, i), hearts: i % 2 === 0 ? ['alex'] : ['alex', 'sam'] }),
    );
    const loved = pickMemories(scored).find((m) => m.id === 'loved')!;
    expect(loved).toBeDefined();
    expect(loved.slides.length).toBe(12);
    expect(loved.mood).toBe('lys');
    const times = loved.slides.map((s) => Date.parse(s.takenAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('pickMemories: cities', () => {
  it('requires 2+ days and 10+ items near known places', () => {
    const day1 = Array.from({ length: 6 }, (_, i) => item({ day: '2026-09-25', takenAt: isoOnDay('25', 9, i), ...NYHAVN }));
    const day2 = Array.from({ length: 6 }, (_, i) => item({ day: '2026-09-26', takenAt: isoOnDay('26', 9, i), ...TIVOLI }));
    const cph = pickMemories([...day1, ...day2]).find((m) => m.id === 'city-kobenhavn');
    expect(cph).toBeDefined();
    expect(cph!.title).toBe('København');
    expect(cph!.mood).toBe('havnen');
    expect(cph!.slides.length).toBeLessThanOrEqual(14);
  });

  it('does not exist for a single day even with enough items', () => {
    const day1 = Array.from({ length: 12 }, (_, i) => item({ day: '2026-09-25', takenAt: isoOnDay('25', 9, i), ...NYHAVN }));
    expect(pickMemories(day1).find((m) => m.id === 'city-kobenhavn')).toBeUndefined();
  });
});

describe('pickMemories: days', () => {
  it('requires 6+ items that day', () => {
    const five = Array.from({ length: 5 }, (_, i) => item({ day: '2026-09-27', takenAt: isoOnDay('27', 9, i) }));
    expect(pickMemories(five).find((m) => m.id === 'day-2026-09-27')).toBeUndefined();
    const six = Array.from({ length: 6 }, (_, i) => item({ day: '2026-09-27', takenAt: isoOnDay('27', 9, i) }));
    expect(pickMemories(six).find((m) => m.id === 'day-2026-09-27')).toBeDefined();
  });

  it('names the day from GPS and orders days newest first', () => {
    const d3 = Array.from({ length: 6 }, (_, i) => item({ day: '2026-09-27', takenAt: isoOnDay('27', 9, i), lat: 55.969, lon: 12.5429 }));
    const d4 = Array.from({ length: 6 }, (_, i) => item({ day: '2026-09-28', takenAt: isoOnDay('28', 9, i) }));
    const mems = pickMemories([...d3, ...d4]);
    const day3 = mems.find((m) => m.id === 'day-2026-09-27')!;
    expect(day3.title).toContain('Humlebæk');
    const dayIds = mems.filter((m) => m.kind === 'day').map((m) => m.id);
    expect(dayIds).toEqual(['day-2026-09-28', 'day-2026-09-27']);
  });

  it('falls back to a plain "Day N" title with no GPS', () => {
    const six = Array.from({ length: 6 }, (_, i) => item({ day: '2026-09-28', takenAt: isoOnDay('28', 9, i) }));
    const day = pickMemories(six).find((m) => m.id === 'day-2026-09-28')!;
    expect(day.title).toBe('Day 4');
    expect(day.mood).toBe('kystlys');
  });
});

describe('pickFeatured', () => {
  it('prefers trip over day memories', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => item({ day: '2026-09-25', takenAt: isoOnDay('25', 9, i) })),
      ...Array.from({ length: 6 }, (_, i) => item({ day: '2026-09-26', takenAt: isoOnDay('26', 9, i) })),
    ];
    const mems = pickMemories(items);
    expect(pickFeatured(mems)?.id).toBe('trip');
  });

  it('falls back to the newest day memory when there is no trip memory', () => {
    const items = Array.from({ length: 6 }, (_, i) => item({ day: '2026-09-25', takenAt: isoOnDay('25', 9, i) }));
    const mems = pickMemories(items);
    expect(mems.find((m) => m.id === 'trip')).toBeUndefined();
    expect(pickFeatured(mems)?.id).toBe('day-2026-09-25');
  });

  it('returns null when nothing qualifies', () => {
    expect(pickFeatured(pickMemories([]))).toBeNull();
  });
});

describe('memorySignature', () => {
  it('changes when the slide set changes', () => {
    const items = Array.from({ length: 6 }, (_, i) => item({ day: '2026-09-25', takenAt: isoOnDay('25', 9, i) }));
    const mems1 = pickMemories(items);
    const sig1 = memorySignature(mems1.find((m) => m.id === 'day-2026-09-25')!);
    const items2 = [...items, item({ day: '2026-09-25', takenAt: isoOnDay('25', 23, 0) })];
    const mems2 = pickMemories(items2);
    const sig2 = memorySignature(mems2.find((m) => m.id === 'day-2026-09-25')!);
    expect(sig1).not.toBe(sig2);
  });
});

describe('pickMemories: ignores non-ready items', () => {
  it('does not count processing/failed items toward eligibility', () => {
    const ready = Array.from({ length: 4 }, (_, i) => item({ day: '2026-09-25', takenAt: isoOnDay('25', 9, i) }));
    const processing = Array.from({ length: 4 }, (_, i) =>
      item({ day: '2026-09-26', takenAt: isoOnDay('26', 9, i), status: 'processing' }),
    );
    expect(pickMemories([...ready, ...processing]).find((m) => m.id === 'trip')).toBeUndefined();
  });
});

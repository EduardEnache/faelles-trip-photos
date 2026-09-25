import { describe, expect, it } from 'vitest';
import {
  cityOf,
  dayOf,
  deriveDay,
  localTime,
  nearestPoi,
  tzOffsetMinutes,
  zonedWallTimeToUtc,
} from '@shared/trip';
import { formatBytes, formatDateLine, formatDuration } from '@shared/format';
import { compareItems, isAcceptedFile, kindOf } from '@shared/api';

describe('time zone', () => {
  it('Copenhagen is UTC+2 during the trip', () => {
    expect(tzOffsetMinutes(Date.parse('2026-09-26T12:00:00Z'))).toBe(120);
  });
  it('wall time → UTC', () => {
    expect(new Date(zonedWallTimeToUtc(2026, 9, 26, 14, 3, 11)).toISOString()).toBe('2026-09-26T12:03:11.000Z');
  });
  it('localTime renders Copenhagen time', () => {
    expect(localTime(Date.parse('2026-09-26T12:03:11Z'))).toBe('14:03');
  });
});

describe('dayOf', () => {
  it('maps trip days', () => {
    expect(dayOf('2026-09-25T08:00:00Z')).toBe('2026-09-25');
    expect(dayOf('2026-09-28T15:00:00Z')).toBe('2026-09-28');
  });
  it('uses a 04:00 local day boundary', () => {
    // 01:30 local on the 26th → still day 1
    expect(dayOf('2026-09-25T23:30:00Z')).toBe('2026-09-25');
    // 04:30 local on the 26th → day 2
    expect(dayOf('2026-09-26T02:30:00Z')).toBe('2026-09-26');
  });
  it('before / after', () => {
    expect(dayOf('2026-09-24T12:00:00Z')).toBe('before');
    expect(dayOf('2026-09-29T12:00:00Z')).toBe('after');
    // 02:00 local on the 29th still belongs to day 4
    expect(dayOf('2026-09-29T00:00:00Z')).toBe('2026-09-28');
  });
});

describe('places', () => {
  it('nearestPoi', () => {
    expect(nearestPoi(55.6799, 12.5905)?.name).toBe('Nyhavn');
    expect(nearestPoi(55.4, 11.0)).toBeNull();
  });
  it('cityOf falls back to towns', () => {
    expect(cityOf(55.66, 12.6)).toBe('København');
    expect(cityOf(56.045, 12.7)).toBe('Helsingborg');
    expect(cityOf(40, 20)).toBeNull();
  });
  it('deriveDay: busiest POI names the city, first two in time order form the spots', () => {
    const d = deriveDay([
      { lat: 55.969, lon: 12.5429, takenAt: '2026-09-27T12:00:00Z' },
      { lat: 55.6798, lon: 12.5911, takenAt: '2026-09-27T08:00:00Z' },
      { lat: 55.9691, lon: 12.543, takenAt: '2026-09-27T12:10:00Z' },
      { lat: null, lon: null, takenAt: '2026-09-27T13:00:00Z' },
    ]);
    expect(d).toEqual({ city: 'Humlebæk', spots: ['Nyhavn', 'Louisiana Museum'], gpsPoints: 3 });
  });
  it('deriveDay: null without GPS', () => {
    expect(deriveDay([{ lat: null, lon: null, takenAt: '2026-09-27T13:00:00Z' }])).toBeNull();
  });
});

describe('format', () => {
  it('bytes', () => {
    expect(formatBytes(3_800_000)).toBe('3.8 MB');
    expect(formatBytes(132_000_000)).toBe('132 MB');
    expect(formatBytes(1_400_000_000)).toBe('1.4 GB');
  });
  it('duration', () => {
    expect(formatDuration(7_000)).toBe('0:07');
    expect(formatDuration(92_400)).toBe('1:32');
  });
  it('date line', () => {
    expect(formatDateLine('2026-09-26T12:03:11Z')).toBe('Sat 26 Sept · 14:03');
  });
});

describe('api helpers', () => {
  it('accepts HEIC/DNG with empty mime', () => {
    expect(isAcceptedFile('IMG_1.HEIC', '')).toBe(true);
    expect(isAcceptedFile('x.DNG', 'application/octet-stream')).toBe(true);
    expect(isAcceptedFile('notes.pdf', 'application/pdf')).toBe(false);
    expect(kindOf('VID_1.MOV', '')).toBe('video');
  });
  it('compareItems', () => {
    const a = { id: 'A', takenAt: '2026-09-25T10:00:00.000Z' };
    const b = { id: 'B', takenAt: '2026-09-25T10:00:00.000Z' };
    expect([b, a].sort(compareItems)[0]).toBe(a);
  });
});

/**
 * fælles. — trip constants and pure day/place derivation.
 *
 * Used by BOTH server (ingest, ZIP folder names) and web (sections, memories,
 * places). Zero dependencies, no DOM, no Node APIs: only Intl + Math.
 * Ported from the prototype's DAYS / POIS / nearestPoi / deriveDay, with:
 *  - real time-zone handling (Europe/Copenhagen via Intl, not the device zone),
 *  - a 04:00 day boundary (a 01:30 photo belongs to the evening before),
 *  - explicit 'before' / 'after' sections instead of clamping into day 1 / 4,
 *  - POIs extended with the places on the group's actual itinerary.
 */

// ───────────────────────────── people ─────────────────────────────

export const PEOPLE = [
  { id: 'alex', name: 'Alex', color: '#2E4A5E' },
  { id: 'sam', name: 'Sam', color: '#A97E57' },
  { id: 'chris', name: 'Chris', color: '#5E7F72' },
  { id: 'edi', name: 'Edi', color: '#B23A36' },
] as const;

export type PersonId = (typeof PEOPLE)[number]['id'];
export type Person = { id: PersonId; name: string; color: string };

export const PERSON_IDS: readonly PersonId[] = PEOPLE.map((p) => p.id);

export function isPersonId(v: unknown): v is PersonId {
  return typeof v === 'string' && (PERSON_IDS as readonly string[]).includes(v);
}

export function personOf(id: PersonId): Person {
  return PEOPLE.find((p) => p.id === id)!;
}

// ───────────────────────────── trip ─────────────────────────────

export const TRIP = {
  /** Default album title; server may override via ALBUM_TITLE env. */
  title: 'Denmark 2026',
  /** Short title used in headings ("Denmark"). */
  shortTitle: 'Denmark',
  timeZone: 'Europe/Copenhagen',
  firstDay: '2026-09-25',
  lastDay: '2026-09-28',
  /** Local hour at which a new trip day starts. 01:30 on the 26th is still day 1. */
  dayStartHour: 4,
  /** Used for ZIP names: denmark-2026-all.zip */
  slug: 'denmark-2026',
} as const;

/** 'YYYY-MM-DD' of a trip day. */
export type TripDayKey = '2026-09-25' | '2026-09-26' | '2026-09-27' | '2026-09-28';
/** Library section key. Items outside 25–28 Sept go to 'before' / 'after'. */
export type DayKey = TripDayKey | 'before' | 'after';

export interface TripDay {
  n: 1 | 2 | 3 | 4;
  key: TripDayKey;
  /** 'Fri' */
  wd: string;
  /** '25 Sept' */
  date: string;
  /** Planned city. ONLY for copy like the PIN screen; never shown as a derived place. */
  plannedCity: string;
}

export const DAYS: readonly TripDay[] = [
  { n: 1, key: '2026-09-25', wd: 'Fri', date: '25 Sept', plannedCity: 'København' },
  { n: 2, key: '2026-09-26', wd: 'Sat', date: '26 Sept', plannedCity: 'København' },
  { n: 3, key: '2026-09-27', wd: 'Sun', date: '27 Sept', plannedCity: 'Humlebæk' },
  { n: 4, key: '2026-09-28', wd: 'Mon', date: '28 Sept', plannedCity: 'Helsingør' },
];

/** Section order in the library, top to bottom (chronological). */
export const SECTION_ORDER: readonly DayKey[] = ['before', ...DAYS.map((d) => d.key), 'after'];

export function tripDay(key: DayKey): TripDay | null {
  return DAYS.find((d) => d.key === key) ?? null;
}

export function isDayKey(v: unknown): v is DayKey {
  return typeof v === 'string' && (SECTION_ORDER as readonly string[]).includes(v);
}

/** Human label for a section: "Fri 25 Sept", "Before the trip", "After the trip". */
export function sectionTitle(key: DayKey): string {
  if (key === 'before') return 'Before the trip';
  if (key === 'after') return 'After the trip';
  const d = tripDay(key)!;
  return `${d.wd} ${d.date}`;
}

/** Folder name inside ZIPs (ASCII-safe-ish, sorts correctly). */
export function zipFolderName(key: DayKey): string {
  if (key === 'before') return '0 Before the trip';
  if (key === 'after') return '5 After the trip';
  const d = tripDay(key)!;
  return `Day ${d.n} - ${d.wd} ${d.date}`;
}

// ───────────────────────────── time zone ─────────────────────────────

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  /** 'Mon'..'Sun' */
  weekday: string;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a zone (default Europe/Copenhagen). */
export function zonedParts(utcMs: number, timeZone: string = TRIP.timeZone): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of dtf(timeZone).formatToParts(new Date(utcMs))) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: out.weekday ?? '',
  };
}

/** Offset of the zone from UTC at an instant, in minutes (CEST → +120). */
export function tzOffsetMinutes(utcMs: number, timeZone: string = TRIP.timeZone): number {
  const p = zonedParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(utcMs / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/**
 * Interpret a wall-clock time as local time in a zone and return the UTC instant.
 * Used for EXIF DateTimeOriginal without OffsetTime (assumed Danish local time).
 */
export function zonedWallTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
  timeZone: string = TRIP.timeZone,
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = tzOffsetMinutes(guess, timeZone);
  const first = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(first, timeZone);
  return off2 === off1 ? first : guess - off2 * 60000;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'HH:mm' in Copenhagen time. */
export function localTime(utcMs: number): string {
  const p = zonedParts(utcMs);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** 'YYYY-MM-DD' local date in Copenhagen (calendar date, no 04:00 shift). */
export function localDateKey(utcMs: number): string {
  const p = zonedParts(utcMs);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * Section for a capture instant: trip day (with 04:00 boundary) or before/after.
 * Accepts epoch ms or an ISO string.
 */
export function dayOf(takenAt: number | string): DayKey {
  const ms = typeof takenAt === 'string' ? Date.parse(takenAt) : takenAt;
  const key = localDateKey(ms - TRIP.dayStartHour * 3600_000);
  if (key < TRIP.firstDay) return 'before';
  if (key > TRIP.lastDay) return 'after';
  return key as TripDayKey;
}

// ───────────────────────────── places ─────────────────────────────

export interface Poi {
  name: string;
  city: string;
  lat: number;
  lon: number;
}

/**
 * Known places. The prototype's eight + the group's itinerary (from the
 * Copenhagen Pass Maximizer plan on this box). Order doesn't matter.
 */
export const POIS: readonly Poi[] = [
  { name: 'Nyhavn', city: 'København', lat: 55.6798, lon: 12.5911 },
  { name: 'Christianshavn', city: 'København', lat: 55.6736, lon: 12.5941 },
  { name: 'Tivoli', city: 'København', lat: 55.6737, lon: 12.5681 },
  { name: 'Superkilen', city: 'København', lat: 55.7005, lon: 12.5418 },
  { name: 'Nationalmuseet', city: 'København', lat: 55.6752, lon: 12.5744 },
  { name: 'Rundetårn', city: 'København', lat: 55.6809, lon: 12.5775 },
  { name: 'SMK', city: 'København', lat: 55.6867, lon: 12.5789 },
  { name: 'Rosenborg', city: 'København', lat: 55.6857, lon: 12.5775 },
  { name: 'Amalienborg', city: 'København', lat: 55.684, lon: 12.5934 },
  { name: 'Designmuseum', city: 'København', lat: 55.6873, lon: 12.5924 },
  { name: 'Christiansborg', city: 'København', lat: 55.6761, lon: 12.5789 },
  { name: 'Cisternerne', city: 'København', lat: 55.6724, lon: 12.5217 },
  { name: 'Zoo', city: 'København', lat: 55.6712, lon: 12.5245 },
  { name: 'Louisiana Museum', city: 'Humlebæk', lat: 55.969, lon: 12.5429 },
  { name: 'Humlebæk Havn', city: 'Humlebæk', lat: 55.9622, lon: 12.539 },
  { name: 'Kronborg', city: 'Helsingør', lat: 56.039, lon: 12.6212 },
  { name: 'Kulturværftet', city: 'Helsingør', lat: 56.0367, lon: 12.616 },
  { name: 'Frederiksborg', city: 'Hillerød', lat: 55.9349, lon: 12.3006 },
  { name: 'ARKEN', city: 'Ishøj', lat: 55.6156, lon: 12.3467 },
];

/** Towns, for points that are not near any POI. radiusKm is generous on purpose. */
export const CITIES: readonly { name: string; lat: number; lon: number; radiusKm: number }[] = [
  { name: 'København', lat: 55.6761, lon: 12.5683, radiusKm: 12 },
  { name: 'Humlebæk', lat: 55.9631, lon: 12.5347, radiusKm: 5 },
  { name: 'Helsingør', lat: 56.0361, lon: 12.6136, radiusKm: 6 },
  { name: 'Hillerød', lat: 55.9267, lon: 12.3106, radiusKm: 6 },
  { name: 'Ishøj', lat: 55.6156, lon: 12.3467, radiusKm: 5 },
  { name: 'Helsingborg', lat: 56.0465, lon: 12.6945, radiusKm: 6 },
  { name: 'Malmö', lat: 55.605, lon: 13.0038, radiusKm: 10 },
  { name: 'Kastrup', lat: 55.618, lon: 12.6508, radiusKm: 4 },
];

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Max distance for a point to count as "at" a POI. Prototype used ~2.2 km; tightened for denser POIs. */
export const POI_RADIUS_KM = 1.2;

/** Nearest known POI within POI_RADIUS_KM, else null. */
export function nearestPoi(lat: number, lon: number): Poi | null {
  let best: Poi | null = null;
  let bestD = Infinity;
  for (const p of POIS) {
    const d = distanceKm(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return bestD <= POI_RADIUS_KM ? best : null;
}

/** City for a point: the POI's city if near one, else the nearest town within its radius. */
export function cityOf(lat: number, lon: number): string | null {
  const poi = nearestPoi(lat, lon);
  if (poi) return poi.city;
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of CITIES) {
    const d = distanceKm(lat, lon, c.lat, c.lon);
    if (d <= c.radiusKm && d < bestD) {
      bestD = d;
      best = c.name;
    }
  }
  return best;
}

export interface GeoPoint {
  lat: number | null;
  lon: number | null;
  /** ISO UTC capture time. */
  takenAt: string;
}

export interface DerivedDayPlace {
  /** Busiest city of the day, e.g. 'København'. */
  city: string;
  /** Up to two POI names, in the order first visited: ['Nyhavn', 'Christianshavn']. May be empty. */
  spots: string[];
  /** Number of GPS points that were used (for the small "GPS · 14 PTS" tag). */
  gpsPoints: number;
}

/**
 * Name a day from its items' GPS (prototype deriveDay):
 * busiest place names the day; first two POIs in time order form the subtitle.
 * Returns null when no item has usable GPS → UI shows "No location data".
 */
export function deriveDay(items: readonly GeoPoint[]): DerivedDayPlace | null {
  const sorted = [...items]
    .filter((i): i is GeoPoint & { lat: number; lon: number } => i.lat != null && i.lon != null)
    .sort((a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0));
  const pois = new Map<string, { poi: Poi; n: number; first: number }>();
  const cities = new Map<string, number>();
  let used = 0;
  sorted.forEach((it, idx) => {
    const city = cityOf(it.lat, it.lon);
    if (!city) return;
    used++;
    cities.set(city, (cities.get(city) ?? 0) + 1);
    const poi = nearestPoi(it.lat, it.lon);
    if (poi) {
      const e = pois.get(poi.name);
      if (e) e.n++;
      else pois.set(poi.name, { poi, n: 1, first: idx });
    }
  });
  if (!used) return null;
  const poiArr = [...pois.values()];
  let city: string;
  if (poiArr.length) {
    // prototype rule: the busiest POI names the day's city
    city = [...poiArr].sort((a, b) => b.n - a.n || a.first - b.first)[0]!.poi.city;
  } else {
    city = [...cities.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  const spots = poiArr.sort((a, b) => a.first - b.first).slice(0, 2).map((e) => e.poi.name);
  return { city, spots, gpsPoints: used };
}

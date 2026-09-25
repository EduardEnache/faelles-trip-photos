/**
 * pure memory derivation (PLAN.md §3). No DOM, no network:
 * takes the library's items and returns the set of memories that currently
 * qualify, each with its slide list already sampled and ordered.
 *
 * Kept deterministic (same items in → same memories out) so it can be
 * unit-tested and so the "did the slide set change" signature (used for the
 * NEW MEMORY badge, see newBadge.ts) is stable.
 */
import { compareItems, type ItemDTO } from '@shared/api';
import { cityOf, DAYS, deriveDay, type DayKey, type TripDayKey } from '@shared/trip';
import { type MoodId, moodForCity } from './audio/moods';

export type MemoryKind = 'trip' | 'loved' | 'city' | 'day';

export interface Memory {
  id: string;
  kind: MemoryKind;
  title: string;
  sub: string;
  slides: ItemDTO[];
  /** Real sum of slide durations, ms. */
  lengthMs: number;
  mood: MoodId;
}

const PHOTO_SLIDE_MS = 4200;
const MAX_VIDEO_SLIDE_MS = 6000;

export function slideDurationMs(item: ItemDTO): number {
  if (item.kind === 'video') return Math.min(item.durationMs ?? PHOTO_SLIDE_MS, MAX_VIDEO_SLIDE_MS);
  return PHOTO_SLIDE_MS;
}

export function totalLengthMs(slides: readonly ItemDTO[]): number {
  return slides.reduce((a, it) => a + slideDurationMs(it), 0);
}

/** score = 3·highlight + hearts (PLAN.md §3). */
export function scoreOf(item: ItemDTO): number {
  return (item.highlighted ? 3 : 0) + item.hearts.length;
}

function readyOnly(items: readonly ItemDTO[]): ItemDTO[] {
  return items.filter((it) => it.status === 'ready');
}

/** N items spread evenly across a chronologically-sorted array. */
function evenlySpaced<T>(arr: readonly T[], n: number): T[] {
  if (n <= 0 || arr.length === 0) return [];
  if (n >= arr.length) return arr.slice();
  const used = new Set<number>();
  const out: T[] = [];
  for (let k = 0; k < n; k++) {
    let idx = Math.round(((k + 0.5) * arr.length) / n);
    idx = Math.min(arr.length - 1, Math.max(0, idx));
    while (used.has(idx) && idx < arr.length - 1) idx++;
    while (used.has(idx) && idx > 0) idx--;
    used.add(idx);
    out.push(arr[idx]!);
  }
  return out;
}

/**
 * Pick up to `quota` items from a pool: highest-score items first (score >
 * 0), the rest filled by even time-spacing across what's left, final order
 * chronological. Used for trip / city / day memories, whose pool is every
 * eligible item (scored or not) — unlike `loved`, which only draws from
 * scored items (see pickLoved).
 */
function pickFromPool(pool: readonly ItemDTO[], quota: number): ItemDTO[] {
  if (pool.length <= quota) return [...pool].sort(compareItems);
  const byScore = [...pool].filter((it) => scoreOf(it) > 0).sort((a, b) => scoreOf(b) - scoreOf(a) || compareItems(a, b));
  const top = byScore.slice(0, quota);
  const topIds = new Set(top.map((it) => it.id));
  const rest = pool.filter((it) => !topIds.has(it.id)).sort(compareItems);
  const filled = evenlySpaced(rest, quota - top.length);
  return [...top, ...filled].sort(compareItems);
}

/** Per-day quota proportional to day size, min 2/day, total <= cap (largest-remainder allocation). */
function dayQuotas(daySizes: readonly number[], cap: number, minPerDay: number): number[] {
  const total = daySizes.reduce((a, b) => a + b, 0);
  if (total <= cap) return daySizes.slice();
  let quotas = daySizes.map((s) => Math.min(s, minPerDay));
  const used = quotas.reduce((a, b) => a + b, 0);
  let remaining = cap - used;
  if (remaining > 0) {
    const weights = daySizes.map((s, i) => Math.max(0, s - quotas[i]!));
    const weightSum = weights.reduce((a, b) => a + b, 0);
    if (weightSum > 0) {
      const raw = weights.map((w) => (w / weightSum) * remaining);
      const floors = raw.map(Math.floor);
      const usedExtra = floors.reduce((a, b) => a + b, 0);
      const leftover = remaining - usedExtra;
      const order = raw
        .map((r, i) => ({ i, frac: r - Math.floor(r) }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
      const extra = [...floors];
      for (let k = 0; k < leftover && k < order.length; k++) extra[order[k]!.i]! += 1;
      quotas = quotas.map((q, i) => Math.min(daySizes[i]!, q + extra[i]!));
    }
  }
  return quotas;
}

/** Cap videos to at most 1 per 4 slides: demote the lowest-score extras back to a photo, else drop them. */
function capVideoDensity(slides: readonly ItemDTO[], pool: readonly ItemDTO[]): ItemDTO[] {
  const maxVideos = Math.max(1, Math.floor(slides.length / 4)) || (slides.length > 0 ? 1 : 0);
  const videos = slides.filter((it) => it.kind === 'video');
  if (videos.length <= maxVideos) return [...slides];
  const keepIds = new Set(
    [...videos].sort((a, b) => scoreOf(b) - scoreOf(a) || compareItems(a, b)).slice(0, maxVideos).map((it) => it.id),
  );
  const dropIds = new Set(videos.filter((v) => !keepIds.has(v.id)).map((v) => v.id));
  const usedIds = new Set(slides.map((it) => it.id));
  const replacements = pool
    .filter((it) => it.kind === 'photo' && !usedIds.has(it.id))
    .sort((a, b) => scoreOf(b) - scoreOf(a) || compareItems(a, b));
  let ri = 0;
  const out: ItemDTO[] = [];
  for (const it of slides) {
    if (!dropIds.has(it.id)) {
      out.push(it);
      continue;
    }
    const repl = replacements[ri++];
    if (repl) out.push(repl);
  }
  return out.sort(compareItems);
}

function groupByDay(items: readonly ItemDTO[]): Map<DayKey, ItemDTO[]> {
  const m = new Map<DayKey, ItemDTO[]>();
  for (const it of items) {
    const arr = m.get(it.day);
    if (arr) arr.push(it);
    else m.set(it.day, [it]);
  }
  return m;
}

function sampleAcrossDays(items: readonly ItemDTO[], dayKeys: readonly TripDayKey[], cap: number): ItemDTO[] {
  const byDay = groupByDay(items);
  const dayLists = dayKeys.map((k) => byDay.get(k) ?? []).filter((l) => l.length > 0);
  const quotas = dayQuotas(
    dayLists.map((l) => l.length),
    cap,
    2,
  );
  const slides = dayLists.flatMap((list, i) => pickFromPool(list, quotas[i]!));
  return capVideoDensity(slides.sort(compareItems), items);
}

const WEEKDAY_LONG: Record<string, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

function toGeoPoints(items: readonly ItemDTO[]) {
  return items.map((it) => ({ lat: it.lat, lon: it.lon, takenAt: it.takenAt }));
}

function pickTrip(items: readonly ItemDTO[]): Memory | null {
  const tripDayKeys = DAYS.map((d) => d.key);
  const byDay = groupByDay(items);
  const daysWithItems = tripDayKeys.filter((k) => (byDay.get(k)?.length ?? 0) > 0);
  const tripItems = tripDayKeys.flatMap((k) => byDay.get(k) ?? []);
  if (tripItems.length < 8 || daysWithItems.length < 2) return null;
  const nums = daysWithItems.map((k) => DAYS.find((d) => d.key === k)!.n);
  const allFour = daysWithItems.length === DAYS.length;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const slides = sampleAcrossDays(tripItems, tripDayKeys, 18);
  return {
    id: 'trip',
    kind: 'trip',
    title: allFour ? 'Four days in Denmark' : 'Denmark so far',
    sub: allFour ? 'The whole trip' : min === max ? `Day ${min} so far` : `Days ${min}–${max} so far`,
    slides,
    lengthMs: totalLengthMs(slides),
    mood: 'kystlys',
  };
}

function pickLoved(items: readonly ItemDTO[]): Memory | null {
  const scored = items.filter((it) => scoreOf(it) > 0);
  if (scored.length < 5) return null;
  const top = [...scored].sort((a, b) => scoreOf(b) - scoreOf(a) || compareItems(a, b)).slice(0, 12);
  const slides = top.sort(compareItems);
  return {
    id: 'loved',
    kind: 'loved',
    title: 'The four of us',
    sub: 'Most-loved moments',
    slides,
    lengthMs: totalLengthMs(slides),
    mood: 'lys',
  };
}

/** Danish/Nordic letters aren't accented Latin letters (no NFD decomposition), so map them by hand. */
const NORDIC_SLUG_MAP: Record<string, string> = { æ: 'ae', ø: 'o', å: 'aa', Æ: 'ae', Ø: 'o', Å: 'aa' };

function slugify(name: string): string {
  return name
    .replace(/[æøåÆØÅ]/g, (ch) => NORDIC_SLUG_MAP[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function pickCities(items: readonly ItemDTO[]): Memory[] {
  const withGps = items.filter((it) => it.lat != null && it.lon != null);
  const byCity = new Map<string, ItemDTO[]>();
  for (const it of withGps) {
    const city = cityOf(it.lat!, it.lon!);
    if (!city) continue;
    const arr = byCity.get(city);
    if (arr) arr.push(it);
    else byCity.set(city, [it]);
  }
  const out: Memory[] = [];
  for (const [city, cityItems] of byCity) {
    const days = new Set(cityItems.map((it) => it.day));
    if (days.size < 2 || cityItems.length < 10) continue;
    const tripKeys = DAYS.filter((d) => days.has(d.key)).map((d) => d.key);
    const nums = DAYS.filter((d) => days.has(d.key)).map((d) => d.n);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const slides = sampleAcrossDays(cityItems, tripKeys.length ? tripKeys : DAYS.map((d) => d.key), 14);
    out.push({
      id: `city-${slugify(city)}`,
      kind: 'city',
      title: city,
      sub: min === max ? `Day ${min}` : `Days ${min}–${max}`,
      slides,
      lengthMs: totalLengthMs(slides),
      mood: moodForCity(city),
    });
  }
  return out.sort((a, b) => (a.slides[0] && b.slides[0] ? compareItems(a.slides[0], b.slides[0]) : 0));
}

function pickDays(items: readonly ItemDTO[]): Memory[] {
  const out: Memory[] = [];
  for (const d of DAYS) {
    const dayItems = items.filter((it) => it.day === d.key);
    if (dayItems.length < 6) continue;
    const geo = deriveDay(toGeoPoints(dayItems));
    const title = geo ? `${WEEKDAY_LONG[d.wd] ?? d.wd} in ${geo.city}` : `Day ${d.n}`;
    const sub = geo && geo.spots.length ? `Day ${d.n} · ${geo.spots.join(' · ')}` : `Day ${d.n}`;
    const slides = capVideoDensity(pickFromPool(dayItems, 12), dayItems);
    out.push({
      id: `day-${d.key}`,
      kind: 'day',
      title,
      sub,
      slides,
      lengthMs: totalLengthMs(slides),
      mood: moodForCity(geo?.city ?? null),
    });
  }
  return out;
}

/** Every memory that currently qualifies, in tab order: trip, loved, cities, days (newest first). */
export function pickMemories(items: readonly ItemDTO[]): Memory[] {
  const ready = readyOnly(items);
  const trip = pickTrip(ready);
  const loved = pickLoved(ready);
  const cities = pickCities(ready);
  const days = pickDays(ready).reverse();
  const out: Memory[] = [];
  if (trip) out.push(trip);
  if (loved) out.push(loved);
  out.push(...cities);
  out.push(...days);
  return out;
}

/** The memory shown at the top of the library: trip if it exists, else the newest day memory. */
export function pickFeatured(memories: readonly Memory[]): Memory | null {
  const trip = memories.find((m) => m.id === 'trip');
  if (trip) return trip;
  return memories.find((m) => m.kind === 'day') ?? null;
}

/** Stable signature of a memory's slide set, for the "changed since last opened" NEW badge. */
export function memorySignature(m: Memory): string {
  return m.slides.map((s) => s.id).join(',');
}

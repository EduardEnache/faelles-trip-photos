/**
 * pure place grouping for the Places tab (PLAN.md §4). Groups
 * items with GPS into known POIs, then "Elsewhere in <city>", then
 * "Other places" (0.01° grid cells, labelled by coordinates). No DOM.
 */
import { compareItems, type ItemDTO } from '@shared/api';
import { cityOf, nearestPoi, sectionTitle, tripDay, type DayKey } from '@shared/trip';
import { formatCoords } from '@shared/format';

export type PlaceGroupKind = 'poi' | 'elsewhere' | 'other';

export interface PlaceGroup {
  key: string;
  kind: PlaceGroupKind;
  name: string;
  city: string | null;
  /** Sorted chronologically. */
  items: ItemDTO[];
  /** Unique days, in the album's chronological order. */
  days: DayKey[];
}

const GRID = 0.01;

function gridKey(lat: number, lon: number): { key: string; lat: number; lon: number } {
  const glat = Math.round(lat / GRID) * GRID;
  const glon = Math.round(lon / GRID) * GRID;
  return { key: `${glat.toFixed(2)},${glon.toFixed(2)}`, lat: glat, lon: glon };
}

/** "Day 2" or "Days 1–2" (or the section title for before/after). */
export function dayRangeLabel(days: readonly DayKey[]): string {
  const nums: number[] = [];
  for (const d of days) {
    const day = tripDay(d);
    if (day) nums.push(day.n);
  }
  if (nums.length === 0) return days.map((d) => sectionTitle(d)).join(', ');
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return min === max ? `Day ${min}` : `Days ${min}–${max}`;
}

function uniqueDaysInOrder(items: readonly ItemDTO[]): DayKey[] {
  const seen = new Set<DayKey>();
  const order: DayKey[] = [];
  for (const it of [...items].sort(compareItems)) {
    if (!seen.has(it.day)) {
      seen.add(it.day);
      order.push(it.day);
    }
  }
  return order;
}

/** Groups items with GPS into POI rows, then Elsewhere-in-city, then Other places (PLAN.md §4). */
export function groupPlaces(items: readonly ItemDTO[]): PlaceGroup[] {
  const withGps = items.filter((it) => it.lat != null && it.lon != null && it.status !== 'failed');

  const poiBuckets = new Map<string, ItemDTO[]>();
  const elsewhereBuckets = new Map<string, ItemDTO[]>();
  const otherBuckets = new Map<string, { items: ItemDTO[]; lat: number; lon: number }>();

  for (const it of withGps) {
    const lat = it.lat!;
    const lon = it.lon!;
    const poi = nearestPoi(lat, lon);
    if (poi) {
      const arr = poiBuckets.get(poi.name);
      if (arr) arr.push(it);
      else poiBuckets.set(poi.name, [it]);
      continue;
    }
    const city = cityOf(lat, lon);
    if (city) {
      const arr = elsewhereBuckets.get(city);
      if (arr) arr.push(it);
      else elsewhereBuckets.set(city, [it]);
      continue;
    }
    const g = gridKey(lat, lon);
    const bucket = otherBuckets.get(g.key);
    if (bucket) bucket.items.push(it);
    else otherBuckets.set(g.key, { items: [it], lat: g.lat, lon: g.lon });
  }

  function toGroup(kind: PlaceGroupKind, key: string, name: string, city: string | null, bucketItems: ItemDTO[]): PlaceGroup {
    const sorted = [...bucketItems].sort(compareItems);
    return { key, kind, name, city, items: sorted, days: uniqueDaysInOrder(sorted) };
  }

  const poiGroups = [...poiBuckets.entries()]
    .map(([name, its]) => {
      // city comes from the POI itself, which every item in this bucket shares.
      const city = cityOf(its[0]!.lat!, its[0]!.lon!);
      return toGroup('poi', `poi-${name}`, name, city, its);
    })
    .sort((a, b) => compareItems(a.items[0]!, b.items[0]!));

  const elsewhereGroups = [...elsewhereBuckets.entries()]
    .map(([city, its]) => toGroup('elsewhere', `elsewhere-${city}`, `Elsewhere in ${city}`, city, its))
    .sort((a, b) => compareItems(a.items[0]!, b.items[0]!));

  const otherGroups = [...otherBuckets.entries()]
    .map(([key, { items: its, lat, lon }]) => toGroup('other', `other-${key}`, formatCoords(lat, lon), null, its))
    .sort((a, b) => compareItems(a.items[0]!, b.items[0]!));

  return [...poiGroups, ...elsewhereGroups, ...otherGroups];
}

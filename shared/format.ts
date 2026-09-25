/**
 * Formatting helpers shared by server and web. Everything a camera wrote
 * (dates, times, sizes, durations) is rendered in Geist Mono by the UI;
 * these functions only produce the strings.
 */
import { dayOf, localTime, sectionTitle, zonedParts, type DayKey } from './trip';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/** Decimal units like the prototype: 3.8 MB, 132 MB, 1.4 GB. */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1e6;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 0.1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** 0:07, 1:32, 12:04, 1:02:03 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "Sat 26 Sept · 14:03" (Copenhagen time) for the viewer header. */
export function formatDateLine(takenAt: string): string {
  const ms = Date.parse(takenAt);
  const p = zonedParts(ms);
  return `${p.weekday} ${p.day} ${MON[p.month - 1]} · ${localTime(ms)}`;
}

/** "26 Sept 2026" */
export function formatDate(takenAt: string): string {
  const p = zonedParts(Date.parse(takenAt));
  return `${p.day} ${MON[p.month - 1]} ${p.year}`;
}

/** Section heading for an item's day. */
export function sectionTitleOf(takenAt: string): string {
  return sectionTitle(dayOf(takenAt) as DayKey);
}

/** 55.6798° N 12.5911° E */
export function formatCoords(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns} ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

/** "1 original" / "3 originals" style pluralisation. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

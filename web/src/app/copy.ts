/**
 * small copy/format helpers shared across app + auth + library.
 * Kept here (not in shared/) since these are UI-string helpers, not contract.
 */
import { DAYS, TRIP } from '@shared/trip';

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** "DENMARK · 25–28 SEPTEMBER 2026" (PIN screen). */
export function tripRangeLabel(): string {
  const [y, m, d1] = TRIP.firstDay.split('-').map(Number) as [number, number, number];
  const d2 = Number(TRIP.lastDay.split('-')[2]);
  const month = MONTHS_FULL[m - 1]!.toUpperCase();
  return `${TRIP.shortTitle.toUpperCase()} · ${d1}–${d2} ${month} ${y}`;
}

/** "25–28 September 2026" (sentence case, for hero meta line). */
export function tripDateRange(): string {
  const [y, m, d1] = TRIP.firstDay.split('-').map(Number) as [number, number, number];
  const d2 = Number(TRIP.lastDay.split('-')[2]);
  const month = MONTHS_FULL[m - 1]!;
  return `${d1}–${d2} ${month} ${y}`;
}

/** "Four" for a small count (falls back to the numeral above ten). */
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** Number of trip days (DAYS.length), used for "Four days" copy. */
export const TRIP_DAY_COUNT = DAYS.length;

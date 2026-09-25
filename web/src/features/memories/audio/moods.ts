/**
 * mood definitions for the generative ambient engine (PLAN.md
 * §3.2). Pure data + the city→mood mapping; no Web Audio here so
 * pickMemories.ts (and its tests) can import it without touching the DOM.
 */

export type MoodId = 'kystlys' | 'havnen' | 'glas' | 'sund' | 'lys';

export interface Mood {
  id: MoodId;
  label: string;
  /** Root note, MIDI number. */
  root: number;
  /** Scale degrees as semitone offsets from the root. */
  scale: number[];
  bed: 'sea' | 'wind' | null;
  /** 0..1, how often the bell voice plays a note per bar. */
  bellDensity: number;
  padVoices: number;
  /** Base lowpass cutoff, Hz. */
  cutoff: number;
}

export const MOODS: readonly Mood[] = [
  // D major pentatonic — warm pad + sea
  { id: 'kystlys', label: 'Kystlys', root: 62, scale: [0, 2, 4, 7, 9], bed: 'sea', bellDensity: 0.16, padVoices: 3, cutoff: 1400 },
  // A dorian — soft keys, low bed
  { id: 'havnen', label: 'Havnen', root: 57, scale: [0, 2, 3, 5, 7, 9, 10], bed: null, bellDensity: 0.12, padVoices: 3, cutoff: 950 },
  // F lydian — glassy bells, little pad
  { id: 'glas', label: 'Glas', root: 65, scale: [0, 2, 4, 6, 7, 9, 11], bed: null, bellDensity: 0.36, padVoices: 2, cutoff: 2200 },
  // E aeolian — low fifths drone + wind
  { id: 'sund', label: 'Sund', root: 52, scale: [0, 2, 3, 5, 7, 8, 10], bed: 'wind', bellDensity: 0.08, padVoices: 3, cutoff: 750 },
  // G major — bright pad, more bells
  { id: 'lys', label: 'Lys', root: 67, scale: [0, 2, 4, 5, 7, 9, 11], bed: null, bellDensity: 0.42, padVoices: 3, cutoff: 1900 },
] as const;

export function moodOf(id: MoodId): Mood {
  return MOODS.find((m) => m.id === id) ?? MOODS[0]!;
}

const CITY_MOOD: Record<string, MoodId> = {
  'København': 'havnen',
  'Humlebæk': 'glas',
  'Helsingør': 'sund',
};

/** City → mood (PLAN.md §3.2): København Havnen, Humlebæk Glas, Helsingør Sund, others Kystlys. */
export function moodForCity(city: string | null): MoodId {
  if (!city) return 'kystlys';
  return CITY_MOOD[city] ?? 'kystlys';
}

export function nextMood(id: MoodId): MoodId {
  const i = MOODS.findIndex((m) => m.id === id);
  return MOODS[(i + 1) % MOODS.length]!.id;
}

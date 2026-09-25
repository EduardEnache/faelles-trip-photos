/**
 * pure "scheduler maths" for the ambient engine (PLAN.md §3.2,
 * §8 "audio scheduler maths"). No Web Audio API here, so it's unit-testable
 * under Node/vitest: seeded PRNG, note/frequency maths, chord building.
 */

/** mulberry32: small, fast, deterministic PRNG. Same seed → same sequence, forever. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function rand() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash, used to seed the PRNG from a memory id + mood name. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** MIDI note number → frequency in Hz (A4 = 69 = 440Hz). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** A simple i–iv–v–like triad from scale degrees, root + two more a couple of steps apart. */
export function chordNotes(root: number, scale: readonly number[], degreeIndex: number, octave = 0): number[] {
  const n = scale.length;
  const at = (offset: number) => root + scale[(((degreeIndex + offset) % n) + n) % n]! + 12 * octave;
  return n >= 5 ? [at(0), at(2), at(4)] : [at(0), at(1), at(Math.min(2, n - 1))];
}

/** Deterministic pick of a single scale note (for a bell hit), from a PRNG draw. */
export function pickScaleNote(root: number, scale: readonly number[], rand: () => number, octaveSpread = 1): number {
  const degree = Math.floor(rand() * scale.length);
  const octave = Math.floor(rand() * (octaveSpread + 1));
  return root + scale[degree]! + 12 * octave;
}

/** Next candidate time for a sparse event (bell), spaced ~0.6-2.4s apart, seeded. */
export function nextEventGap(rand: () => number): number {
  return 0.6 + rand() * 1.8;
}

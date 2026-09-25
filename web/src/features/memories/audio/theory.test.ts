import { describe, expect, it } from 'vitest';
import { chordNotes, hashString, midiToFreq, mulberry32, nextEventGap, pickScaleNote } from './theory';

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces values in [0, 1)', () => {
    const rand = mulberry32(hashString('trip-kystlys'));
    for (let i = 0; i < 200; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs for different seeds', () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });
});

describe('hashString', () => {
  it('is stable for the same input', () => {
    expect(hashString('day-2026-09-26-havnen')).toBe(hashString('day-2026-09-26-havnen'));
  });

  it('differs for different memory/mood pairs', () => {
    expect(hashString('trip-kystlys')).not.toBe(hashString('trip-lys'));
  });
});

describe('midiToFreq', () => {
  it('A4 (midi 69) is 440Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 5);
  });

  it('an octave up doubles the frequency', () => {
    expect(midiToFreq(81)).toBeCloseTo(880, 5);
  });
});

describe('chordNotes', () => {
  it('returns three notes built from the scale', () => {
    const notes = chordNotes(62, [0, 2, 4, 7, 9], 0);
    expect(notes).toHaveLength(3);
    expect(notes[0]).toBe(62);
  });

  it('stays within the scale family across degree indices', () => {
    for (let d = 0; d < 5; d++) {
      const notes = chordNotes(62, [0, 2, 4, 7, 9], d);
      expect(notes.every((n) => Number.isFinite(n))).toBe(true);
    }
  });
});

describe('pickScaleNote / nextEventGap', () => {
  it('picks a note derived from the scale, deterministically per seed', () => {
    const rand1 = mulberry32(7);
    const rand2 = mulberry32(7);
    const n1 = pickScaleNote(60, [0, 2, 4, 7, 9], rand1);
    const n2 = pickScaleNote(60, [0, 2, 4, 7, 9], rand2);
    expect(n1).toBe(n2);
  });

  it('gap is always positive and bounded', () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const gap = nextEventGap(rand);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(3);
    }
  });
});

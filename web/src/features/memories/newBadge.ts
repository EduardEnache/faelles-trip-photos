/**
 * "has this device seen this memory's current slide set?"
 * (PLAN.md §3: the featured card says NEW MEMORY only if the signature
 * changed since this device last opened it). One shared localStorage map so
 * FeaturedMemoryCard (read-only) and MemoryPlayer (marks opened) agree.
 */
import type { Memory } from './pickMemories';
import { memorySignature } from './pickMemories';

const KEY = 'faelles:opened-memories';

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* private mode / storage blocked */
  }
}

/** True when this memory's current slide set hasn't been opened on this device. */
export function isNewMemory(m: Memory): boolean {
  const seen = readMap()[m.id];
  return seen !== memorySignature(m);
}

/** Record that this memory (with its current slide set) has now been opened. */
export function markMemoryOpened(m: Memory): void {
  const map = readMap();
  map[m.id] = memorySignature(m);
  writeMap(map);
}

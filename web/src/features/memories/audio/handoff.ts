/**
 * bridges the user gesture that opens a memory (a tap on
 * FeaturedMemoryCard / a MemoriesTab card) to the engine that plays inside
 * MemoryPlayer. MemoryPlayer is lazy-loaded (`slots.ts`), so its own mount
 * effect runs after a dynamic import — too late for iOS Safari to count as
 * "started from a user gesture". Creating the AudioContext synchronously in
 * the click handler, before navigating, keeps it inside the gesture.
 */
import { createAmbientEngine, type AmbientEngine } from './engine';
import type { MoodId } from './moods';

let pending: { memoryId: string; engine: AmbientEngine } | null = null;

/** Call synchronously inside the onClick that opens a memory. */
export function prepareEngineForGesture(memoryId: string, mood: MoodId): void {
  pending?.engine.stop();
  const engine = createAmbientEngine(memoryId, mood);
  engine.start();
  pending = { memoryId, engine };
}

/** MemoryPlayer claims the prepared engine on mount if it matches; otherwise it makes its own (best effort). */
export function claimPreparedEngine(memoryId: string): AmbientEngine | null {
  if (pending && pending.memoryId === memoryId) {
    const engine = pending.engine;
    pending = null;
    return engine;
  }
  return null;
}

/** Discard an unclaimed prepared engine so it never leaks (e.g. navigation was interrupted). */
export function discardUnclaimedEngine(): void {
  if (pending) {
    pending.engine.stop();
    pending = null;
  }
}

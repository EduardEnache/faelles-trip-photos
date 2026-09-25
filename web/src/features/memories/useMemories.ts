/** memoised memory derivation hooks, shared by the tab, the featured card and the player. */
import { useMemo } from 'react';
import { useItems } from '@/state/library';
import { pickFeatured, pickMemories, type Memory } from './pickMemories';

export function useMemories(): Memory[] {
  const items = useItems();
  return useMemo(() => pickMemories(items), [items]);
}

export function useFeaturedMemory(): Memory | null {
  const memories = useMemories();
  return useMemo(() => pickFeatured(memories), [memories]);
}

export function useMemory(id: string | null): Memory | null {
  const memories = useMemories();
  return useMemo(() => (id ? memories.find((m) => m.id === id) ?? null : null), [memories, id]);
}

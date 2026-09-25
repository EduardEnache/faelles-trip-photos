/**
 * items after the active filter chip, sorted (as the library
 * store already sorts them). Shared by the grid, the viewer's prev/next and
 * the selection bar's "select all".
 */
import { useMemo } from 'react';
import type { ItemDTO } from '@shared/api';
import { useItems } from '@/state/library';
import { useFilterStore } from './filterStore';

export function useVisibleItems(): ItemDTO[] {
  const items = useItems();
  const filter = useFilterStore((s) => s.filter);
  return useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'fav') return items.filter((i) => i.highlighted);
    if (filter === 'video') return items.filter((i) => i.kind === 'video');
    return items.filter((i) => i.uploader === filter);
  }, [items, filter]);
}

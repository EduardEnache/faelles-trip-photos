/**
 * library filter chip state (All / Highlights / Videos / person).
 * Tapping the active chip clears back to 'all'.
 */
import { create } from 'zustand';
import type { PersonId } from '@shared/trip';

export type FilterKey = 'all' | 'fav' | 'video' | PersonId;

interface FilterState {
  filter: FilterKey;
  set(key: FilterKey): void;
}

export const useFilterStore = create<FilterState>((set, get) => ({
  filter: 'all',
  set(key) {
    set({ filter: get().filter === key && key !== 'all' ? 'all' : key });
  },
}));

/**
 * selection mode state (long-press / Select button, per-day
 * select, shift-click range on desktop). Local UI state, not persisted.
 */
import { create } from 'zustand';

interface SelectionState {
  active: boolean;
  ids: string[];
  /** Index of the last tapped tile in the current visible order, for shift-click ranges. */
  lastIndex: number | null;
  enter(id: string): void;
  enterEmpty(): void;
  exit(): void;
  toggle(id: string, index?: number): void;
  selectRange(orderedIds: string[], fromIndex: number, toIndex: number): void;
  setMany(ids: string[], on: boolean): void;
  selectAll(ids: string[]): void;
  clear(): void;
}

export const useSelection = create<SelectionState>((set, get) => ({
  active: false,
  ids: [],
  lastIndex: null,

  enter(id) {
    set({ active: true, ids: [id], lastIndex: null });
  },
  enterEmpty() {
    set({ active: true, ids: [], lastIndex: null });
  },
  exit() {
    set({ active: false, ids: [], lastIndex: null });
  },
  toggle(id, index) {
    const ids = get().ids.includes(id) ? get().ids.filter((x) => x !== id) : [...get().ids, id];
    set({ ids, lastIndex: index ?? get().lastIndex });
  },
  selectRange(orderedIds, fromIndex, toIndex) {
    const [a, b] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
    const range = orderedIds.slice(a, b + 1);
    const next = new Set(get().ids);
    for (const id of range) next.add(id);
    set({ ids: [...next], lastIndex: toIndex });
  },
  setMany(ids, on) {
    const next = new Set(get().ids);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    set({ ids: [...next] });
  },
  selectAll(ids) {
    set({ ids: [...ids] });
  },
  clear() {
    set({ ids: [] });
  },
}));

export const useSelectionActive = () => useSelection((s) => s.active);
export const useSelectionCount = () => useSelection((s) => s.ids.length);
export const useIsSelected = (id: string) => useSelection((s) => s.active && s.ids.includes(id));

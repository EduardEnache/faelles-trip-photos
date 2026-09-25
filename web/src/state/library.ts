/**
 * Library store: every item + captions + disk, kept live via SSE.
 * SCAFFOLD-OWNED; packages B and C read it (selectors below) and call the
 * mutation helpers. Nobody else fetches api/library.
 *
 * Live strategy (per @shared/api): on every EventSource (re)open → reload
 * the library, then apply events. Items are replaced wholesale.
 */
import { create } from 'zustand';
import { useMemo } from 'react';
import {
  compareItems,
  type CaptionDTO,
  type DayKey,
  type DiskDTO,
  type ItemDTO,
  type ServerEvent,
} from '@shared/api';
import { api, eventsUrl } from '@/lib/api';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export type LiveStatus = 'off' | 'connecting' | 'open' | 'reconnecting';

interface LibraryState {
  status: LoadStatus;
  error: string | null;
  byId: Record<string, ItemDTO>;
  /** Sorted by takenAt ASC, then id. Recomputed on every change. */
  items: ItemDTO[];
  captions: Partial<Record<DayKey, CaptionDTO>>;
  disk: DiskDTO | null;
  live: LiveStatus;

  load(): Promise<void>;
  upsert(item: ItemDTO): void;
  remove(id: string): void;
  setCaption(day: DayKey, caption: CaptionDTO | null): void;
  apply(ev: ServerEvent): void;
  /** Start SSE; returns a stop function. Idempotent. */
  startLive(): () => void;
}

function sorted(byId: Record<string, ItemDTO>): ItemDTO[] {
  return Object.values(byId).sort(compareItems);
}

let es: EventSource | null = null;
let everOpened = false;

export const useLibrary = create<LibraryState>((set, get) => ({
  status: 'idle',
  error: null,
  byId: {},
  items: [],
  captions: {},
  disk: null,
  live: 'off',

  async load() {
    if (get().status === 'idle') set({ status: 'loading' });
    try {
      const lib = await api.getLibrary();
      const byId: Record<string, ItemDTO> = {};
      for (const it of lib.items) byId[it.id] = it;
      const captions: Partial<Record<DayKey, CaptionDTO>> = {};
      for (const c of lib.captions) captions[c.day] = c;
      set({ status: 'ready', error: null, byId, items: sorted(byId), captions, disk: lib.disk });
    } catch (e) {
      set({ status: get().status === 'ready' ? 'ready' : 'error', error: (e as Error).message });
    }
  },

  upsert(item) {
    const byId = { ...get().byId, [item.id]: item };
    set({ byId, items: sorted(byId) });
  },

  remove(id) {
    if (!get().byId[id]) return;
    const byId = { ...get().byId };
    delete byId[id];
    set({ byId, items: sorted(byId) });
  },

  setCaption(day, caption) {
    const captions = { ...get().captions };
    if (caption) captions[day] = caption;
    else delete captions[day];
    set({ captions });
  },

  apply(ev) {
    switch (ev.type) {
      case 'hello':
        return;
      case 'item.added':
      case 'item.updated':
        get().upsert(ev.item);
        return;
      case 'item.deleted':
        get().remove(ev.id);
        return;
      case 'caption.updated':
        get().setCaption(ev.day, ev.caption);
        return;
      case 'disk':
        set({ disk: ev.disk });
        return;
    }
  },

  startLive() {
    if (!es) {
      set({ live: 'connecting' });
      es = new EventSource(eventsUrl(), { withCredentials: true });
      es.onopen = () => {
        set({ live: 'open' });
        // First open: the app already called load(). Re-opens: resync.
        if (everOpened) void get().load();
        everOpened = true;
      };
      es.onmessage = (m) => {
        try {
          get().apply(JSON.parse(m.data) as ServerEvent);
        } catch {
          /* ignore malformed */
        }
      };
      es.onerror = () => {
        // EventSource retries by itself; a 401 closes it (readyState CLOSED).
        set({ live: es && es.readyState === EventSource.CLOSED ? 'off' : 'reconnecting' });
        if (es && es.readyState === EventSource.CLOSED) {
          es = null;
        }
      };
    }
    return () => {
      es?.close();
      es = null;
      set({ live: 'off' });
    };
  },
}));

// ── selectors ──────────────────────────────────────────────

export const useItems = () => useLibrary((s) => s.items);
export const useItem = (id: string | null) => useLibrary((s) => (id ? s.byId[id] ?? null : null));
export const useCaptions = () => useLibrary((s) => s.captions);

/** Items grouped by section, in SECTION_ORDER-compatible key order of appearance. */
export function useItemsByDay(items: ItemDTO[]): Map<DayKey, ItemDTO[]> {
  return useMemo(() => {
    const m = new Map<DayKey, ItemDTO[]>();
    for (const it of items) {
      const arr = m.get(it.day);
      if (arr) arr.push(it);
      else m.set(it.day, [it]);
    }
    return m;
  }, [items]);
}

/** Optimistic helpers (server response replaces the item; SSE echoes to others). */
export async function toggleHeart(item: ItemDTO, me: NonNullable<ItemDTO['uploader']>) {
  const on = !item.hearts.includes(me);
  const { upsert } = useLibrary.getState();
  upsert({ ...item, hearts: on ? [...item.hearts, me] : item.hearts.filter((p) => p !== me) });
  try {
    upsert(await api.heart(item.id, on));
  } catch (e) {
    upsert(item);
    throw e;
  }
}

export async function toggleHighlight(item: ItemDTO, me: NonNullable<ItemDTO['uploader']>) {
  const on = !item.highlighted;
  const { upsert } = useLibrary.getState();
  upsert({ ...item, highlighted: on, highlightedBy: on ? me : null });
  try {
    upsert(await api.highlight(item.id, on));
  } catch (e) {
    upsert(item);
    throw e;
  }
}

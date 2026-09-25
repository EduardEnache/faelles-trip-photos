/**
 * Tiny history router. SCAFFOLD-OWNED (shared by packages B and C).
 *
 * URL model (base '/photos/'):
 *   /photos/                 Library tab
 *   /photos/memories         Memories tab
 *   /photos/places           Places tab
 * Overlays are query params ON TOP of the current tab, so the tab underneath
 * stays mounted (library scroll position survives the viewer):
 *   ?item=<id>               Viewer                     (package B)
 *   ?memory=<memoryId>       Memory player              (package C)
 *   ?upload=1                Upload sheet / modal       (package B)
 *   ?day=<DayKey>            One-shot "scroll library to this day" (Places → Library). The
 *                            library consumes it and calls clearDayTarget().
 *
 * Opening an overlay pushes a history entry (Android/iOS back closes it).
 * Moving between items inside the viewer uses {replace:true}.
 */
import { useSyncExternalStore } from 'react';
import { isDayKey, type DayKey } from '@shared/trip';

export type Tab = 'library' | 'memories' | 'places';

export interface Route {
  tab: Tab;
  item: string | null;
  memory: string | null;
  upload: boolean;
  day: DayKey | null;
}

const BASE = import.meta.env.BASE_URL; // '/photos/'
const CHANGE = 'faelles:route';
const OVERLAY_MARK = 'faellesOverlay';

function parse(loc: Location): Route {
  let path = loc.pathname;
  if (path.startsWith(BASE)) path = path.slice(BASE.length);
  else if (path.startsWith('/')) path = path.slice(1);
  const seg = path.split('/').filter(Boolean)[0] ?? '';
  const tab: Tab = seg === 'memories' || seg === 'places' ? seg : 'library';
  const q = new URLSearchParams(loc.search);
  const day = q.get('day');
  return {
    tab,
    item: q.get('item'),
    memory: q.get('memory'),
    upload: q.get('upload') === '1',
    day: isDayKey(day) ? day : null,
  };
}

function format(r: Route): string {
  const path = `${BASE}${r.tab === 'library' ? '' : r.tab}`;
  const q = new URLSearchParams();
  if (r.item) q.set('item', r.item);
  if (r.memory) q.set('memory', r.memory);
  if (r.upload) q.set('upload', '1');
  if (r.day) q.set('day', r.day);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

let current: Route = typeof window !== 'undefined' ? parse(window.location) : {
  tab: 'library', item: null, memory: null, upload: false, day: null,
};
let currentKey = JSON.stringify(current);

function sync() {
  const next = parse(window.location);
  const key = JSON.stringify(next);
  if (key !== currentKey) {
    current = next;
    currentKey = key;
  }
}

function subscribe(cb: () => void) {
  const h = () => {
    sync();
    cb();
  };
  window.addEventListener('popstate', h);
  window.addEventListener(CHANGE, h);
  return () => {
    window.removeEventListener('popstate', h);
    window.removeEventListener(CHANGE, h);
  };
}

export function getRoute(): Route {
  return current;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRoute, getRoute);
}

function commit(next: Route, mode: 'push' | 'replace', overlay = false) {
  const href = format(next);
  const state = overlay ? { [OVERLAY_MARK]: true } : (mode === 'replace' ? window.history.state : null);
  if (mode === 'push') window.history.pushState(state, '', href);
  else window.history.replaceState(state, '', href);
  window.dispatchEvent(new Event(CHANGE));
}

/** Switch tab. Closes overlays. Scrolls to top unless keepScroll. */
export function navigateTab(tab: Tab, opts: { day?: DayKey; keepScroll?: boolean } = {}) {
  const next: Route = { tab, item: null, memory: null, upload: false, day: opts.day ?? null };
  commit(next, 'push');
  if (!opts.keepScroll && !opts.day) window.scrollTo(0, 0);
}

/** Library, scrolled to a day (used by Places and Memories). */
export function goToDay(day: DayKey) {
  navigateTab('library', { day });
}

export function clearDayTarget() {
  if (current.day) commit({ ...current, day: null }, 'replace');
}

export function openViewer(itemId: string, opts: { replace?: boolean } = {}) {
  const next = { ...current, item: itemId };
  if (opts.replace || current.item) commit(next, 'replace', !!window.history.state?.[OVERLAY_MARK]);
  else commit(next, 'push', true);
}

export function openMemory(memoryId: string) {
  commit({ ...current, memory: memoryId, item: null }, 'push', true);
}

export function openUpload() {
  if (current.upload) return;
  commit({ ...current, upload: true }, 'push', true);
}

/**
 * Close the top-most overlay (upload > memory > item). Uses history.back()
 * when we pushed the entry, so the back stack stays clean; otherwise replaces.
 */
export function closeOverlay() {
  const pushedByUs = !!window.history.state?.[OVERLAY_MARK];
  if (pushedByUs) {
    window.history.back();
    return;
  }
  const next = { ...current };
  if (next.upload) next.upload = false;
  else if (next.memory) next.memory = null;
  else next.item = null;
  commit(next, 'replace');
}

/**
 * Toast store. SCAFFOLD-OWNED. the frontend renders <ToastHost/> (single dark
 * Blæk toast, 2–3px hairline bar, mono %). Anyone may call toast.*.
 *
 * One toast at a time (the spec: "long jobs report in a single dark toast");
 * show() with the same id updates in place, a different id replaces.
 */
import { create } from 'zustand';

export interface ToastAction {
  label: string;
  onAction(): void;
}

export interface Toast {
  id: string;
  title: string;
  /** Mono sub-line: "12 originals · 1.4 GB". */
  sub?: string;
  /** 0..1 shows the hairline bar + mono %; null/undefined = no bar. Only for REAL progress. */
  progress?: number | null;
  /** Finished state: bar turns Havglas, % becomes a check. */
  done?: boolean;
  /** Error tone (Dannebrog accent). */
  error?: boolean;
  action?: ToastAction;
  /** Auto-dismiss after ms (default: 4000 when done/error/plain, never while progress < 1). */
  durationMs?: number;
}

interface ToastState {
  current: Toast | null;
  show(t: Toast): void;
  update(id: string, patch: Partial<Omit<Toast, 'id'>>): void;
  dismiss(id?: string): void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(t: Toast) {
  if (timer) clearTimeout(timer);
  timer = null;
  const inProgress = t.progress != null && t.progress < 1 && !t.done;
  const ms = t.durationMs ?? (inProgress ? 0 : t.action ? 8000 : 4000);
  if (ms > 0) timer = setTimeout(() => useToast.getState().dismiss(t.id), ms);
}

export const useToast = create<ToastState>((set, get) => ({
  current: null,
  show(t) {
    set({ current: t });
    schedule(t);
  },
  update(id, patch) {
    const c = get().current;
    if (!c || c.id !== id) return;
    const next = { ...c, ...patch };
    set({ current: next });
    schedule(next);
  },
  dismiss(id) {
    const c = get().current;
    if (!c || (id && c.id !== id)) return;
    if (timer) clearTimeout(timer);
    timer = null;
    set({ current: null });
  },
}));

export const toast = {
  show: (t: Toast) => useToast.getState().show(t),
  update: (id: string, patch: Partial<Omit<Toast, 'id'>>) => useToast.getState().update(id, patch),
  dismiss: (id?: string) => useToast.getState().dismiss(id),
};

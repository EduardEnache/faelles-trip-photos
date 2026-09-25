/**
 * Session store (PIN gate + "who's this"). SCAFFOLD-OWNED.
 * the frontend builds the PIN and Who screens on top of this.
 */
import { create } from 'zustand';
import type { PersonId, SessionDTO } from '@shared/api';
import { TRIP } from '@shared/trip';
import { api, ApiRequestError, UNAUTHENTICATED_EVENT } from '@/lib/api';

export type SessionStatus =
  | 'unknown' // first GET in flight
  | 'locked' // show PIN gate
  | 'needs-person' // show "Who's this?"
  | 'ready'; // show the app

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'wrong_pin'; attemptsLeft: number | null }
  | { ok: false; reason: 'locked'; retryAfterSec: number }
  | { ok: false; reason: 'offline' | 'error'; message: string };

interface SessionState {
  status: SessionStatus;
  session: SessionDTO | null;
  /** Album title from the server (falls back to TRIP.title before the first response). */
  albumTitle: string;
  /** true while the user is re-picking their name from the app ("Change"). */
  choosingPerson: boolean;
  refresh(): Promise<void>;
  login(pin: string): Promise<LoginResult>;
  setPerson(person: PersonId): Promise<void>;
  startChoosingPerson(): void;
  cancelChoosingPerson(): void;
  logout(): Promise<void>;
}

function statusOf(s: SessionDTO): SessionStatus {
  if (!s.authenticated) return 'locked';
  return s.person ? 'ready' : 'needs-person';
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'unknown',
  session: null,
  albumTitle: TRIP.title,
  choosingPerson: false,

  async refresh() {
    try {
      const s = await api.getSession();
      set({ session: s, status: statusOf(s), albumTitle: s.album.title });
    } catch {
      // Offline on first load: keep whatever we had; if nothing, show the gate.
      if (get().status === 'unknown') set({ status: 'locked' });
    }
  },

  async login(pin) {
    try {
      const s = await api.login(pin);
      set({ session: s, status: statusOf(s), albumTitle: s.album.title });
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiRequestError) {
        if (e.code === 'wrong_pin') return { ok: false, reason: 'wrong_pin', attemptsLeft: e.body.attemptsLeft ?? null };
        if (e.code === 'locked') return { ok: false, reason: 'locked', retryAfterSec: e.body.retryAfterSec ?? 60 };
        if (e.status === 0) return { ok: false, reason: 'offline', message: 'No connection. Check your signal and try again.' };
        return { ok: false, reason: 'error', message: e.message };
      }
      return { ok: false, reason: 'error', message: 'Something went wrong' };
    }
  },

  async setPerson(person) {
    const s = await api.setPerson(person);
    set({ session: s, status: statusOf(s), choosingPerson: false });
  },

  startChoosingPerson: () => set({ choosingPerson: true }),
  cancelChoosingPerson: () => set({ choosingPerson: false }),

  async logout() {
    try {
      await api.logout();
    } finally {
      set({ status: 'locked', session: get().session ? { ...get().session!, authenticated: false, person: null } : null });
    }
  },
}));

/** The current person, or null. */
export const useMe = () => useSession((s) => s.session?.person ?? null);

if (typeof window !== 'undefined') {
  window.addEventListener(UNAUTHENTICATED_EVENT, () => {
    const st = useSession.getState();
    if (st.status !== 'locked') useSession.setState({ status: 'locked' });
  });
}

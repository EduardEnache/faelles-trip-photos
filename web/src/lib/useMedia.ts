/** Media-query hooks. SCAFFOLD-OWNED. WIDE matches the prototype's 900px switch. */
import { useSyncExternalStore } from 'react';

export const WIDE_QUERY = '(min-width: 900px)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Desktop layout: top nav, auto-fill grid, floating selection pill, centred upload modal. */
export const useWide = () => useMediaQuery(WIDE_QUERY);
export const useReducedMotion = () => useMediaQuery(REDUCED_MOTION_QUERY);

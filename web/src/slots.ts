/**
 * Integration points between package B (shell) and package C (extras).
 * SCAFFOLD-OWNED — neither package edits this file.
 *
 * B renders these; C implements the modules they point to. Props are fixed
 * here so both sides can build blind. Heavy screens are lazy (own chunks —
 * maplibre-gl only loads when Places opens).
 *
 *   Where B renders it                         What C provides
 *   ─────────────────────────────────────────  ────────────────────────────────────────────
 *   Tab 'memories' (route.tab)                 features/memories/MemoriesTab.tsx   (default export)
 *   Tab 'places'                               features/places/PlacesTab.tsx       (default export)
 *   Overlay when route.memory != null          features/memories/MemoryPlayer.tsx  (default export)
 *   Top of Library, above the filter chips     features/memories/FeaturedMemoryCard.tsx (named)
 *   Inside every trip-day section header       features/captions/DayCaption.tsx    (named)
 *
 * B wraps the lazy ones in <Suspense fallback={null}> (player) or a quiet
 * skeleton (tabs). C's components read stores (useLibrary, useSession) and
 * navigate with lib/router (openMemory, goToDay, openViewer) themselves.
 */
import { lazy } from 'react';
import type { DayKey } from '@shared/trip';

export interface MemoryPlayerProps {
  /** Memory id from the URL (?memory=). Unknown/empty id → C shows a quiet "This memory isn't available" + close. */
  memoryId: string;
  /** B passes router.closeOverlay. */
  onClose(): void;
}

export interface FeaturedMemoryCardProps {
  /** Nothing: renders null when no memory qualifies (no fake card). */
  _?: never;
}

export interface DayCaptionProps {
  day: DayKey;
  /** B passes false while in select mode (caption shown read-only). */
  editable: boolean;
}

export const MemoriesTab = lazy(() => import('./features/memories/MemoriesTab'));
export const PlacesTab = lazy(() => import('./features/places/PlacesTab'));
export const MemoryPlayer = lazy(() => import('./features/memories/MemoryPlayer'));
export { FeaturedMemoryCard } from './features/memories/FeaturedMemoryCard';
export { DayCaption } from './features/captions/DayCaption';

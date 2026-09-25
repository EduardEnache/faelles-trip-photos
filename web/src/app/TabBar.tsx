/**
 * mobile bottom tab bar: Library / Memories / Places + centre
 * upload button with the pending-uploads badge. Hidden in select mode.
 */
import { LibraryIcon, MemoriesIcon, PlacesIcon, PlusIcon } from '@/lib/icons';
import { navigateTab, openUpload, useRoute } from '@/lib/router';
import { usePendingUploadCount } from '@/features/upload/uploadQueue';
import { useHasPlaces } from '@/state/library';
import s from './TabBar.module.css';

export function TabBar() {
  const route = useRoute();
  const pending = usePendingUploadCount();
  const hasPlaces = useHasPlaces();

  return (
    <nav className={[s.bar, !hasPlaces && s.three].filter(Boolean).join(' ')} aria-label="Primary">
      <button
        type="button"
        className={[s.item, route.tab === 'library' && s.active].filter(Boolean).join(' ')}
        onClick={() => navigateTab('library')}
      >
        <LibraryIcon aria-hidden />
        Library
      </button>
      <button
        type="button"
        className={[s.item, route.tab === 'memories' && s.active].filter(Boolean).join(' ')}
        onClick={() => navigateTab('memories')}
      >
        <MemoriesIcon aria-hidden />
        Memories
      </button>
      {hasPlaces && (
        <button
          type="button"
          className={[s.item, route.tab === 'places' && s.active].filter(Boolean).join(' ')}
          onClick={() => navigateTab('places')}
        >
          <PlacesIcon aria-hidden />
          Places
        </button>
      )}
      <div className={s.uploadWrap}>
        <button type="button" className={s.upload} aria-label="Upload" onClick={openUpload}>
          <PlusIcon weight="bold" color="var(--papir)" aria-hidden />
          {pending > 0 && <span className={s.badge}>{pending}</span>}
        </button>
      </div>
    </nav>
  );
}

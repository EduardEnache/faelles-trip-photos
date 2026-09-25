/**
 * top bar: mobile compact bar (wordmark + select + avatar),
 * desktop top nav (wordmark, tabs, switch person, Upload).
 */
import { openUpload, navigateTab, useRoute } from '@/lib/router';
import { Wordmark } from '@/ui';
import { useMe, useSession } from '@/state/session';
import { personOf } from '@shared/trip';
import { usePendingUploadCount } from '@/features/upload/uploadQueue';
import { useSelection } from '@/features/select/selectionStore';
import s from './TopBar.module.css';

export function TopBar({ wide }: { wide: boolean }) {
  const route = useRoute();
  const me = useMe();
  const albumTitle = useSession((st) => st.albumTitle);
  const startChoosing = useSession((st) => st.startChoosingPerson);
  const pending = usePendingUploadCount();
  const selectMode = useSelection((st) => st.active);
  const enterSelect = useSelection((st) => st.enterEmpty);
  const exitSelect = useSelection((st) => st.exit);

  const person = me ? personOf(me) : null;

  if (!wide) {
    return (
      <div className={s.bar}>
        <div className={s.narrow}>
          <Wordmark />
          <div className={s.narrowActions}>
            {route.tab === 'library' && (
              <button
                type="button"
                className={[s.selectBtn, selectMode && s.active].filter(Boolean).join(' ')}
                onClick={() => (selectMode ? exitSelect() : enterSelect())}
              >
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            )}
            <button
              type="button"
              className={s.avatarBtn}
              style={{ background: person?.color ?? 'var(--sten)' }}
              aria-label={`Switch person (currently ${person?.name ?? 'unknown'})`}
              onClick={startChoosing}
            >
              {person?.name[0] ?? '?'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={[s.bar, s.wide].join(' ')}>
      <div className={s.wideInner}>
        <div className={s.brand}>
          <Wordmark />
          <div className={s.brandTag}>{albumTitle.toUpperCase()}</div>
        </div>
        <div className={s.tabs}>
          <button
            type="button"
            className={[s.tab, route.tab === 'library' && s.active].filter(Boolean).join(' ')}
            onClick={() => navigateTab('library')}
          >
            Library
          </button>
          <button
            type="button"
            className={[s.tab, route.tab === 'memories' && s.active].filter(Boolean).join(' ')}
            onClick={() => navigateTab('memories')}
          >
            Memories
          </button>
          <button
            type="button"
            className={[s.tab, route.tab === 'places' && s.active].filter(Boolean).join(' ')}
            onClick={() => navigateTab('places')}
          >
            Places
          </button>
        </div>
        <div className={s.right}>
          <button type="button" className={s.who} title="Switch person" onClick={startChoosing}>
            <span className={s.whoAvatar} style={{ background: person?.color ?? 'var(--sten)' }}>
              {person?.name[0] ?? '?'}
            </span>
            {person?.name ?? 'Choose'}
          </button>
          <button type="button" className={s.upload} onClick={openUpload}>
            Upload
            {pending > 0 && <span className={s.badge}>{pending}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

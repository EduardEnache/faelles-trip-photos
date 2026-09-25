/**
 * screen 04: select & download. Mobile: fixed bottom bar
 * (replaces the tab bar). Desktop: floating pill.
 */
import { useEffect } from 'react';
import { formatBytes, plural } from '@shared/format';
import { DownloadIcon } from '@/lib/icons';
import { useLibrary } from '@/state/library';
import { useVisibleItems } from '@/features/library/useVisibleItems';
import { saveItems, saveMethodFor } from '@/lib/save';
import { useSelection } from './selectionStore';
import s from './SelectionBar.module.css';

export function SelectionBar({ wide }: { wide: boolean }) {
  const ids = useSelection((st) => st.ids);
  const exit = useSelection((st) => st.exit);
  const selectAll = useSelection((st) => st.selectAll);
  const clear = useSelection((st) => st.clear);
  const byId = useLibrary((st) => st.byId);
  const visible = useVisibleItems();

  const selected = ids.map((id) => byId[id]).filter((it): it is NonNullable<typeof it> => !!it);
  const n = selected.length;
  const totalBytes = selected.reduce((a, i) => a + i.bytes, 0);
  const allSelected = n > 0 && n === visible.length;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') exit();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exit]);

  const method = n ? saveMethodFor(selected, wide) : 'zip';
  const dlLabel = n <= 0
    ? 'Nothing selected'
    : method === 'share'
      ? (n > 1 ? `Save ${n} to Photos` : 'Save to Photos')
      : (n > 1 ? `Download ${n} as ZIP` : 'Download');

  return (
    <div className={[s.bar, wide && s.wide].filter(Boolean).join(' ')}>
      <div className={s.info}>
        <div className={s.count}>{n ? `${n} selected` : 'Tap to select'}</div>
        <div className={s.size}>{n ? `${formatBytes(totalBytes)} · original quality` : 'or long-press any photo'}</div>
      </div>
      <button
        type="button"
        className={s.selectAll}
        onClick={() => (allSelected ? clear() : selectAll(visible.map((i) => i.id)))}
      >
        {allSelected ? 'Deselect all' : 'Select all'}
      </button>
      {wide && (
        <button type="button" className={s.cancel} onClick={exit}>
          Cancel
        </button>
      )}
      <button
        type="button"
        className={s.download}
        disabled={!n}
        onClick={() => {
          void saveItems(selected, { wide });
          exit();
        }}
      >
        <DownloadIcon aria-hidden />
        {dlLabel}
        <span className="visually-hidden">
          {n ? plural(n, 'item selected', 'items selected') : ''}
        </span>
      </button>
    </div>
  );
}

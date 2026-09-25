/**
 * screen 04: select & download. Mobile: fixed bottom bar
 * (replaces the tab bar), two rows so nothing overlaps on narrow phones.
 * Desktop: floating pill.
 */
import { useEffect, useState } from 'react';
import { formatBytes, plural } from '@shared/format';
import { DownloadIcon, TrashIcon } from '@/lib/icons';
import { api } from '@/lib/api';
import { useLibrary } from '@/state/library';
import { useSession } from '@/state/session';
import { toast } from '@/state/toast';
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
  const me = useSession((st) => st.session?.person ?? null);
  const visible = useVisibleItems();
  const [removing, setRemoving] = useState(false);

  const selected = ids.map((id) => byId[id]).filter((it): it is NonNullable<typeof it> => !!it);
  const n = selected.length;
  const totalBytes = selected.reduce((a, i) => a + i.bytes, 0);
  const allSelected = n > 0 && n === visible.length;
  // Only the uploader may remove an item (the server enforces it too).
  const mine = selected.filter((i) => me != null && i.uploader === me);

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

  async function onRemove() {
    if (!mine.length || removing) return;
    const others = n - mine.length;
    const question =
      `Remove ${plural(mine.length, 'item')} from the album?` +
      (others ? `\n\n${plural(others, 'item')} uploaded by someone else will stay.` : '');
    if (!window.confirm(question)) return;
    setRemoving(true);
    const results = await Promise.allSettled(mine.map((it) => api.deleteItem(it.id)));
    const removed = mine.filter((_, i) => results[i]!.status === 'fulfilled');
    for (const it of removed) useLibrary.getState().remove(it.id);
    setRemoving(false);
    exit();
    const failed = mine.length - removed.length;
    if (!removed.length) {
      toast.show({ id: 'remove-many', title: 'Could not remove them', error: true });
      return;
    }
    toast.show({
      id: 'remove-many',
      title: `Removed ${plural(removed.length, 'item')}`,
      sub: failed ? `${failed} could not be removed` : undefined,
      durationMs: 8000,
      action: {
        label: 'Undo',
        onAction: async () => {
          const back = await Promise.allSettled(removed.map((it) => api.restoreItem(it.id)));
          for (const r of back) if (r.status === 'fulfilled') useLibrary.getState().upsert(r.value);
          if (back.some((r) => r.status === 'rejected')) {
            toast.show({ id: 'remove-undo-failed', title: 'Could not undo all of them', error: true });
          }
        },
      },
    });
  }

  const removeLabel = mine.length
    ? `Remove ${plural(mine.length, 'item')} from album`
    : n
      ? 'Only your own uploads can be removed'
      : 'Remove from album';

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
      <div className={s.actions}>
        <button
          type="button"
          className={s.remove}
          disabled={!mine.length || removing}
          aria-label={removeLabel}
          title={removeLabel}
          onClick={() => void onRemove()}
        >
          <TrashIcon aria-hidden />
        </button>
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
    </div>
  );
}

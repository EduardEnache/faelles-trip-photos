/**
 * one library grid tile. Long-press 480ms enters select mode;
 * tap toggles selection or opens the viewer; shift-click range-selects on
 * desktop. Tone colour shows through until the thumb decodes or while
 * derivatives are still processing.
 */
import { useRef, useState } from 'react';
import type { ItemDTO } from '@shared/api';
import { formatDuration } from '@shared/format';
import { StarIcon, PlayIcon, WarningIcon, PendingIcon, CheckIcon } from '@/lib/icons';
import { mediaUrl } from '@/lib/api';
import { openViewer } from '@/lib/router';
import { useIsSelected, useSelection } from '@/features/select/selectionStore';
import { useVisibleIndex } from './VisibleIndexContext';
import s from './Tile.module.css';

const LONG_PRESS_MS = 480;

export function Tile({ item, selectMode }: { item: ItemDTO; selectMode: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const selected = useIsSelected(item.id);
  const enter = useSelection((st) => st.enter);
  const toggle = useSelection((st) => st.toggle);
  const selectRange = useSelection((st) => st.selectRange);
  const { orderedIds, indexOf } = useVisibleIndex();

  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  function clearTimer() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    firedRef.current = false;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      if (!selectMode) enter(item.id);
      else toggle(item.id, indexOf.get(item.id));
      if (typeof navigator.vibrate === 'function') navigator.vibrate(10);
    }, LONG_PRESS_MS);
  }

  function onPointerUpOrLeave() {
    clearTimer();
  }

  function onClick(e: React.MouseEvent) {
    if (firedRef.current) {
      firedRef.current = false;
      return;
    }
    if (selectMode) {
      const idx = indexOf.get(item.id);
      if (e.shiftKey && idx != null) {
        const last = useSelection.getState().lastIndex;
        if (last != null) {
          selectRange(orderedIds, last, idx);
          return;
        }
      }
      toggle(item.id, idx);
    } else {
      openViewer(item.id);
    }
  }

  const label = `${item.kind === 'video' ? 'Video' : 'Photo'}${item.highlighted ? ', highlighted' : ''}, ${new Date(item.takenAt).toLocaleString()}`;

  return (
    <button
      type="button"
      className={[s.tile, selected && s.picked].filter(Boolean).join(' ')}
      style={{ background: item.tone ?? 'var(--taage)' }}
      aria-label={label}
      aria-pressed={selectMode ? selected : undefined}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUpOrLeave}
      onPointerLeave={onPointerUpOrLeave}
      onPointerCancel={onPointerUpOrLeave}
      onContextMenu={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {item.media.thumb && (
        <img
          className={[s.img, loaded && s.loaded].filter(Boolean).join(' ')}
          src={mediaUrl(item, 'thumb')}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
        />
      )}
      {item.status === 'processing' && !item.media.thumb && (
        <div className={s.processing} aria-hidden="true">
          <PendingIcon />
        </div>
      )}
      {item.status === 'failed' && (
        <div className={s.failed} aria-hidden="true">
          <WarningIcon />
        </div>
      )}
      {item.kind === 'video' && item.durationMs != null && (
        <div className={s.badge + ' ' + s.dur} aria-hidden="true">
          <PlayIcon weight="fill" size={8} />
          {formatDuration(item.durationMs)}
        </div>
      )}
      {item.highlighted && (
        <div className={s.badge + ' ' + s.star} aria-hidden="true">
          <StarIcon weight="fill" size={13} />
        </div>
      )}
      {selectMode && (
        <div className={[s.check, selected && s.on].filter(Boolean).join(' ')} aria-hidden="true">
          {selected && <CheckIcon size={12} weight="bold" />}
        </div>
      )}
    </button>
  );
}

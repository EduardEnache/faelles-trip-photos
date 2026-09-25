/**
 * screen 05: viewer. Dark, swipe/arrow-key navigation, hearts
 * with liker avatars, highlight star, save/original, own-item remove+undo.
 */
import { useEffect, useRef, useState } from 'react';
import { nearestPoi, personOf } from '@shared/trip';
import { formatBytes, formatCoords, formatDateLine } from '@shared/format';
import {
  CloseIcon,
  DownloadIcon,
  HeartIcon,
  MoreIcon,
  NextIcon,
  PendingIcon,
  PrevIcon,
  StarIcon,
  WarningIcon,
} from '@/lib/icons';
import { IconButton } from '@/ui';
import { api, mediaUrl } from '@/lib/api';
import { closeOverlay, openViewer } from '@/lib/router';
import { toast } from '@/state/toast';
import { useItem, useLibrary } from '@/state/library';
import { toggleHeart, toggleHighlight } from '@/state/library';
import { useMe } from '@/state/session';
import { saveItems, saveMethodFor } from '@/lib/save';
import { useVisibleItems } from '@/features/library/useVisibleItems';
import s from './Viewer.module.css';

const DATE_SOURCE_NOTE: Record<string, string> = {
  'exif-local': 'assumed Danish time',
  'video-utc': 'from UTC timestamp',
  file: 'date from file',
  upload: 'date unknown',
};

export function Viewer({ itemId, wide }: { itemId: string; wide: boolean }) {
  const item = useItem(itemId);
  const me = useMe();
  const visible = useVisibleItems();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragX = useRef<number | null>(null);

  const idx = visible.findIndex((i) => i.id === itemId);
  const canPrev = idx > 0;
  const canNext = idx >= 0 && idx < visible.length - 1;

  function nav(delta: 1 | -1) {
    const n = idx + delta;
    if (n < 0 || n >= visible.length) return;
    openViewer(visible[n]!.id, { replace: true });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeOverlay();
      else if (e.key === 'ArrowLeft') nav(-1);
      else if (e.key === 'ArrowRight') nav(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, visible]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  if (!item) {
    return (
      <div className={s.viewer}>
        <div className={s.header}>
          <IconButton label="Close" tone="dark" onClick={closeOverlay}>
            <CloseIcon />
          </IconButton>
        </div>
        <div className={s.placeholder}>This item isn&rsquo;t available any more.</div>
      </div>
    );
  }

  const uploader = personOf(item.uploader);
  const liked = me != null && item.hearts.includes(me);
  const isMine = me != null && item.uploader === me;

  const placeLabel =
    item.lat != null && item.lon != null
      ? (() => {
          const poi = nearestPoi(item.lat!, item.lon!);
          return poi ? `${poi.city.toUpperCase()} — ${poi.name}` : formatCoords(item.lat!, item.lon!);
        })()
      : null;

  const dims = item.width && item.height ? `${item.width}×${item.height}` : null;
  const exifBits = [
    item.fileName,
    item.fNumber != null ? `ƒ/${item.fNumber}` : null,
    item.exposure,
    item.iso != null ? `ISO ${item.iso}` : null,
    item.lens,
    item.lat != null ? formatCoords(item.lat, item.lon!) : null,
    DATE_SOURCE_NOTE[item.dateSource] ?? null,
  ].filter(Boolean);

  const method = saveMethodFor([item], wide);
  const saveLabel = method === 'share' ? 'Save to Photos' : 'Original';

  async function onRemove() {
    setMenuOpen(false);
    closeOverlay();
    try {
      await api.deleteItem(item!.id);
      useLibrary.getState().remove(item!.id);
      toast.show({
        id: `remove-${item!.id}`,
        title: 'Removed from album',
        durationMs: 8000,
        action: {
          label: 'Undo',
          onAction: async () => {
            try {
              const restored = await api.restoreItem(item!.id);
              useLibrary.getState().upsert(restored);
            } catch {
              toast.show({ id: 'remove-undo-failed', title: 'Could not undo', error: true });
            }
          },
        },
      });
    } catch {
      toast.show({ id: `remove-${item!.id}-err`, title: 'Could not remove item', error: true });
    }
  }

  return (
    <div className={s.viewer}>
      <div className={s.header}>
        <IconButton label="Close" tone="dark" onClick={closeOverlay}>
          <CloseIcon />
        </IconButton>
        <div className={s.headCenter}>
          <div className={s.dateLine}>{formatDateLine(item.takenAt)}</div>
          {placeLabel && <div className={s.place}>{placeLabel}</div>}
        </div>
        <div className={s.counter}>{idx >= 0 ? `${idx + 1} / ${visible.length}` : ''}</div>
      </div>

      <div
        className={s.stage}
        onPointerDown={(e) => {
          dragX.current = e.clientX;
        }}
        onPointerUp={(e) => {
          if (dragX.current == null) return;
          const dx = e.clientX - dragX.current;
          dragX.current = null;
          if (dx > 50) nav(-1);
          else if (dx < -50) nav(1);
        }}
      >
        <div className={s.media}>
          {item.kind === 'photo' ? (
            item.status === 'failed' ? (
              <div className={s.placeholder}>
                <WarningIcon size={28} aria-hidden />
                Couldn&rsquo;t make a preview. The original is safe.
              </div>
            ) : (
              <img src={mediaUrl(item, item.media.display ? 'display' : 'thumb')} alt="" />
            )
          ) : item.status === 'failed' ? (
            <div className={s.placeholder}>
              <WarningIcon size={28} aria-hidden />
              Couldn&rsquo;t make a preview. The original is safe.
            </div>
          ) : item.media.preview ? (
            <video controls playsInline poster={item.media.display ? mediaUrl(item, 'display') : undefined} src={mediaUrl(item, 'preview')} />
          ) : (
            <div className={s.placeholder}>
              <PendingIcon size={28} aria-hidden />
              Preparing video…
            </div>
          )}
        </div>
        {wide && (
          <>
            <button type="button" className={[s.navBtn, s.navPrev].join(' ')} disabled={!canPrev} aria-label="Previous" onClick={() => nav(-1)}>
              <PrevIcon />
            </button>
            <button type="button" className={[s.navBtn, s.navNext].join(' ')} disabled={!canNext} aria-label="Next" onClick={() => nav(1)}>
              <NextIcon />
            </button>
          </>
        )}
      </div>

      <div className={s.footer}>
        <div className={s.who}>
          <span className={s.avatar} style={{ background: uploader.color }} aria-hidden="true">
            {uploader.name[0]}
          </span>
          <div className={s.whoText}>
            <div className={s.upName}>Uploaded by {uploader.name}</div>
            <div className={s.fileLine}>
              {item.camera ?? 'Unknown camera'}
              {dims ? ` · ${dims}` : ''}
            </div>
            <div className={s.exifLine}>{exifBits.join(' · ')}</div>
          </div>
        </div>
        <div className={s.actions}>
          <button
            type="button"
            className={[s.likeBtn, liked && s.on].filter(Boolean).join(' ')}
            aria-pressed={liked}
            aria-label={liked ? 'Remove heart' : 'Give a heart'}
            disabled={!me}
            onClick={() => me && void toggleHeart(item, me)}
          >
            <HeartIcon weight={liked ? 'fill' : 'regular'} aria-hidden />
            <span className={s.likers}>
              {item.hearts.map((id) => (
                <span key={id} className={s.likerAvatar} style={{ background: personOf(id).color }} aria-hidden="true">
                  {personOf(id).name[0]}
                </span>
              ))}
            </span>
          </button>
          <button
            type="button"
            className={[s.circleBtn, item.highlighted && s.on].filter(Boolean).join(' ')}
            aria-pressed={item.highlighted}
            aria-label={item.highlighted ? 'Remove highlight' : 'Highlight'}
            disabled={!me}
            onClick={() => me && void toggleHighlight(item, me)}
          >
            <StarIcon weight={item.highlighted ? 'fill' : 'regular'} aria-hidden />
          </button>
          <button type="button" className={s.save} onClick={() => void saveItems([item], { wide })}>
            <DownloadIcon aria-hidden />
            {saveLabel}
            <span className={s.saveSize}>{formatBytes(item.bytes)}</span>
          </button>
          {isMine && (
            <div ref={menuRef}>
              <IconButton label="More" tone="dark" onClick={() => setMenuOpen((v) => !v)}>
                <MoreIcon />
              </IconButton>
              {menuOpen && (
                <div className={s.menu} role="menu">
                  <button type="button" role="menuitem" className={s.menuItem} onClick={onRemove}>
                    Remove from album
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

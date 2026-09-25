/**
 * hero memory card at the top of the library (PLAN.md §3).
 * Renders null when no memory qualifies yet (no placeholder / fake card).
 */
import type { FeaturedMemoryCardProps } from '@/slots';
import { formatDuration } from '@shared/format';
import { mediaUrl } from '@/lib/api';
import { PlayIcon } from '@/lib/icons';
import { openMemory } from '@/lib/router';
import { prepareEngineForGesture } from './audio/handoff';
import { isNewMemory, markMemoryOpened } from './newBadge';
import { useFeaturedMemory } from './useMemories';
import s from './FeaturedMemoryCard.module.css';

export function FeaturedMemoryCard(_props: FeaturedMemoryCardProps) {
  const memory = useFeaturedMemory();
  if (!memory) return null;
  const cover = memory.slides[0];
  const isNew = isNewMemory(memory);

  function open() {
    if (!memory) return;
    prepareEngineForGesture(memory.id, memory.mood);
    markMemoryOpened(memory);
    openMemory(memory.id);
  }

  return (
    <button type="button" className={s.card} onClick={open}>
      {cover ? (
        <img
          className={s.photo}
          src={mediaUrl(cover, 'display')}
          alt=""
          loading="eager"
          decoding="async"
          style={{ background: cover.tone ?? 'var(--havglas)' }}
        />
      ) : null}
      <div className={s.scrim} aria-hidden="true" />
      <div className={s.body}>
        <div className={s.text}>
          <div className={s.eyebrow}>
            {isNew ? 'NEW MEMORY' : 'MEMORY'} &middot; {formatDuration(memory.lengthMs)}
          </div>
          <div className={s.title}>{memory.title}</div>
          <div className={s.sub}>{memory.sub}</div>
        </div>
        <span className={s.play} aria-hidden="true">
          <PlayIcon weight="fill" size={18} />
        </span>
      </div>
    </button>
  );
}

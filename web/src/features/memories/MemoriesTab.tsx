/** Memories tab: grid of the memories that currently qualify (PLAN.md §3). */
import { formatDuration } from '@shared/format';
import { plural } from '@shared/format';
import { moodOf } from './audio/moods';
import { mediaUrl } from '@/lib/api';
import { MusicIcon } from '@/lib/icons';
import { openMemory } from '@/lib/router';
import { useItems } from '@/state/library';
import { prepareEngineForGesture } from './audio/handoff';
import { markMemoryOpened } from './newBadge';
import { useMemories } from './useMemories';
import s from './MemoriesTab.module.css';

export default function MemoriesTab() {
  const memories = useMemories();
  const items = useItems();

  if (memories.length === 0) {
    const ready = items.filter((it) => it.status === 'ready');
    const days = new Set(ready.map((it) => it.day)).size;
    return (
      <section aria-label="Memories" className={s.wrap}>
        <Hero />
        <p className={s.empty}>
          Memories make themselves once there are at least 8 photos from two days. Right now:{' '}
          {plural(ready.length, 'photo')} from {plural(days, 'day')}.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Memories" className={s.wrap}>
      <Hero />
      <div className={s.grid}>
        {memories.map((m) => {
          const cover = m.slides[0];
          const mood = moodOf(m.mood);
          const open = () => {
            prepareEngineForGesture(m.id, m.mood);
            markMemoryOpened(m);
            openMemory(m.id);
          };
          return (
            <button key={m.id} type="button" className={s.card} onClick={open}>
              {cover ? (
                <img
                  className={s.photo}
                  src={mediaUrl(cover, 'display')}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ background: cover.tone ?? 'var(--havglas)' }}
                />
              ) : null}
              <div className={s.scrim} aria-hidden="true" />
              <div className={s.len}>{formatDuration(m.lengthMs)}</div>
              <div className={s.body}>
                <div className={s.cardTitle}>{m.title}</div>
                <div className={s.cardSub}>{m.sub}</div>
                <div className={s.track}>
                  <MusicIcon aria-hidden="true" size={13} />
                  {mood.label} &middot; generated ambient
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Hero() {
  return (
    <div className={s.hero}>
      <div className={s.eyebrow}>MADE FOR YOU &middot; UPDATED AFTER EACH UPLOAD</div>
      <h1 className={s.title}>Memories</h1>
      <p className={s.intro}>
        Short films assembled from your photos and clips, with calm ambient sound generated for each one. Tap one to
        watch, change the mood, or save the moments in it.
      </p>
    </div>
  );
}

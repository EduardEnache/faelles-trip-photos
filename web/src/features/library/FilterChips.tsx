/**
 * filter chip rail: All, Highlights, Videos, then one per person.
 * Tapping the active chip clears it (handled in filterStore).
 */
import { PEOPLE } from '@shared/trip';
import type { ItemDTO } from '@shared/api';
import { useFilterStore, type FilterKey } from './filterStore';
import s from './FilterChips.module.css';

export function FilterChips({ items }: { items: ItemDTO[] }) {
  const filter = useFilterStore((st) => st.filter);
  const set = useFilterStore((st) => st.set);

  const videoCount = items.filter((i) => i.kind === 'video').length;
  const favCount = items.filter((i) => i.highlighted).length;

  const defs: { key: FilterKey; label: string; count: number; color?: string; initial?: string }[] = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'fav', label: 'Highlights', count: favCount },
    { key: 'video', label: 'Videos', count: videoCount },
    ...PEOPLE.map((p) => ({
      key: p.id as FilterKey,
      label: p.name,
      count: items.filter((i) => i.uploader === p.id).length,
      color: p.color,
      initial: p.name[0],
    })),
  ];

  return (
    <div className={s.rail + ' no-scrollbar'} role="tablist" aria-label="Filter the library">
      {defs.map((c) => {
        const active = filter === c.key;
        return (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={[s.chip, active && s.active, c.color && s.withAvatar].filter(Boolean).join(' ')}
            onClick={() => set(c.key)}
          >
            {c.color && (
              <span className={s.avatar} style={{ background: c.color }} aria-hidden="true">
                {c.initial}
              </span>
            )}
            {c.label}
            <span className={s.count}>{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}

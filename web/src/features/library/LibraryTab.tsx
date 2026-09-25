/**
 * screen 03: library. Hero, featured memory card (slot), filter
 * chips, sticky day sections, grid, footer. Consumes route.day (one-shot
 * scroll target from Places/Memories).
 */
import { useEffect, useMemo } from 'react';
import { formatBytes } from '@shared/format';
import { SECTION_ORDER } from '@shared/trip';
import { useLibrary, useItemsByDay } from '@/state/library';
import { clearDayTarget, useRoute } from '@/lib/router';
import { useWide } from '@/lib/useMedia';
import { FeaturedMemoryCard } from '@/slots';
import { useSelection } from '@/features/select/selectionStore';
import { useVisibleItems } from './useVisibleItems';
import { Hero } from './Hero';
import { FilterChips } from './FilterChips';
import { DaySection } from './DaySection';
import s from './LibraryTab.module.css';

export function LibraryTab() {
  const wide = useWide();
  const route = useRoute();
  const status = useLibrary((st) => st.status);
  const allItems = useLibrary((st) => st.items);
  const selectMode = useSelection((st) => st.active);
  const visible = useVisibleItems();
  const byDay = useItemsByDay(visible);

  const orderedIds = useMemo(() => visible.map((i) => i.id), [visible]);
  const indexOf = useMemo(() => {
    const m = new Map<string, number>();
    orderedIds.forEach((id, i) => m.set(id, i));
    return m;
  }, [orderedIds]);

  const sections = SECTION_ORDER.filter((k) => byDay.has(k));

  useEffect(() => {
    if (!route.day) return;
    const el = document.getElementById(`day-${route.day}`);
    if (el) {
      const offset = wide ? 68 + 8 : 56 + 8;
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    clearDayTarget();
  }, [route.day, wide]);

  const totalBytes = allItems.reduce((a, i) => a + i.bytes, 0);

  return (
    <div className={s.wrap}>
      <Hero items={allItems} wide={wide} />
      {!selectMode && (
        <div className={s.featured}>
          <FeaturedMemoryCard />
        </div>
      )}
      <FilterChips items={allItems} />
      {sections.map((day) => (
        <DaySection
          key={day}
          day={day}
          items={byDay.get(day)!}
          selectMode={selectMode}
          orderedIds={orderedIds}
          indexOf={indexOf}
        />
      ))}
      {status === 'ready' && sections.length === 0 && (
        <div className={s.empty}>
          {allItems.length === 0 ? (
            <>
              <div className={s.emptyBig}>Nothing here yet.</div>
              <div>The first photo you upload lands right here.</div>
            </>
          ) : (
            <div>No items match this filter.</div>
          )}
        </div>
      )}
      {status === 'error' && (
        <div className={s.empty}>
          <div>Could not load the library. Check your connection and reload.</div>
        </div>
      )}
      {allItems.length > 0 && (
        <div className={s.footer}>
          {allItems.length} {allItems.length === 1 ? 'ORIGINAL' : 'ORIGINALS'} · {formatBytes(totalBytes).toUpperCase()} · STORED AT HOME
        </div>
      )}
    </div>
  );
}

/**
 * library hero: computed meta line, title, summary, and the
 * Select / Download all actions (desktop shows Select inline; mobile's is
 * in the top bar).
 */
import { useMemo } from 'react';
import type { ItemDTO } from '@shared/api';
import { cityOf, DAYS, TRIP } from '@shared/trip';
import { formatBytes, plural } from '@shared/format';
import { DownloadIcon } from '@/lib/icons';
import { downloadAll } from '@/lib/save';
import { useSelection } from '@/features/select/selectionStore';
import { tripDateRange, numberWord } from '@/app/copy';
import s from './Hero.module.css';

export function Hero({ items, wide }: { items: ItemDTO[]; wide: boolean }) {
  const selectMode = useSelection((st) => st.active);
  const enterSelect = useSelection((st) => st.enterEmpty);
  const exitSelect = useSelection((st) => st.exit);

  const stats = useMemo(() => {
    const dayCount = DAYS.filter((d) => items.some((i) => i.day === d.key)).length;
    const cities = new Set<string>();
    for (const it of items) {
      if (it.lat != null && it.lon != null) {
        const c = cityOf(it.lat, it.lon);
        if (c) cities.add(c);
      }
    }
    const photos = items.filter((i) => i.kind === 'photo').length;
    const videos = items.length - photos;
    const totalBytes = items.reduce((a, i) => a + i.bytes, 0);
    return { dayCount, placeCount: cities.size, photos, videos, totalBytes };
  }, [items]);

  const metaParts = [tripDateRange()];
  if (stats.dayCount > 0) metaParts.push(plural(stats.dayCount, 'day'));
  if (stats.placeCount > 0) metaParts.push(plural(stats.placeCount, 'place'));

  const summary = items.length
    ? `${numberWord(4)} of us, ${plural(stats.photos, 'photo')} and ${plural(stats.videos, 'video')}.`
    : 'Nothing uploaded yet.';

  return (
    <div className={s.hero}>
      <div className={s.meta}>{metaParts.join(' · ').toUpperCase()}</div>
      <div className={s.row}>
        <div className={s.titleWrap}>
          <div className={s.title}>{TRIP.shortTitle}</div>
          <div className={s.summary}>{summary}</div>
        </div>
        <div className={s.actions}>
          {wide && (
            <button
              type="button"
              className={[s.select, selectMode && s.active].filter(Boolean).join(' ')}
              onClick={() => (selectMode ? exitSelect() : enterSelect())}
              disabled={!items.length && !selectMode}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </button>
          )}
          <button type="button" className={s.dlAll} disabled={!items.length} onClick={() => void downloadAll()}>
            <DownloadIcon aria-hidden />
            {wide ? 'Download all' : 'Save all to Photos'}
            <span className={s.dlSize}>{formatBytes(stats.totalBytes)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

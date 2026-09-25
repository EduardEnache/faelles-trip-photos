/**
 * one library section (a trip day, or Before/After the trip).
 * Sticky header with the day caption slot, GPS-derived place subtitle,
 * per-day select, and the tile grid.
 */
import { useMemo } from 'react';
import type { ItemDTO } from '@shared/api';
import { type DayKey, deriveDay, sectionTitle, tripDay } from '@shared/trip';
import { plural } from '@shared/format';
import { DayCaption } from '@/slots';
import { useSelection } from '@/features/select/selectionStore';
import { VisibleIndexContext } from './VisibleIndexContext';
import { Tile } from './Tile';
import s from './DaySection.module.css';

export function DaySection({
  day,
  items,
  selectMode,
  orderedIds,
  indexOf,
}: {
  day: DayKey;
  items: ItemDTO[];
  selectMode: boolean;
  orderedIds: string[];
  indexOf: Map<string, number>;
}) {
  const ids = useSelection((st) => st.ids);
  const setMany = useSelection((st) => st.setMany);
  const trip = tripDay(day);

  const geo = useMemo(() => {
    if (!trip) return null;
    return deriveDay(items.map((i) => ({ lat: i.lat, lon: i.lon, takenAt: i.takenAt })));
  }, [trip, items]);

  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const allSelected = itemIds.length > 0 && itemIds.every((id) => ids.includes(id));

  const ctx = useMemo(() => ({ orderedIds, indexOf }), [orderedIds, indexOf]);

  return (
    <div id={`day-${day}`} className={s.section}>
      <div className={s.header}>
        <div className={s.headRow}>
          <div className={s.headTop}>
            {trip && <span className={s.dayNum}>DAY {trip.n}</span>}
            <span className={s.dayTitle}>{trip ? `${trip.wd} ${trip.date}` : sectionTitle(day)}</span>
            {trip && geo && <span className={s.place}>{[geo.city, ...geo.spots].join(' · ')}</span>}
            {trip && geo && <span className={s.geoTag} title="Named from photo GPS and timestamps">GPS · {geo.gpsPoints} PTS</span>}
          </div>
          {selectMode ? (
            <button type="button" className={s.selectDay} onClick={() => setMany(itemIds, !allSelected)}>
              {allSelected ? 'Deselect' : 'Select day'}
            </button>
          ) : (
            <span className={s.count}>{plural(items.length, 'item')}</span>
          )}
        </div>
        {trip && (
          <div className={s.caption}>
            <DayCaption day={day} editable={!selectMode} />
          </div>
        )}
      </div>
      <div className={s.grid} style={{ containIntrinsicSize: 'auto 600px', contentVisibility: 'auto' }}>
        <VisibleIndexContext.Provider value={ctx}>
          {items.map((item) => (
            <Tile key={item.id} item={item} selectMode={selectMode} />
          ))}
        </VisibleIndexContext.Provider>
      </div>
    </div>
  );
}

/**
 * Places tab: a recoloured MapLibre map plus a grouped list
 * (PLAN.md §4). The map library is lazy-loaded (`map.ts`) so it never
 * bloats the main bundle, and any failure (offline, blocked tiles) degrades
 * to the list alone with a quiet note.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { mediaUrl } from '@/lib/api';
import { goToDay, openViewer } from '@/lib/router';
import { useWide } from '@/lib/useMedia';
import { useItems } from '@/state/library';
import { addItemLayers, fitToItems, loadMapLibre, OPENFREEMAP_STYLE_URL, recolorStyle, withTimeout } from './map';
import { dayRangeLabel, groupPlaces, type PlaceGroup } from './placeGroups';
import s from './PlacesTab.module.css';

type MapStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export default function PlacesTab() {
  const items = useItems();
  const wide = useWide();
  const groups = useMemo(() => groupPlaces(items), [items]);
  const hasGps = groups.length > 0;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);
  const [mapStatus, setMapStatus] = useState<MapStatus>('idle');

  useEffect(() => {
    if (!hasGps || !containerRef.current) return undefined;
    let cancelled = false;
    setMapStatus('loading');

    void (async () => {
      try {
        const mgl = await withTimeout(loadMapLibre(), 8000);
        if (cancelled || !containerRef.current) return;
        const map = new mgl.Map({
          container: containerRef.current,
          style: OPENFREEMAP_STYLE_URL,
          center: [12.57, 55.68],
          zoom: 9,
          attributionControl: false,
          cooperativeGestures: !wide,
        });
        mapRef.current = map;
        await withTimeout(
          new Promise<void>((resolve, reject) => {
            map.once('load', () => resolve());
            map.once('error', (e) => reject(e.error ?? new Error('map failed to load')));
          }),
          8000,
        );
        if (cancelled) return;
        recolorStyle(map);
        addItemLayers(map, items);
        fitToItems(map, items);
        map.on('click', 'faelles-point', (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          if (id) openViewer(id);
        });
        map.on('click', 'faelles-clusters', (e) => {
          const feature = e.features?.[0];
          const clusterId = feature?.properties?.cluster_id as number | undefined;
          const source = map.getSource('faelles-items') as maplibregl.GeoJSONSource | undefined;
          if (clusterId == null || !source || feature?.geometry.type !== 'Point') return;
          void source.getClusterExpansionZoom(clusterId).then((zoom) => {
            map.easeTo({ center: feature.geometry.type === 'Point' ? (feature.geometry.coordinates as [number, number]) : undefined, zoom });
          });
        });
        map.on('mouseenter', 'faelles-point', () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', 'faelles-point', () => (map.getCanvas().style.cursor = ''));
        map.on('mouseenter', 'faelles-clusters', () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', 'faelles-clusters', () => (map.getCanvas().style.cursor = ''));
        if (!cancelled) setMapStatus('ready');
      } catch {
        if (!cancelled) setMapStatus('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGps]);

  if (!hasGps) {
    return (
      <section aria-label="Places" className={s.wrap}>
        <Hero />
        <p className={s.empty}>No location data yet. Photos taken with location on show up here.</p>
      </section>
    );
  }

  return (
    <section aria-label="Places" className={s.wrap}>
      <Hero />
      <div className={s.mapBox}>
        <div ref={containerRef} className={s.mapEl} role="region" aria-label="Map of places photos were taken" />
        {mapStatus === 'unavailable' ? (
          <div className={s.mapFallback}>
            <div className={s.mapFallbackText}>MAP UNAVAILABLE OFFLINE</div>
          </div>
        ) : null}
      </div>
      {mapStatus === 'ready' ? <div className={s.attribution}>&copy; OpenFreeMap &copy; OpenMapTiles &copy; OpenStreetMap</div> : null}
      <div className={s.list}>
        {groups.map((g, i) => (
          <PlaceRow key={g.key} group={g} index={i} wide={wide} />
        ))}
      </div>
    </section>
  );
}

function Hero() {
  return (
    <div className={s.hero}>
      <div className={s.eyebrow}>FROM PHOTO LOCATION DATA</div>
      <h1 className={s.title}>Places</h1>
    </div>
  );
}

function PlaceRow({ group, index, wide }: { group: PlaceGroup; index: number; wide: boolean }) {
  const count = group.items.length;
  const thumbCount = wide ? 4 : 2;
  const thumbs = group.items.slice(0, thumbCount);
  const meta = `${dayRangeLabel(group.days)} · ${count} item${count === 1 ? '' : 's'}`;
  return (
    <button type="button" className={s.row} onClick={() => goToDay(group.days[0]!)}>
      <span className={s.num}>{String(index + 1).padStart(2, '0')}</span>
      <span className={s.info}>
        <span className={s.name}>{group.name}</span>
        <span className={s.meta}>{meta}</span>
      </span>
      <span className={s.thumbs}>
        {thumbs.map((it) => (
          <img key={it.id} className={s.thumb} src={mediaUrl(it, 'thumb')} alt="" loading="lazy" decoding="async" style={{ background: it.tone ?? 'var(--taage)' }} />
        ))}
      </span>
    </button>
  );
}

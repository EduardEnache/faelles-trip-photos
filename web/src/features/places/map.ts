/**
 * MapLibre setup for the Places tab (PLAN.md §4). Loaded via
 * dynamic import only from PlacesTab, so `maplibre-gl` never lands in the
 * main bundle. Recolours the OpenFreeMap "positron" vector style to the
 * Kalk/Fjord palette at runtime and degrades quietly (never throws) when
 * tiles can't be reached.
 */
import type { FeatureCollection, Point } from 'geojson';
import type { ItemDTO } from '@shared/api';

export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
export const CLUSTER_SOURCE_ID = 'faelles-items';

let mglPromise: Promise<typeof import('maplibre-gl')> | null = null;

/** Lazy singleton import: the network fetch + parse only happens once per session. */
export function loadMapLibre(): Promise<typeof import('maplibre-gl')> {
  if (!mglPromise) mglPromise = import('maplibre-gl');
  return mglPromise;
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

type MLMap = import('maplibre-gl').Map;
type MLLayer = { id: string; type: string };

/** Best-effort recolour of every known layer id to the Kalk/Fjord palette. Never throws. */
export function recolorStyle(map: MLMap): void {
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const layer of style.layers as MLLayer[]) {
    try {
      applyLayerColor(map, layer);
    } catch {
      /* an unfamiliar layer from a style update: skip it, keep the map usable */
    }
  }
}

function applyLayerColor(map: MLMap, layer: MLLayer): void {
  const id = layer.id;
  if (id === 'background') {
    map.setPaintProperty(id, 'background-color', '#F4F2EE');
    return;
  }
  if (id === 'park') {
    map.setPaintProperty(id, 'fill-color', '#E9E8E0');
    return;
  }
  if (id === 'water') {
    map.setPaintProperty(id, 'fill-color', '#DCE3E6');
    return;
  }
  if (id.startsWith('waterway')) {
    if (layer.type === 'line') map.setPaintProperty(id, 'line-color', '#C9D3D7');
    return;
  }
  if (id.startsWith('landcover') || id.startsWith('landuse')) {
    map.setPaintProperty(id, 'fill-color', '#EFEDE7');
    return;
  }
  if (id === 'building') {
    map.setPaintProperty(id, 'fill-color', '#EDEAE3');
    map.setPaintProperty(id, 'fill-opacity', 0.55);
    return;
  }
  if (id.startsWith('boundary')) {
    map.setLayoutProperty(id, 'visibility', 'none');
    return;
  }
  if (id.startsWith('highway-shield') || id === 'road_shield_us') {
    map.setLayoutProperty(id, 'visibility', 'none');
    return;
  }
  if (layer.type === 'line' && (id.startsWith('highway') || id.startsWith('railway') || id.startsWith('aeroway') || id.startsWith('road_'))) {
    map.setPaintProperty(id, 'line-color', id.includes('motorway') || id.includes('major') ? '#D6D2CA' : '#E6E3DD');
    return;
  }
  if (layer.type === 'fill' && (id.startsWith('aeroway') || id.startsWith('road_'))) {
    map.setPaintProperty(id, 'fill-color', '#E6E3DD');
    return;
  }
  if (layer.type === 'symbol' && (id.startsWith('label_') || id.startsWith('highway-name') || id.startsWith('water_name') || id === 'airport')) {
    map.setPaintProperty(id, 'text-color', '#6F6D68');
    map.setPaintProperty(id, 'text-halo-color', '#F4F2EE');
    return;
  }
}

export interface ItemFeatureProps {
  id: string;
}

export function itemsToGeoJson(items: readonly ItemDTO[]): FeatureCollection<Point, ItemFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: items
      .filter((it) => it.lat != null && it.lon != null && it.status !== 'failed')
      .map((it) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [it.lon!, it.lat!] },
        properties: { id: it.id },
      })),
  };
}

/** Adds the clustered point source + cluster/point layers, styled to the palette. */
export function addItemLayers(map: MLMap, items: readonly ItemDTO[]): void {
  const data = itemsToGeoJson(items);
  if (map.getSource(CLUSTER_SOURCE_ID)) {
    (map.getSource(CLUSTER_SOURCE_ID) as maplibregl.GeoJSONSource).setData(data);
    return;
  }
  map.addSource(CLUSTER_SOURCE_ID, {
    type: 'geojson',
    data,
    cluster: true,
    clusterRadius: 40,
  });
  map.addLayer({
    id: 'faelles-clusters',
    type: 'circle',
    source: CLUSTER_SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#1D2125',
      'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 22],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FBFAF8',
    },
  });
  map.addLayer({
    id: 'faelles-cluster-count',
    type: 'symbol',
    source: CLUSTER_SOURCE_ID,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
    },
    paint: { 'text-color': '#FBFAF8' },
  });
  map.addLayer({
    id: 'faelles-point',
    type: 'circle',
    source: CLUSTER_SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#2E4A5E',
      'circle-radius': 5,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FBFAF8',
    },
  });
}

export function fitToItems(map: MLMap, items: readonly ItemDTO[]): void {
  const pts = items.filter((it) => it.lat != null && it.lon != null);
  if (pts.length === 0) return;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const it of pts) {
    minLat = Math.min(minLat, it.lat!);
    maxLat = Math.max(maxLat, it.lat!);
    minLon = Math.min(minLon, it.lon!);
    maxLon = Math.max(maxLon, it.lon!);
  }
  if (minLat === maxLat && minLon === maxLon) {
    map.jumpTo({ center: [minLon, minLat], zoom: 12 });
    return;
  }
  map.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
    { padding: 32, duration: 0 },
  );
}

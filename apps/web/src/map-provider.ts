/// <reference types="vite/client" />
import { setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);

const env = import.meta.env;
const server = 'https://tiles.openfreemap.org/styles/';

export function mapStyles(light: boolean) {
  return [...new Set([
    (light ? env.VITE_MAP_LIGHT_STYLE_URL : env.VITE_MAP_DARK_STYLE_URL) || env.VITE_MAP_STYLE_URL ||
      server + (light ? 'liberty' : 'dark'),
    env.VITE_MAP_FALLBACK_STYLE_URL,
  ].filter((url): url is string => !!url)), 'offline'];
}

export function offlineStyle(light: boolean): StyleSpecification {
  return {
    version: 8,
    sources: { countries: { type: 'geojson', data: '/countries.geojson', attribution: 'Natural Earth' } },
    layers: [
      { id: 'water', type: 'background', paint: { 'background-color': light ? '#bfd6e5' : '#101f2c' } },
      { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': light ? '#eceadf' : '#243441' } },
      { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': light ? '#9fa9ab' : '#557080' } },
    ],
  };
}

export function resourceName(value: string) {
  const match = value.match(/https?:\/\/[^\s)]+/);
  if (!match) return 'MapLibre';
  try {
    const url = new URL(match[0]);
    return url.hostname;
  } catch { return 'MapLibre'; }
}

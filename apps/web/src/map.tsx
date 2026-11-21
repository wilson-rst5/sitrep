import { useEffect, useRef, useState } from 'react';
import * as maplibre from 'maplibre-gl';
import { type GeoJSONSource, type Map as MapInstance } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Incident, Location } from './types';

const env = (import.meta as ImportMeta & { env: { VITE_MAP_STYLE_URL?: string } }).env;
const customStyle = env.VITE_MAP_STYLE_URL;
const empty = { type: 'FeatureCollection' as const, features: [] };
const colors = ['#9aa5b6', '#6caeff', '#f8cc70', '#ff9b70', '#ff6a76'];

function ring(location: Location, worldCopy: number): number[][] {
  const rad = Math.PI / 180;
  const latitude = location.latitude * rad;
  const longitude = location.longitude * rad;
  const distance = location.radius / 6371.0088;
  return Array.from({ length: 129 }, (_, index) => {
    const bearing = Math.PI * 2 * (index % 128) / 128;
    const lat = Math.asin(Math.sin(latitude) * Math.cos(distance) +
      Math.cos(latitude) * Math.sin(distance) * Math.cos(bearing));
    const lon = longitude + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude),
      Math.cos(distance) - Math.sin(latitude) * Math.sin(lat));
    return [lon / rad + 360 * worldCopy, lat / rad];
  });
}

export function OperationalMap({ location, incidents, select, global, label }: {
  location?: Location; incidents: Incident[]; select: (event: Incident) => void;
  global: boolean; label: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const selection = useRef({ incidents, select });
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => { selection.current = { incidents, select }; }, [incidents, select]);

  useEffect(() => {
    if (!element.current) return;
    let instance: MapInstance;
    try {
      instance = new maplibre.Map({
        container: element.current,
        style: customStyle || {
          version: 8,
          sources: {
            countries: { type: 'geojson', data: '/countries.geojson', attribution: 'Made with Natural Earth' },
          },
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#0e1b29' } },
            { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': '#192a36' } },
            { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': '#385564', 'line-width': 1 } },
          ],
        },
        center: [0, 20], zoom: 1.4, maxZoom: 18,
      });
    } catch {
      setFailure('This browser could not start the map. The incident list is still available.');
      return;
    }
    map.current = instance;
    instance.addControl(new maplibre.NavigationControl({ showCompass: true }), 'top-right');
    instance.addControl(new maplibre.FullscreenControl(), 'top-right');
    instance.on('error', (event) => {
      const sourceId = 'sourceId' in event ? event.sourceId : undefined;
      if (sourceId === 'countries' || (!instance.isStyleLoaded() && !sourceId)) {
        setFailure('Basemap data unavailable. Check the map configuration.');
      }
    });
    instance.on('load', () => {
      instance.addSource('range', { type: 'geojson', data: empty });
      instance.addLayer({ id: 'range-area', source: 'range', type: 'fill',
        paint: { 'fill-color': '#43bdda', 'fill-opacity': 0.1 } });
      instance.addLayer({ id: 'range-outline', source: 'range', type: 'line',
        paint: { 'line-color': '#43bdda', 'line-width': 2, 'line-dasharray': [3, 2] } });
      instance.addSource('incidents', { type: 'geojson', cluster: true, clusterRadius: 42, data: empty });
      instance.addLayer({ id: 'event-clusters', source: 'incidents', type: 'circle',
        filter: ['has', 'point_count'],
        paint: { 'circle-radius': 13, 'circle-color': '#19495b', 'circle-stroke-color': '#7bd5e7', 'circle-stroke-width': 2 } });
      instance.addLayer({ id: 'event-points', source: 'incidents', type: 'circle',
        filter: ['!', ['has', 'point_count']],
        paint: { 'circle-radius': 6, 'circle-stroke-color': '#0a111b', 'circle-stroke-width': 2,
          'circle-color': ['match', ['get', 'severity'], 1, colors[1], 2, colors[2],
            3, colors[3], 4, colors[4], colors[0]] } });
      instance.on('click', 'event-points', (event) => {
        const key = event.features?.[0]?.properties?.key;
        const selected = selection.current.incidents.find((item) => incidentKey(item) === key);
        if (selected) selection.current.select(selected);
      });
      instance.on('click', 'event-clusters', async (event) => {
        const id = event.features?.[0]?.properties?.cluster_id as number | undefined;
        if (id === undefined) return;
        const zoom = await (instance.getSource('incidents') as GeoJSONSource).getClusterExpansionZoom(id);
        if (map.current === instance) instance.easeTo({ center: event.lngLat, zoom });
      });
      setReady(true);
    });
    return () => { instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource('range') as GeoJSONSource;
    source.setData(!location || global ? empty : {
      type: 'FeatureCollection',
      features: [-1, 0, 1].map(copy => ({ type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [ring(location, copy)] } })),
    });
    if (location && !global) map.current.jumpTo({
      center: [location.longitude, location.latitude],
      zoom: Math.max(2, Math.min(14, Math.log2(7500 / location.radius))),
    });
    else map.current.jumpTo({ center: [0, 20], zoom: 1.4 });
  }, [ready, location, global]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource('incidents') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: incidents.flatMap((event) => event.latitude === null || event.longitude === null ? [] : [{
        type: 'Feature', properties: { key: incidentKey(event), severity: event.severity },
        geometry: { type: 'Point', coordinates: [event.longitude, event.latitude] },
      }]),
    });
  }, [ready, incidents]);

  return <div className="map-frame">
    <div className="map-canvas" ref={element} role="region" aria-label={label} />
    {failure && <p className="map-note">{failure}</p>}
  </div>;
}

export const incidentKey = (event: Incident) => event.provider + ':' + event.external_id;

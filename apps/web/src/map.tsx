import { useEffect, useRef, useState } from 'react';
import * as maplibre from 'maplibre-gl';
import { type GeoJSONSource, type Map as MapInstance } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Incident } from './types';
import { mapStyles, offlineStyle, resourceName } from './map-provider';

export type Point = { latitude: number; longitude: number };
type MapArea = Point & { radius: number };
const empty = { type: 'FeatureCollection' as const, features: [] };
const colors = ['#9aa5b6', '#6caeff', '#f8cc70', '#ff9b70', '#ff6a76'];

function ring(location: MapArea, worldCopy: number): number[][] {
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

export function OperationalMap({ location, incidents, select, global, label, pick, selectedId, reduceMotion }: {
  location?: MapArea; incidents: Incident[]; select?: (event: Incident) => void;
  global: boolean; label: string; pick?: (point: Point) => void; selectedId?: string; reduceMotion?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const selection = useRef({ incidents, select, pick });
  const marker = useRef<maplibre.Marker | null>(null);
  const camera = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const [styleIndex, setStyleIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [diagnostic, setDiagnostic] = useState('');
  const light = !!pick;
  const styles = mapStyles(light);
  const style = styles[styleIndex];
  const [ready, setReady] = useState(false);
  const [settled, setSettled] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => { selection.current = { incidents, select, pick }; }, [incidents, select, pick]);

  useEffect(() => {
    if (!element.current) return;
    setReady(false);
    setSettled(false);
    setFailure('');
    let instance: MapInstance;
    try {
      instance = new maplibre.Map({
        container: element.current,
        style: style === 'offline' ? offlineStyle(light) : style,
        center: camera.current?.center ?? [0, 20],
        zoom: camera.current?.zoom ?? 1.4,
        maxZoom: 18,
        attributionControl: { compact: false },
      });
    } catch {
      setFailure('This browser could not start the map. The incident list is still available.');
      return;
    }
    map.current = instance;
    instance.addControl(new maplibre.NavigationControl({ showCompass: true }), 'top-right');
    instance.addControl(new maplibre.FullscreenControl(), 'top-right');
    let loaded = false;
    const loadTimeout = window.setTimeout(() => {
      if (!loaded) setFailure('The basemap did not finish loading.');
    }, 15000);
    instance.on('error', ({ error }) => {
      const resource = resourceName(error.message);
      setDiagnostic(`Map resource failed · ${resource}`);
      setFailure(loaded ? `Some basemap resources failed at ${resource}.` : `Could not load the basemap from ${resource}.`);
    });
    instance.on('movestart', () => setSettled(false));
    instance.on('idle', () => setSettled(true));
    instance.on('moveend', () => {
      camera.current = { center: instance.getCenter().toArray(), zoom: instance.getZoom() };
    });
    if (light) instance.on('click', event => {
      const point = event.lngLat.wrap();
      selection.current.pick?.({ latitude: point.lat, longitude: point.lng });
    });
    instance.on('load', () => {
      loaded = true;
      clearTimeout(loadTimeout);
      setFailure('');
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
        paint: { 'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 11, 6], 'circle-stroke-color': '#0a111b', 'circle-stroke-width': 2,
          'circle-color': ['match', ['get', 'severity'], 1, colors[1], 2, colors[2],
            3, colors[3], 4, colors[4], colors[0]] } });
      instance.on('click', 'event-points', (event) => {
        const key = event.features?.[0]?.properties?.key;
        const selected = selection.current.incidents.find((item) => incidentKey(item) === key);
        if (selected) selection.current.select?.(selected);
      });
      instance.on('click', 'event-clusters', async (event) => {
        const id = event.features?.[0]?.properties?.cluster_id as number | undefined;
        if (id === undefined) return;
        try {
          const zoom = await (instance.getSource('incidents') as GeoJSONSource).getClusterExpansionZoom(id);
          if (map.current === instance) instance.easeTo({ center: event.lngLat, zoom });
        } catch { /* A live update can replace a cluster before it expands. */ }
      });
      setReady(true);
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element.current);
    return () => {
      clearTimeout(loadTimeout);
      observer.disconnect();
      marker.current?.remove();
      marker.current = null;
      instance.remove();
      map.current = null;
    };
  }, [style, light, attempt]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource('range') as GeoJSONSource;
    source.setData(!location || global ? empty : {
      type: 'FeatureCollection',
      features: [-1, 0, 1].map(copy => ({ type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [ring(location, copy)] } })),
    });
    if (light && location) {
      if (!marker.current) {
        marker.current = new maplibre.Marker({ draggable: true, color: '#16cde2' })
          .setLngLat([location.longitude, location.latitude]).addTo(map.current);
        marker.current.getElement().setAttribute('aria-label', 'Monitoring pin');
        marker.current.on('dragend', () => {
          const point = marker.current?.getLngLat().wrap();
          if (point) selection.current.pick?.({ latitude: point.lat, longitude: point.lng });
        });
      }
      marker.current.setLngLat([location.longitude, location.latitude]);
    } else {
      marker.current?.remove();
      marker.current = null;
    }
  }, [ready, location, global, light]);

  useEffect(() => {
    if (!ready || !map.current) return;
    if (location && !global && (!light || map.current.getZoom() < 2 ||
        !map.current.getBounds().contains([location.longitude, location.latitude]))) {
      map.current.jumpTo({ center: [location.longitude, location.latitude],
        zoom: Math.max(2, Math.min(14, Math.log2(7500 / location.radius))) });
    } else if (!light) map.current.jumpTo({ center: [0, 20], zoom: 1.4 });
  }, [ready, location?.latitude, location?.longitude, global, light]);

  useEffect(() => {
    const event = incidents.find(item => incidentKey(item) === selectedId);
    if (ready && event?.latitude != null && event.longitude != null) {
      map.current?.easeTo({ center: [event.longitude, event.latitude], duration: reduceMotion ? 0 : 250 });
    }
  }, [ready, selectedId, reduceMotion]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource('incidents') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: incidents.flatMap((event) => event.latitude === null || event.longitude === null ? [] : [{
        type: 'Feature', properties: { key: incidentKey(event), severity: event.severity, selected: incidentKey(event) === selectedId },
        geometry: { type: 'Point', coordinates: [event.longitude, event.latitude] },
      }]),
    });
  }, [ready, incidents, selectedId]);

  return <div className="map-frame">
    <div className="map-canvas" ref={element} role="region" aria-label={label} data-map-ready={settled ? "true" : "false"} />
    {(failure || style === 'offline') && <div className="map-note" role="status">
      <span>{failure || 'Offline basemap · country boundaries'}</span>
      <button type="button" onClick={() => { setStyleIndex(0); setAttempt(attempt + 1); }}>Retry map</button>
      {styleIndex + 1 < styles.length && <button type="button" onClick={() => setStyleIndex(styleIndex + 1)}>
        {styles[styleIndex + 1] === 'offline' ? 'Use offline map' : 'Use secondary map'}
      </button>}
    </div>}
    {import.meta.env.DEV && diagnostic && <details className="map-diagnostic"><summary>Map diagnostics</summary>{diagnostic}</details>}
  </div>;
}

export const incidentKey = (event: Incident) => event.provider + ':' + event.external_id;

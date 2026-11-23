import { useEffect, useRef, useState } from 'react';
import * as maplibre from 'maplibre-gl';
import { type GeoJSONSource, type RasterTileSource, type Map as MapInstance } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { aircraftKind, type Aircraft } from './aviation';
import type { Vessel } from './maritime';
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

function fitArea(map: MapInstance, area: MapArea) {
  const bounds = new maplibre.LngLatBounds();
  for (const [longitude, latitude] of ring(area, 0)) bounds.extend([longitude, Math.max(-85, Math.min(85, latitude))]);
  map.fitBounds(bounds, { padding: 65, maxZoom: 15, duration: 0 });
}

const aircraftShapes = {
  airplane: 'M16 2l2 10 10 6v3l-10-3v7l4 3v2l-6-2-6 2v-2l4-3v-7l-10 3v-3l10-6z',
  rotorcraft: 'M15 4h2v8h11v2H18l3 4v5l-4 3v4h-2v-4l-4-3v-5l3-4H4v-2h11z',
  other: 'M16 3l12 23-12-6-12 6z',
  unknown: 'M16 3l12 13-12 13L4 16z',
};

function addAircraftLayer(instance: MapInstance) {
  for (const [kind, path] of Object.entries(aircraftShapes)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d');
    if (!context) continue;
    const shape = new Path2D(path);
    context.fillStyle = '#7ff4ff';
    context.strokeStyle = '#071524';
    context.lineWidth = 2.5;
    context.stroke(shape);
    context.fill(shape);
    instance.addImage('aircraft-' + kind, context.getImageData(0, 0, 32, 32));
  }
  instance.addSource('aircraft', { type: 'geojson', data: empty, attribution: 'Aviation · <a href="https://adsb.lol">ADSB.lol</a> · <a href="https://opensky-network.org">OpenSky Network</a>' });
  instance.addLayer({ id: 'live-aircraft', source: 'aircraft', type: 'symbol',
    layout: { 'icon-image': ['concat', 'aircraft-', ['get', 'kind']], 'icon-size': ['case', ['get', 'selected'], 1.3, .85],
      'icon-rotate': ['get', 'rotation'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true },
    paint: { 'icon-opacity': ['match', ['get', 'freshness'], 'stale', .35, 'delayed', .65, 1] },
  });
}

export function OperationalMap({ location, incidents, select, global, label, pick, selectedId, reduceMotion, focus, trafficOpacity, aircraft, selectAircraft, aircraftSelected, aircraftFocus, vessels, selectVessel, vesselSelected, vesselFocus, basemapLight = false }: {
  basemapLight?: boolean;
  vessels?: Vessel[]; selectVessel?: (id: string) => void; vesselSelected?: string;
  vesselFocus?: { latitude: number; longitude: number; revision: number };
  aircraft?: Aircraft[]; selectAircraft?: (id: string) => void; aircraftSelected?: string;
  aircraftFocus?: { latitude: number; longitude: number; revision: number };
  location?: MapArea; incidents: Incident[]; select?: (event: Incident) => void;
  global: boolean; label: string; pick?: (point: Point) => void; selectedId?: string; reduceMotion?: boolean; focus?: { target: 'area' | 'events' | 'vessels' | 'aircraft'; revision: number }; trafficOpacity?: number;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const selection = useRef({ incidents, select, pick, selectAircraft, selectVessel });
  const marker = useRef<maplibre.Marker | null>(null);
  const camera = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const [styleIndex, setStyleIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [diagnostic, setDiagnostic] = useState('');
  const light = !!pick;
  const styles = mapStyles(light || basemapLight);
  const style = styles[styleIndex] ?? styles[0];
  const initialCoverage = useRef<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [settled, setSettled] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => { selection.current = { incidents, select, pick, selectAircraft, selectVessel }; }, [incidents, select, pick, selectAircraft, selectVessel]);

  useEffect(() => {
    if (!element.current) return;
    setReady(false);
    setSettled(false);
    setFailure('');
    let instance: MapInstance;
    try {
      instance = new maplibre.Map({
        container: element.current,
        style: style === 'offline' ? offlineStyle(light || basemapLight) : style,
        center: camera.current?.center ?? [0, 20],
        zoom: camera.current?.zoom ?? 1.4,
        maxZoom: 18,
        renderWorldCopies: false,
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
    instance.on('error', event => {
      if ('sourceId' in event && event.sourceId === 'traffic-flow') return;
      const { error } = event;
      if (error.message.includes('/api/v1/traffic/tiles/')) return;
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
        paint: { 'fill-color': '#43bdda', 'fill-opacity': 0.055 } });
      instance.addLayer({ id: 'range-outline', source: 'range', type: 'line',
        paint: { 'line-color': '#43bdda', 'line-width': 2, 'line-dasharray': [3, 2] } });
      instance.addSource('incidents', { type: 'geojson', cluster: true, clusterRadius: 42, data: empty,
        clusterProperties: { highest: ['max', ['get', 'severity']] } });
      instance.addLayer({ id: 'event-clusters', source: 'incidents', type: 'circle',
        filter: ['has', 'point_count'],
        paint: { 'circle-radius': 15, 'circle-color': ['case', ['>=', ['get', 'highest'], 2], '#9b582d', '#236177'],
          'circle-stroke-color': ['case', ['>=', ['get', 'highest'], 2], '#ffd09b', '#a8f1ff'], 'circle-stroke-width': 2 } });
      if (instance.getStyle().glyphs) instance.addLayer({
        id: 'cluster-counts', source: 'incidents', type: 'symbol', filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-allow-overlap': true },
        paint: { 'text-color': '#ffffff' },
      });
      instance.addLayer({ id: 'event-points', source: 'incidents', type: 'circle',
        filter: ['!', ['has', 'point_count']],
        paint: { 'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 13, 9], 'circle-stroke-color': '#0a111b', 'circle-stroke-width': 2,
          'circle-color': ['match', ['get', 'severity'], 1, colors[1], 2, colors[2],
            3, colors[3], 4, colors[4], colors[0]] } });
      const symbols = { fire: '▲', earthquake: 'ϟ', traffic: '!', camera: '◉', bridge: '═', weather: '◆', other: '•' };
      for (const [id, glyph] of Object.entries(symbols)) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.font = 'bold 21px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#10212a'; ctx.fillText(glyph, 16, 16);
        instance.addImage('kind-' + id, ctx.getImageData(0, 0, 32, 32), { pixelRatio: 2 });
      }
      instance.addLayer({ id: 'event-kinds', source: 'incidents', type: 'symbol',
        filter: ['!', ['has', 'point_count']], layout: { 'icon-image': ['concat', 'kind-', ['get', 'kind']],
          'icon-allow-overlap': true } });
      instance.addSource('map-assets', { type: 'geojson', data: empty });
      instance.addSource('incident-lines', { type: 'geojson', data: empty });
      instance.addLayer({ id: 'incident-lines', type: 'line', source: 'incident-lines',
        paint: { 'line-color': '#ff715e', 'line-width': 4, 'line-opacity': .8 } }, 'event-points');
      instance.addLayer({ id: 'asset-points', type: 'circle', source: 'map-assets',
        paint: { 'circle-radius': 10, 'circle-color': ['case', ['>=', ['get', 'severity'], 2], '#ff8b72', '#80dce8'],
          'circle-stroke-color': '#112431', 'circle-stroke-width': 2 } });
      instance.addLayer({ id: 'asset-kinds', type: 'symbol', source: 'map-assets',
        layout: { 'icon-image': ['concat', 'kind-', ['get', 'kind']], 'icon-allow-overlap': true } });
      if (!light) {
        addAircraftLayer(instance);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const context = canvas.getContext('2d');
        if (context) {
          const shape = new Path2D('M16 2 25 14v12l-9 4-9-4V14z M12 19h8v-2h-8z');
          context.strokeStyle = '#06201f'; context.lineWidth = 3;
          context.stroke(shape); context.fillStyle = '#58e9bc'; context.fill(shape, 'evenodd');
          instance.addImage('vessel-icon', context.getImageData(0, 0, 32, 32));
          instance.addSource('vessels', { type: 'geojson', data: empty, cluster: true,
            clusterMaxZoom: 8, clusterRadius: 24, attribution: 'AIS · <a href="https://aisstream.io/">AISStream.io</a>' });
          instance.addLayer({ id: 'vessel-clusters', type: 'circle', source: 'vessels', filter: ['has', 'point_count'],
            paint: { 'circle-radius': 13, 'circle-color': '#166d63', 'circle-stroke-color': '#58e9bc', 'circle-stroke-width': 2 } });
          instance.addLayer({ id: 'live-vessels', type: 'symbol', source: 'vessels', filter: ['!', ['has', 'point_count']],
            layout: { 'icon-image': 'vessel-icon', 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map',
              'icon-size': ['case', ['get', 'selected'], 1.15, .75], 'icon-rotate': ['get', 'course'] },
            paint: { 'icon-opacity': ['case', ['get', 'fresh'], 1, .42] } });
          instance.on('click', 'live-vessels', event => {
            const id = event.features?.[0]?.properties?.mmsi;
            if (typeof id === 'string') selection.current.selectVessel?.(id);
          });
          instance.on('click', 'vessel-clusters', async event => {
            const id = event.features?.[0]?.properties?.cluster_id;
            if (typeof id !== 'number') return;
            try {
              const zoom = await (instance.getSource('vessels') as GeoJSONSource).getClusterExpansionZoom(id);
              if (map.current === instance) instance.easeTo({ center: event.lngLat, zoom });
            } catch { /* A stream update can replace the cluster. */ }
          });
          instance.on('mouseenter', 'live-vessels', () => { instance.getCanvas().style.cursor = 'pointer'; });
          instance.on('mouseleave', 'live-vessels', () => { instance.getCanvas().style.cursor = ''; });
        }
        instance.on('click', 'live-aircraft', event => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === 'string') selection.current.selectAircraft?.(id);
        });
        instance.on('mouseenter', 'live-aircraft', () => { instance.getCanvas().style.cursor = 'pointer'; });
        instance.on('mouseleave', 'live-aircraft', () => { instance.getCanvas().style.cursor = ''; });
      }
      instance.on('click', ['event-points', 'incident-lines', 'asset-points'], (event) => {
        if (!light && instance.queryRenderedFeatures(event.point, { layers: ['live-aircraft', 'live-vessels'].filter(id => instance.getLayer(id)) }).length) return;
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
  }, [style, light, basemapLight, attempt]);

  useEffect(() => {
    const source = ready ? map.current?.getSource('aircraft') as GeoJSONSource | undefined : undefined;
    source?.setData({ type: 'FeatureCollection', features: (aircraft ?? []).map(item => ({
      type: 'Feature', id: item.id,
      properties: { id: item.id, kind: item.heading === null ? 'unknown' : aircraftKind(item),
        rotation: item.heading ?? 0, freshness: item.freshness, selected: item.id === aircraftSelected },
      geometry: { type: 'Point', coordinates: [item.longitude, item.latitude] },
    })) });
  }, [ready, aircraft, aircraftSelected]);

  useEffect(() => {
    const source = ready ? map.current?.getSource('vessels') as GeoJSONSource | undefined : undefined;
    source?.setData({ type: 'FeatureCollection', features: (vessels ?? []).map(vessel => ({
      type: 'Feature', id: vessel.mmsi, properties: { mmsi: vessel.mmsi,
        course: vessel.heading ?? vessel.course ?? 0, fresh: vessel.freshness === 'fresh', selected: vessel.mmsi === vesselSelected },
      geometry: { type: 'Point', coordinates: [vessel.longitude, vessel.latitude] },
    })) });
  }, [ready, vessels, vesselSelected]);

  useEffect(() => {
    if (ready && vesselFocus) map.current?.easeTo({
      center: [vesselFocus.longitude, vesselFocus.latitude], duration: reduceMotion ? 0 : 350,
    });
  }, [ready, vesselFocus, reduceMotion]);

  useEffect(() => {
    if (ready && aircraftFocus) map.current?.easeTo({
      center: [aircraftFocus.longitude, aircraftFocus.latitude], duration: reduceMotion ? 0 : 350,
    });
  }, [ready, aircraftFocus, reduceMotion]);

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
    const key = JSON.stringify([global, location?.latitude, location?.longitude, location?.radius]);
    if (!light && key === initialCoverage.current) return;
    initialCoverage.current = key;
    if (location && !global && (!light || map.current.getZoom() < 2 ||
        !map.current.getBounds().contains([location.longitude, location.latitude]))) {
      fitArea(map.current, light ? location : { ...location, radius: Math.min(location.radius, 65) });
    } else if (!light && global) map.current.jumpTo({ center: [0, 20], zoom: 1.4 });
  }, [ready, location?.latitude, location?.longitude, location?.radius, global, light]);

  useEffect(() => {
    const event = incidents.find(item => incidentKey(item) === selectedId);
    if (ready && event?.latitude != null && event.longitude != null) {
      map.current?.easeTo({ center: [event.longitude, event.latitude], duration: reduceMotion ? 0 : 250 });
    }
  }, [ready, selectedId, reduceMotion]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const features = incidents.flatMap(event => event.latitude === null || event.longitude === null ? [] : [{
      type: 'Feature' as const, properties: { key: incidentKey(event), provider: event.provider,
        kind: event.category === 'road_watch' ? 'bridge' : event.category.startsWith('road_') ? 'traffic' :
          ['wildfire', 'fire_detection'].includes(event.category) ? 'fire' :
          event.category === 'weather_warning' ? 'weather' :
          ['traffic', 'camera', 'bridge', 'earthquake'].includes(event.category) ? event.category : 'other',
        severity: event.severity, selected: incidentKey(event) === selectedId },
      geometry: { type: 'Point' as const, coordinates: [event.longitude, event.latitude] },
    }]);
    (map.current.getSource('incidents') as GeoJSONSource).setData({
      type: 'FeatureCollection', features: features.filter(feature => feature.properties.provider !== 'map-registry'),
    });
    (map.current.getSource('map-assets') as GeoJSONSource).setData({
      type: 'FeatureCollection', features: features.filter(feature => feature.properties.provider === 'map-registry'),
    });
    (map.current.getSource('incident-lines') as GeoJSONSource).setData({
      type: 'FeatureCollection', features: incidents.flatMap(event => event.line && event.line.length > 1 ? [{
        type: 'Feature', properties: { key: incidentKey(event) },
        geometry: { type: 'LineString', coordinates: event.line },
      }] : []),
    });
  }, [ready, incidents, selectedId]);

  useEffect(() => {
    if (!focus || !map.current || !ready) return;
    if (focus.target === 'area' && location) fitArea(map.current, location);
    if (focus.target === 'vessels' || focus.target === 'aircraft') {
      const bounds = new maplibre.LngLatBounds();
      for (const item of (focus.target === 'vessels' ? vessels : aircraft) ?? []) bounds.extend([item.longitude, item.latitude]);
      if (!bounds.isEmpty()) map.current.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 0 });
    }
    if (focus.target === 'events') {
      const bounds = new maplibre.LngLatBounds();
      for (const event of incidents) if (event.longitude != null && event.latitude != null)
        bounds.extend([event.longitude, event.latitude]);
      if (!bounds.isEmpty()) map.current.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 0 });
    }
  }, [focus, ready]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    if (trafficOpacity === undefined) {
      if (instance.getLayer('traffic-flow')) instance.removeLayer('traffic-flow');
      if (instance.getSource('traffic-flow')) instance.removeSource('traffic-flow');
      return;
    }
    const tileTemplate = () => window.location.origin + '/api/v1/traffic/tiles/{z}/{x}/{y}.png?refresh=' +
      Math.floor(Date.now() / 60000);
    if (!instance.getSource('traffic-flow')) {
      instance.addSource('traffic-flow', {
        type: 'raster', tiles: [tileTemplate()],
        tileSize: 256, minzoom: 8, maxzoom: 19, attribution: '© TomTom',
      });
      instance.addLayer({ id: 'traffic-flow', type: 'raster', source: 'traffic-flow' }, 'event-clusters');
    }
    instance.setPaintProperty('traffic-flow', 'raster-opacity', trafficOpacity);
    const timer = window.setInterval(() => {
      (instance.getSource('traffic-flow') as RasterTileSource | undefined)?.setTiles([tileTemplate()]);
    }, 60000);
    return () => clearInterval(timer);
  }, [ready, trafficOpacity]);

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

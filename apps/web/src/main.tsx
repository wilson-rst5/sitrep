import { Component, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { OperationalMap, incidentKey } from './map';
import { ApiError, api, type Incident, type Location, type MapAsset, type Provider, type User } from './types';
import { LocationPicker } from './location-picker';
import { layers, operationalCategories, distanceKm } from './layers';
import { AssetEditor, CameraView } from './assets';
import { AircraftDetails, AviationAdmin, AviationHealth, aircraftKind, type Aviation } from './aviation';
import { filterVessel, MaritimeSettings, VesselDetails, VesselList, type Maritime } from './maritime';
import './style.css';

const client = new QueryClient({ defaultOptions: { queries: {
  retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  staleTime: 10000,
} } });
const labels = {
  en: { normal: 'Overview', weather: 'Weather', emergency: 'Emergency', aviation: 'Aviation',
    maritime: 'Maritime', traffic: 'Traffic', news: 'News', global: 'Global', network: 'Data sources',
    feed: 'Event feed', area: 'Monitoring area', map: 'Operational map', warning: 'Official warnings',
    empty: 'No events match the current filters.', unavailable: 'No data source configured for this mode.',
    observer: 'Event detail', select: 'Select an event from the feed or map.', settings: 'Settings',
    fresh: 'Connected', retry: 'Connection interrupted', checking: 'Connecting', signout: 'Sign out' },
  'pt-PT': { normal: 'Resumo', weather: 'Meteorologia', emergency: 'Emergência', aviation: 'Aviação',
    maritime: 'Marítimo', traffic: 'Trânsito', news: 'Notícias', global: 'Global', network: 'Fontes de dados',
    feed: 'Eventos', area: 'Área monitorizada', map: 'Mapa operacional', warning: 'Avisos oficiais',
    empty: 'Nenhum evento corresponde aos filtros.', unavailable: 'Nenhuma fonte configurada para este modo.',
    observer: 'Detalhes do evento', select: 'Selecione um evento na lista ou no mapa.', settings: 'Definições',
    fresh: 'Ligado', retry: 'Ligação interrompida', checking: 'A ligar', signout: 'Terminar sessão' },
};
const modes = ['normal', 'weather', 'emergency', 'aviation', 'maritime', 'traffic', 'news', 'global'] as const;
type Mode = typeof modes[number];
const categories = {
  weather: ['weather_warning', 'weather_observation', 'weather_forecast'],
  traffic: ['traffic', 'road_accident', 'road_closure', 'roadworks', 'road_weather'],
  emergency: ['earthquake', 'weather_warning', 'wildfire', 'natural_incident'],
  aviation: ['aircraft'], maritime: ['vessel'], news: ['news'],
};
const unsupported = new Set<Mode>(['traffic']);
const severity = ['Information', 'Routine', 'Important', 'High', 'Critical'];
const empty: Incident[] = [];
type AlertRule = { category: string; minimum_severity: number };
type AlertHistory = { event: Incident; acknowledged_at: string };

function Brand() {
  return <a className="brand" href="/" aria-label="SITREP home"><span className="brand-mark" aria-hidden="true">⌖</span>SITREP</a>;
}

function locationInput(data: FormData): Omit<Location, 'id'> {
  const latitude = String(data.get('latitude') ?? '');
  const longitude = String(data.get('longitude') ?? '');
  if (data.get('lookup_pending')) throw new Error('Wait for the location lookup to finish.');
  if (!latitude || !longitude) throw new Error('Place a pin or apply valid manual coordinates before saving.');
  return {
    geography: JSON.parse(String(data.get('geography') || '{}')),
    name: String(data.get('name')), country: String(data.get('country') || '').toUpperCase() || null,
    latitude: Number(latitude), longitude: Number(longitude),
    radius: Number(data.get('radius')), timezone: String(data.get('timezone') || 'UTC'),
    language: data.get('language') === 'pt-PT' ? 'pt-PT' : 'en',
    units: data.get('units') === 'imperial' ? 'imperial' : 'metric',
    district: String(data.get('district') || '').toUpperCase() || null,
  };
}

function Entry({ setup }: { setup: boolean }) {
  const cache = useQueryClient();
  const [step, setStep] = useState(1);
  const [account, setAccount] = useState({ username: '', password: '', token: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      if (setup && step === 1) {
        setAccount({ username: String(data.get('username')), password: String(data.get('password')),
          token: String(data.get('token')) });
        setStep(2);
      } else if (setup) {
        await api('/setup', { ...account, location: locationInput(data) });
        try {
          const user = await api<User>('/login', { username: account.username, password: account.password });
          cache.setQueryData(['session'], user);
        } finally {
          await cache.invalidateQueries({ queryKey: ['setup'] });
        }
      } else {
        const user = await api<User>('/login', {
          username: String(data.get('username')), password: String(data.get('password')),
        });
        cache.setQueryData(['session'], user);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed.');
    } finally { setBusy(false); }
  }

  return <main className={step === 2 ? "entry entry-location" : "entry"}>
    <Brand />
    <section className="entry-card">
      <p className="eyebrow">{setup ? 'FIRST-RUN SETUP' : 'SITUATION AWARENESS PLATFORM'}</p>
      <h1>{setup ? step === 1 ? 'Create administrator' : 'Select your monitoring location' : 'Sign in'}</h1>
      <form onSubmit={submit} key={step}>
        {step === 1 ? <>
          {setup && <label>Bootstrap token<input name="token" type="password" autoComplete="off" required /></label>}
          <label>Username<input name="username" autoComplete="username" pattern="[A-Za-z0-9_.\-]{3,80}" required /></label>
          <label>Password<input name="password" type="password" autoComplete={setup ? 'new-password' : 'current-password'}
            minLength={12} maxLength={256} required /></label>
        </> : <>
          <LocationPicker bootstrap={account.token} />
        </>}
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary-button" disabled={busy}>{setup ? step === 1 ? 'Continue' : 'Confirm monitoring location' : 'Sign in'}</button>
        {step === 2 && <button type="button" onClick={() => { if (window.confirm('Discard changes to the monitoring location?')) setStep(1); }}>Back</button>}
      </form>
    </section>
  </main>;
}

function Clock({ zone, language }: { zone: string; language: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <time dateTime={now.toISOString()}>{new Intl.DateTimeFormat(language, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: zone,
  }).format(now)}</time>;
}

function Dashboard({ user }: { user: User }) {
  const [streamState, setStreamState] = useState<'connecting' | 'connected' | 'retrying'>('connecting');
  const cache = useQueryClient();
  useEffect(() => {
    const stream = new EventSource('/api/v1/stream');
    stream.onopen = () => setStreamState('connected');
    stream.onerror = () => setStreamState('retrying');
    const refresh = () => {
      void cache.invalidateQueries({ queryKey: ['events'] });
      void cache.invalidateQueries({ queryKey: ['aviation'] });
      void cache.invalidateQueries({ queryKey: ['maritime'] });
      void cache.invalidateQueries({ queryKey: ['alert-status'] });
      void cache.invalidateQueries({ queryKey: ['related-events'] });
    };
    const signOut = () => { cache.clear(); window.location.assign('/'); };
    stream.addEventListener('events-changed', refresh);
    stream.addEventListener('signed-out', signOut);
    return () => stream.close();
  }, [cache]);
  const [mode, setMode] = useState<Mode>('normal');
  const [areaId, setArea] = useState<number>();
  const [minimum, setMinimum] = useState(0);
  const [hiddenLayers, setHiddenLayers] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('sitrep-hidden-layers') ?? '[]');
      return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string') : [];
    } catch { return []; }
  });
  const [flow, setFlow] = useState(localStorage.getItem('sitrep-traffic-flow') === 'true');
  const [opacity, setOpacity] = useState(() => {
    const stored = Number(localStorage.getItem('sitrep-traffic-opacity'));
    return stored >= .2 && stored <= 1 ? stored : .75;
  });
  useEffect(() => {
    localStorage.setItem('sitrep-traffic-flow', String(flow));
    localStorage.setItem('sitrep-traffic-opacity', String(opacity));
  }, [flow, opacity]);
  const [showLayers, setShowLayers] = useState(false);
  const [showFeed, setShowFeed] = useState(false);
  const [mapOnly, setMapOnly] = useState(false);
  const [headlines, setHeadlines] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [radiusOverride, setRadiusOverride] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [freshness, setFreshness] = useState(0);
  const [focus, setFocus] = useState<{ target: 'area' | 'events' | 'vessels' | 'aircraft'; revision: number }>();
  useEffect(() => { localStorage.setItem('sitrep-hidden-layers', JSON.stringify(hiddenLayers)); }, [hiddenLayers]);
  const [selectedId, setSelected] = useState('');
  const [settings, setSettings] = useState(false);
  const [editAreaId, setEditAreaId] = useState<number>();
  const [ruleCategory, setRuleCategory] = useState('earthquake');
  const [message, setMessage] = useState('');
  const audio = useRef<AudioContext | null>(null);
  const alertCount = useRef<number | undefined>(undefined);
  const [audioEnabled, setAudioEnabled] = useState(false);
  useEffect(() => () => { void audio.current?.close().catch(() => undefined); }, []);
  const [utc, setUtc] = useState(localStorage.getItem('sitrep-utc') === 'true');
  const [rotate, setRotate] = useState(localStorage.getItem('sitrep-rotate') === 'true');
  const [reduce, setReduce] = useState(localStorage.getItem('sitrep-reduce') === 'true');
  const [kiosk, setKiosk] = useState(new URLSearchParams(location.search).get('kiosk') === '1');
  useEffect(() => {
    if (!kiosk || !rotate || settings) return;
    const order: Mode[] = ['normal', 'weather', 'emergency', 'global'];
    const timer = window.setInterval(() => {
      setMode(current => order[(order.indexOf(current) + 1) % order.length]);
      setSelected('');
    }, 90000);
    return () => clearInterval(timer);
  }, [kiosk, rotate, settings]);
  const areas = useQuery({ queryKey: ['locations'], queryFn: () => api<Location[]>('/locations') });
  const area = areas.data?.find(item => item.id === areaId) ?? areas.data?.find(item => item.is_primary) ?? areas.data?.[0];
  const mapArea = area && (radiusOverride ? { ...area, radius: radiusOverride } : area);
  const editedArea = areas.data?.find(item => item.id === editAreaId);
  const dictionary = labels[area?.language ?? 'en'];
  const global = mode === 'global' || mode === 'news';
  const modeCategories = mode in categories ? categories[mode as keyof typeof categories] : operationalCategories;
  const query = new URLSearchParams({ severity: String(minimum), limit: '500' });
  if (area && !global) {
    query.set('location_id', String(area.id));
    if (radiusOverride) query.set('radius_km', String(radiusOverride));
  }
  for (const category of modeCategories) query.append('category', category);
  const events = useQuery({ queryKey: ['events', query.toString()], enabled: !!area || global,
    queryFn: () => api<Incident[]>('/events?' + query),
    refetchInterval: 30000 });
  const trackMode = mode === 'maritime' || mode === 'aviation';
  const mapQuery = new URLSearchParams(query);
  mapQuery.delete('category');
  for (const category of operationalCategories) mapQuery.append('category', category);
  const mapEvents = useQuery({ queryKey: ['events', mapQuery.toString()], enabled: !!area && trackMode,
    queryFn: () => api<Incident[]>('/events?' + mapQuery), refetchInterval: 30000 });
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api<Provider[]>('/providers/health'),
    refetchInterval: 60000 });
  const weather = useQuery({
    queryKey: ['weather-summary', area?.id, area?.latitude, area?.longitude, area?.radius],
    enabled: !!area,
    queryFn: () => api<Incident[]>(`/events?location_id=${area?.id}&category=weather_observation&category=weather_forecast&limit=30`),
    refetchInterval: 60000,
  });
  const news = useQuery({
    queryKey: ['news-strip'], queryFn: () => api<Incident[]>('/events?category=news&limit=3'), refetchInterval: 60000,
  });
  const activeAlerts = useQuery({
    queryKey: ['active-alerts'], queryFn: () => api<AlertHistory[]>('/alerts'), refetchInterval: 30000,
  });
  useEffect(() => {
    const count = activeAlerts.data?.length;
    const previous = alertCount.current;
    alertCount.current = count;
    const context = audio.current;
    if (!audioEnabled || !context || context.state !== 'running' || count === undefined ||
        previous === undefined || count <= previous) return;
    const tone = context.createOscillator();
    const volume = context.createGain();
    tone.frequency.value = 660;
    volume.gain.setValueAtTime(0.06, context.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
    tone.connect(volume).connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.2);
    tone.onended = () => { tone.disconnect(); volume.disconnect(); };
  }, [activeAlerts.data, audioEnabled]);

  async function setAlertAudio(enabled: boolean) {
    if (!enabled) { setAudioEnabled(false); return; }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      setAudioEnabled(true);
    } catch {
      setMessage('Audio alerts are unavailable in this browser.');
    }
  }

  const aviation = useQuery({ queryKey: ['aviation'], refetchInterval: 15000,
    queryFn: () => api<Aviation>('/aviation/aircraft') });
  const [aircraftId, setAircraftId] = useState('');
  const [following, setFollowing] = useState(false);
  const [flightFocus, setFlightFocus] = useState<{ latitude: number; longitude: number; revision: number }>();
  const [flightSearch, setFlightSearch] = useState('');
  const [flightKind, setFlightKind] = useState('');
  const [flightGround, setFlightGround] = useState('');
  const [flightAltitude, setFlightAltitude] = useState('');
  const [flightSpeed, setFlightSpeed] = useState('');
  const [flightDistance, setFlightDistance] = useState('');
  const covered = !area || area.id === aviation.data?.scope?.id;
  const flights = covered ? aviation.data?.aircraft ?? [] : [];
  const selectedAircraft = flights.find(item => item.id === aircraftId);
  const flightLatitude = selectedAircraft?.latitude;
  const flightLongitude = selectedAircraft?.longitude;
  const flightObserved = selectedAircraft?.observed;
  useEffect(() => {
    if (following && flightLatitude !== undefined && flightLongitude !== undefined) {
      setFlightFocus({ latitude: flightLatitude, longitude: flightLongitude, revision: flightObserved ?? 0 });
    }
  }, [following, flightLatitude, flightLongitude, flightObserved]);
  const filteredFlights = useMemo(() => flights.filter(item => mode !== 'aviation' || (
    (item.callsign?.toLowerCase().includes(flightSearch.trim().toLowerCase()) ||
      item.id.includes(flightSearch.trim().toLowerCase())) &&
    (!flightKind || aircraftKind(item) === flightKind) &&
    (!flightGround || item.ground === (flightGround === 'ground')) &&
    (!flightAltitude || (item.altitude !== null && item.altitude >= Number(flightAltitude))) &&
    (!flightSpeed || (item.speed !== null && item.speed >= Number(flightSpeed))) &&
    (!flightDistance || (!!area && distanceKm(item, area) <= Number(flightDistance)))
  )), [flights, mode, flightSearch, flightKind, flightGround, flightAltitude, flightSpeed, flightDistance, area]);
  const aviationArea = mode === 'aviation' && covered && mapArea && aviation.data
    ? { ...mapArea, radius: aviation.data.settings.radius } : mapArea;
  function openFlight(id: string) {
    setAircraftId(id); setSelected(''); setFollowing(false); setFlightFocus(undefined);
  }
  const flightStatus = aviation.isError ? 'API unavailable' : !covered ? 'Primary area coverage only'
    : aviation.isPending ? 'Checking' : flights.length ? `${flights.length} tracked`
    : aviation.data?.providers.find(provider => provider.state === 'no recent coverage') ? '0 aircraft reported'
    : aviation.data?.providers.find(provider => provider.provider === aviation.data?.settings.primary_provider)?.state ?? 'Waiting';
  const maritime = useQuery({ queryKey: ['maritime', area?.id], refetchInterval: 15000,
    queryFn: () => api<Maritime>('/maritime/vessels' + (area ? '?location_id=' + area.id : '')) });
  const build = useQuery({ queryKey: ['build'], queryFn: () => api<{ version: string; commit: string; deployed_at: string }>('/version') });
  const [vesselId, setVesselId] = useState('');
  const [vesselList, setVesselList] = useState(false);
  const [vesselFollow, setVesselFollow] = useState(false);
  const [vesselFocus, setVesselFocus] = useState<{ latitude: number; longitude: number; revision: number }>();
  const [vesselFilters, setVesselFilters] = useState(['', '', '']);
  const vessels = maritime.data?.vessels ?? [];
  const visibleVessels = mode === 'maritime' ? vessels.filter(item =>
    filterVessel(item, vesselFilters[0], vesselFilters[1], vesselFilters[2], area)) : vessels;
  const chosenVessel = vessels.find(item => item.mmsi === vesselId);
  const vesselLat = chosenVessel?.latitude, vesselLon = chosenVessel?.longitude, vesselObserved = chosenVessel?.observed;
  const freshVessels = vessels.filter(item => item.freshness === 'fresh').length;
  const vesselStatus = maritime.isError ? 'API unavailable' : freshVessels ? `${freshVessels} fresh`
    : maritime.data?.state === 'receiving positions' ? 'No fresh vessels reported' : maritime.data?.state ?? 'Checking';
  useEffect(() => {
    if (vesselFollow && vesselLat !== undefined && vesselLon !== undefined) {
      setVesselFocus({ latitude: vesselLat, longitude: vesselLon, revision: vesselObserved ?? 0 });
    }
  }, [vesselFollow, vesselLat, vesselLon, vesselObserved]);
  function selectVessel(id: string, centre = false) {
    setVesselId(id); setVesselFollow(false); openFlight('');
    if (id) setSelected('');
    const item = centre ? vessels.find(vessel => vessel.mmsi === id) : undefined;
    setVesselFocus(item ? { latitude: item.latitude, longitude: item.longitude, revision: Date.now() } : undefined);
  }
  function changeMode(next: Mode) {
    setMode(next); setSelected(''); selectVessel('');
    setVesselFilters(['', '', '']);
    if (next === 'maritime') {
      setVesselList(true);
      setHiddenLayers(current => current.filter(layer => layer !== 'vessel'));
    }
  }
  const traffic = useQuery({ queryKey: ['traffic-status'], refetchInterval: 15000,
    queryFn: () => api<{ state: string; last_success: string | null }>('/traffic/status') });
  const assets = useQuery({ queryKey: ['map-assets', area?.id, global],
    queryFn: () => api<MapAsset[]>('/map-assets' + (!global && area ? '?location_id=' + area.id : '')) });
  const registry = useQuery({ queryKey: ['map-assets', 'admin'], enabled: settings && user.role === 'admin',
    queryFn: () => api<MapAsset[]>('/map-assets') });
  const canFlow = ['online', 'unverified', 'unavailable'].includes(traffic.data?.state ?? '');
  const registryMarkers = useMemo<Incident[]>(() => (assets.data ?? []).filter(asset => asset.enabled).map(asset => ({
    provider: 'map-registry', external_id: String(asset.id), category: asset.kind, title: asset.name,
    description: '', latitude: asset.latitude, longitude: asset.longitude, source_url: asset.source_url,
    official: false, district: null, severity: asset.notice?.status === 'closed' ? 3 : asset.notice ? 2 : 0,
    occurred_at: '', updated_at: '', expires_at: '', magnitude: null, depth_km: null, forecast_date: null,
  })), [assets.data]);
  const items = useMemo(() => (events.data ?? empty).filter(item => (!providerFilter || item.provider === providerFilter) && (!statusFilter || item.event_status === statusFilter) &&
    (!freshness || Date.parse(item.reported_at ?? item.updated_at) >= Date.now() - freshness * 3600000)), [events.data, providerFilter, freshness, statusFilter]);
  const visible = useMemo(() => items.filter(item => !hiddenLayers.includes(item.category)), [items, hiddenLayers]);
  const configured = (values: readonly string[]) => providers.data?.some(source =>
    !['DISABLED', 'NEEDS_KEY'].includes(source.state) && (values.includes(source.category) ||
      (source.category === 'traffic' && values.some(value => value.startsWith('road_') && value !== 'road_watch')) ||
      (source.id === 'nasa-eonet' && values.includes('wildfire'))));
  const fit = (target: 'area' | 'events' | 'vessels' | 'aircraft') => setFocus(previous => ({ target, revision: (previous?.revision ?? 0) + 1 }));
  const mapItems = useMemo(() => [...(trackMode ? (mapEvents.data ?? empty).filter(item => !hiddenLayers.includes(item.category)) : visible).filter(item => !['weather_observation', 'weather_forecast'].includes(item.category)),
    ...registryMarkers.filter(item => !hiddenLayers.includes(item.category))], [visible, registryMarkers, hiddenLayers, trackMode, mapEvents.data]);
  const selectedAsset = assets.data?.find(asset => 'map-registry:' + asset.id === selectedId);
  const segment = useQuery({
    queryKey: ['segment', selectedAsset?.id], enabled: !!selectedAsset && selectedAsset.kind !== 'camera',
    queryFn: () => api<{ currentSpeed: number | null; freeFlowSpeed: number | null;
      currentTravelTime: number | null; freeFlowTravelTime: number | null; confidence: number | null;
      checked_at: string } | null>(`/map-assets/${selectedAsset?.id}/traffic`), refetchInterval: 60000,
  });
  const selected = (trackMode ? mapItems : items).find(item => item.provider !== 'map-registry' && incidentKey(item) === selectedId);
  const eventLookup = selected && new URLSearchParams({ provider: selected.provider, external_id: selected.external_id });
  const alertStatus = useQuery({
    queryKey: ['alert-status', eventLookup?.toString()],
    enabled: !!selected,
    refetchInterval: 30000,
    queryFn: () => api<{ eligible: boolean; acknowledged_at: string | null }>('/alerts/status?' + eventLookup),
  });
  const related = useQuery({
    queryKey: ['related-events', eventLookup?.toString()],
    enabled: !!selected,
    refetchInterval: 30000,
    queryFn: () => api<Incident[]>('/related-events?' + eventLookup),
  });
  const rules = useQuery({ queryKey: ['alert-rules'], enabled: settings && user.role === 'admin',
    queryFn: () => api<AlertRule[]>('/alert-rules') });
  const history = useQuery({ queryKey: ['alert-history'], enabled: settings,
    queryFn: () => api<AlertHistory[]>('/alerts/history') });
  const ruleThreshold = rules.data?.find(rule => rule.category === ruleCategory)?.minimum_severity ?? 2;

  async function acknowledge(event: Incident) {
    try {
      await api('/alerts/acknowledge', { provider: event.provider, external_id: event.external_id });
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['alert-status'] }),
        cache.invalidateQueries({ queryKey: ['alert-history'] }),
      ]);
    } catch (reason) { setMessage(String(reason)); }
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    try {
      await api('/alert-rules', { category: ruleCategory, minimum_severity: Number(fields.get('threshold')) });
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['alert-rules'] }),
        cache.invalidateQueries({ queryKey: ['alert-status'] }),
      ]);
      setMessage('Alert rule saved.');
    } catch (reason) { setMessage(String(reason)); }
  }

  async function createViewer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      await api('/accounts', { username: fields.get('username'), password: fields.get('password'), role: 'viewer' });
      form.reset();
      setMessage('Viewer account created.');
    } catch (reason) { setMessage(String(reason)); }
  }
  const select = (event: Incident) => setSelected(incidentKey(event));
  const selectFeed = (event: Incident) => { select(event); if (window.innerWidth <= 680) setShowFeed(false); };
  const date = (value: string) => new Intl.DateTimeFormat(area?.language ?? 'en', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: area?.timezone ?? 'UTC',
  }).format(new Date(value));

  async function saveArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    try {
      const path = editedArea ? '/locations/' + editedArea.id : '/locations';
      const { id } = await api<{ id: number }>(path, locationInput(new FormData(event.currentTarget)));
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['locations'] }),
        cache.invalidateQueries({ queryKey: ['events'] }),
      ]);
      setSelected('');
      setEditAreaId(undefined);
      setArea(id);
      setSettings(false);
    } catch (reason) { setMessage(String(reason)); }
  }

  async function manageArea(action: 'primary' | 'delete') {
    if (!editedArea || (action === 'delete' && !window.confirm(`Delete ${editedArea.name}?`))) return;
    try {
      const path = '/locations/' + editedArea.id;
      if (action === 'delete') await api(path, undefined, 'DELETE');
      else await api(path + '/primary', {});
      await cache.invalidateQueries({ queryKey: ['locations'] });
      if (action === 'delete') { setEditAreaId(undefined); setArea(undefined); setSelected(''); }
      else setArea(editedArea.id);
    } catch (reason) { setMessage(String(reason)); }
  }

  async function signOut() {
    try {
      await api('/logout', {});
      cache.clear();
      window.location.assign('/');
    } catch (reason) { setMessage(String(reason)); }
  }

  async function toggleKiosk() {
    if (kiosk && document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    if (!kiosk) await document.documentElement.requestFullscreen?.().catch(() => undefined);
    setKiosk(!kiosk);
  }

  const online = providers.data?.filter(provider => provider.state === 'ONLINE').length;
  const delayed = providers.data?.filter(provider => provider.state === 'DEGRADED').length;
  const unavailable = providers.data?.filter(provider => provider.state === 'OFFLINE').length;
  const observation = weather.data?.find(event => event.category === 'weather_observation');
  const forecast = weather.data?.filter(event => event.category === 'weather_forecast').at(-1);
  const connectionError = events.isError || providers.isError || areas.isError;
  return <div className={['dashboard', kiosk && 'kiosk', reduce && 'reduce-motion'].filter(Boolean).join(' ')}>
    <header className="topbar command-header">
      <Brand />
      {!mapOnly && <label className="command-view"><span className="sr-only">Operational view</span>
        <select aria-label="Operational view" value={mode} onChange={event => changeMode(event.target.value as Mode)}>
          {modes.map(item => <option key={item} value={item}>{dictionary[item]}</option>)}
        </select></label>}
      <div className="top-spacer" />
      <span className={connectionError ? 'connection degraded' : 'connection'}>
        {connectionError ? dictionary.retry : streamState === 'connected' ? dictionary.fresh : streamState === 'retrying' ? 'Reconnecting' : dictionary.checking}
      </span>
      <span className="command-count">{activeAlerts.data?.length ?? '—'} active alerts</span>
      <div className="clock"><Clock zone={area?.timezone ?? 'UTC'} language={area?.language ?? 'en'} /><span>{area?.timezone ?? 'UTC'}</span></div>
      {utc && <div className="clock"><Clock zone="UTC" language="en" /><span>UTC</span></div>}
      <button type="button" aria-pressed={kiosk} onClick={toggleKiosk}>{kiosk ? 'Exit kiosk' : 'Kiosk'}</button>
      <button type="button" aria-pressed={mapOnly} onClick={() => setMapOnly(!mapOnly)}>{mapOnly ? 'Operations view' : 'Map only'}</button>
      <button type="button" aria-expanded={settings} onClick={() => { if (!settings || window.confirm('Close settings and discard any unsaved changes?')) setSettings(!settings); }}>{dictionary.settings}</button>
    </header>
    {settings && <section className="settings panel">
      <div className="panel-heading"><h2>{dictionary.settings}</h2>
        <div className="area-actions">
          <button onClick={signOut}>{dictionary.signout}</button>
          <button type="button" onClick={() => { if (window.confirm('Close settings and discard any unsaved changes?')) setSettings(false); }}>
            Close settings
          </button>
        </div>
      </div>
      <p>{user.username} · {user.role}</p>
      <div className="display-options">
        <label><input type="checkbox" checked={utc} onChange={event => {
          setUtc(event.target.checked); localStorage.setItem('sitrep-utc', String(event.target.checked));
        }} /> UTC clock</label>
        <label><input type="checkbox" checked={rotate} onChange={event => {
          setRotate(event.target.checked); localStorage.setItem('sitrep-rotate', String(event.target.checked));
        }} /> Rotate kiosk modes</label>
        <label><input type="checkbox" checked={reduce} onChange={event => {
          setReduce(event.target.checked); localStorage.setItem('sitrep-reduce', String(event.target.checked));
        }} /> Reduce motion</label>
        <label><input type="checkbox" checked={audioEnabled}
          onChange={event => void setAlertAudio(event.target.checked)} /> Audio for new alerts</label>
      </div>
      {user.role === 'admin' && <>
        <form onSubmit={saveArea}>
          <h3>Monitoring areas</h3>
          <label>Area to manage<select value={editAreaId ?? ''}
            onChange={event => { if (window.confirm('Switch editor and discard any unsaved changes?')) setEditAreaId(event.target.value ? Number(event.target.value) : undefined); }}>
            <option value="">New monitoring area</option>
            {areas.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <LocationPicker key={editedArea?.id ?? 'new'} location={editedArea} />
          {editedArea && <div className="area-actions">
            <button type="button" disabled={editedArea.is_primary} onClick={() => void manageArea('primary')}>Make primary</button>
            <button type="button" onClick={() => void manageArea('delete')}>Delete monitoring area</button>
          </div>}
          <button className="primary-button">{editedArea ? 'Save monitoring area' : 'Add monitoring area'}</button>
        </form>
        <AssetEditor assets={registry.data ?? []}
          refresh={() => { void cache.invalidateQueries({ queryKey: ['map-assets'] }); }} />
        <form onSubmit={createViewer}>
          <h3>Create viewer account</h3>
          <div className="form-grid">
            <label>Username<input name="username" autoComplete="off" minLength={3} maxLength={80} required /></label>
            <label>Password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
          </div>
          <button className="primary-button">Create viewer</button>
        </form>
        <form onSubmit={saveRule}>
          <h3>Alert rules</h3>
          <div className="form-grid">
            <label>Event category<select value={ruleCategory} onChange={event => setRuleCategory(event.target.value)}>
              <option value="earthquake">Earthquakes</option>
              <option value="weather_warning">Weather warnings</option>
              <option value="wildfire">Wildfires</option>
              <option value="natural_incident">Natural incidents</option>
            </select></label>
            <label>Minimum alert priority<select name="threshold" key={ruleCategory + ':' + ruleThreshold}
              defaultValue={ruleThreshold} disabled={!rules.isSuccess}>
              {severity.slice(1).map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
            </select></label>
          </div>
          <button className="primary-button" disabled={!rules.isSuccess}>Save alert rule</button>
          {rules.isError && <p role="status">Alert rules could not be loaded.</p>}
        </form>
      </>}
      <h3>Alert acknowledgement history</h3>
      {history.isError ? <p role="status">Alert history could not be loaded.</p> :
        history.isPending ? <p role="status">Loading alert history…</p> :
        !history.data.length ? <p className="muted">No acknowledgements in the past 30 days.</p> :
        <ul>{history.data.map(entry => <li key={incidentKey(entry.event)}>
          {entry.event.title} · {date(entry.acknowledged_at)}
        </li>)}</ul>}
      <p>Website {import.meta.env.VITE_SITREP_VERSION || 'development'} · Frontend build {import.meta.env.VITE_SITREP_BUILD || 'local'}</p>
      {build.data && <p>Backend {build.data.version} · commit {build.data.commit} · deployed {build.data.deployed_at}</p>}
      {user.role === 'admin' && maritime.data && <MaritimeSettings data={maritime.data}
        saved={() => { void cache.invalidateQueries({ queryKey: ['maritime'] }); }} />}
      {user.role === 'admin' && aviation.data && <AviationAdmin data={aviation.data}
        saved={() => { void cache.invalidateQueries({ queryKey: ['aviation'] }); }} />}
    </section>}
    {message && <p role="alert" className="error">{message}</p>}
    <main className="workspace">
      <section className="terrain">
        <h1 className="sr-only">{dictionary.map}</h1>
        <OperationalMap location={mode === 'maritime' && area && maritime.data && !maritime.data.settings.bounds
          ? { ...area, radius: maritime.data.settings.radius } : aviationArea}
          vessels={hiddenLayers.includes('vessel') ? undefined : visibleVessels} selectVessel={selectVessel}
          vesselSelected={vesselId} vesselFocus={vesselFocus} aircraft={hiddenLayers.includes('aircraft') ? undefined : filteredFlights}
          aircraftSelected={aircraftId} selectAircraft={id => { selectVessel(''); openFlight(id); }} aircraftFocus={flightFocus} incidents={mapItems} trafficOpacity={flow && canFlow ? opacity : undefined} select={item => { selectVessel(''); setAircraftId(''); setFollowing(false); setFlightFocus(undefined); select(item); }} focus={focus}
          selectedId={selectedId} reduceMotion={reduce} global={global} label={dictionary.map} />
      </section>
      <section className="map-command" aria-label="Map controls">
        {!mapOnly && <label className="area-selector"><span>{dictionary.area}</span><select aria-label={dictionary.area}
        value={area?.id ?? ''} onChange={event => { setArea(Number(event.target.value)); setRadiusOverride(0); setSelected(''); selectVessel(''); }}>
        {!area && <option value="">—</option>}
        {areas.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>}
        <div className="map-tools">
          {!mapOnly && <>
            <button aria-expanded={showLayers} onClick={() => { setShowLayers(!showLayers); if (!showLayers) setShowFeed(false); }}>Layers</button>
            <button aria-expanded={showFeed} onClick={() => { setShowFeed(!showFeed); setShowLayers(false); }}>Incidents · {visible.length}</button>
          </>}
          <button disabled={!area} onClick={() => { if (global) setMode('normal'); setFollowing(false); setVesselFollow(false); setFlightFocus(undefined); setVesselFocus(undefined); fit('area'); }}>Return to area</button>
          {!mapOnly && <details className="map-fit"><summary>Fit</summary>
            <button disabled={!mapItems.some(item => item.latitude != null)} onClick={() => fit('events')}>Fit incidents</button>
            <button disabled={!visibleVessels.length} onClick={() => fit('vessels')}>Fit vessels</button>
            <button disabled={!filteredFlights.length} onClick={() => fit('aircraft')}>Fit aircraft</button>
          </details>}
        </div>
        {!mapOnly && !global && area && mode !== 'maritime' && <small>{aviationArea?.radius} km {mode === 'aviation' ? 'aviation radius' : 'operational radius'}</small>}
      </section>
      {!mapOnly && <section className="signal-rack" aria-label="Live conditions">
        <button type="button" aria-label="Open aviation mode" onClick={() => { changeMode('aviation'); setHiddenLayers(current => current.filter(layer => layer !== 'aircraft')); }}>
          <span>AVIATION</span><strong>{flightStatus}</strong></button>
        <button type="button" aria-label="Open maritime mode" onClick={() => changeMode('maritime')}>
          <span>MARITIME</span><strong>{vesselStatus}</strong></button>
        <button onClick={() => changeMode('weather')} aria-label="Open weather mode"><span>WEATHER</span><strong>{observation?.title ?? 'No station reading'}</strong></button>
        <button aria-expanded={showStatus} onClick={() => setShowStatus(!showStatus)}>
          <span title={`${delayed ?? 0} delayed · ${unavailable ?? 0} unavailable`}>SOURCES</span><strong>{online ?? '—'} online</strong></button>
      </section>}
      {!mapOnly && showLayers && <section className="panel overlay layer-menu" aria-label="Operational layers">
        <div className="panel-heading"><h2>Operational layers</h2><button onClick={() => { setHiddenLayers([]); setFlow(false); setOpacity(.75); }}>Reset</button></div>
        <label className="layer-option"><input type="checkbox" checked={flow && canFlow} disabled={!canFlow}
          onChange={event => setFlow(event.target.checked)} /><span>Traffic Flow</span>
          <small>{traffic.data?.state.replaceAll('_', ' ') ?? 'Checking'}{traffic.data?.last_success ? ' · ' + date(traffic.data.last_success) : ''}</small></label>
        {flow && canFlow && <label className="layer-option">Opacity<input type="range" min=".2" max="1" step=".05"
          value={opacity} onChange={event => setOpacity(Number(event.target.value))} /></label>}
        {layers.map(([name, values]) => <label className="layer-option" key={name}>
          <input type="checkbox" checked={values.every(value => !hiddenLayers.includes(value))}
            onChange={event => setHiddenLayers(current => event.target.checked
              ? current.filter(value => !(values as readonly string[]).includes(value))
              : [...new Set([...current, ...values])])} />
          <span>{name}</span><small>{values[0] === 'aircraft' ? flightStatus : values[0] === 'vessel' ? vesselStatus : [...items, ...registryMarkers].some(item => (values as readonly string[]).includes(item.category))
            ? 'In view' : configured(values) ? 'Configured' : 'Not configured'}</small>
        </label>)}
      </section>}
      {!mapOnly && showFeed && mode !== 'aviation' && <section className="panel overlay feed">
        <div className="panel-heading"><h2>{dictionary.feed}</h2><span className="count">{visible.length}</span><button onClick={() => setShowFeed(false)}>Close feed</button></div>
        <label className="filter"><span>Priority</span><select value={minimum} onChange={event => setMinimum(Number(event.target.value))}>
          <option value="0">All priorities</option><option value="2">Important and higher</option>
          <option value="3">High and critical</option><option value="4">Critical only</option>
        </select></label>
        {!global && <label className="filter">Radius<select value={radiusOverride}
          onChange={event => setRadiusOverride(Number(event.target.value))}>
          <option value="0">Saved area radius</option>
          {[15, 25, 50, 100, 150].map(km => <option key={km} value={km}>{km} km</option>)}
        </select></label>}
        <label className="filter">Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="">Any reported status</option><option value="active">Active</option><option value="present">Present</option>
        </select></label>
        <label className="filter">Provider<select value={providerFilter} onChange={event => setProviderFilter(event.target.value)}>
          <option value="">All providers</option>{providers.data?.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select></label>
        <label className="filter">Freshness<select value={freshness} onChange={event => setFreshness(Number(event.target.value))}>
          <option value="0">All current records</option><option value="1">Last hour</option><option value="6">Last 6 hours</option>
        </select></label>
        {unsupported.has(mode) && !visible.length && !configured(modeCategories) ? <p className="empty">{dictionary.unavailable}</p> :
          connectionError && !events.data ? <p className="empty" role="status">{dictionary.retry}</p> :
          events.isPending ? <p className="empty" role="status">{dictionary.checking}</p> :
          !visible.length ? <p className="empty">{dictionary.empty}</p> :
          <ul className="event-list">{visible.map(item => <li key={incidentKey(item)}>
            <button onClick={() => selectFeed(item)} aria-pressed={incidentKey(item) === selectedId}>
              <span className={'priority level-' + item.severity}>{severity[item.severity]}</span>
              <strong>{item.title}</strong>
              <span>{item.district ?? (item.latitude !== null && item.longitude !== null
                ? `${item.latitude.toFixed(2)}°, ${item.longitude.toFixed(2)}°` : '—')} · {item.official ? 'Official source' : 'Reported'}</span>
              <span>{item.provider} · {item.forecast_date ?? date(item.occurred_at)}</span>
            </button></li>)}</ul>}
      </section>}
      {!mapOnly && mode === 'weather' && <aside className="overlay weather-overlay">
        <section className="panel weather-intelligence">
          <div className="panel-heading"><h2>Weather intelligence</h2></div>
          <div className="details">
            {observation ? <p>{observation.description || observation.title} · {date(observation.occurred_at)}</p> :
              <p>{weather.isError ? 'Weather feed unavailable' : 'No station reading in this area'}</p>}
            {forecast && <p>{forecast.forecast_date} · {forecast.description}</p>}
          </div>
        </section>
      </aside>}
      {selected && <aside className="panel overlay detail-overlay">
        <div className="panel-heading"><h2>{dictionary.observer}</h2><button onClick={() => setSelected('')}>Close detail</button></div>
          {selected ? <div className="details">
            <span className={'priority level-' + selected.severity}>{severity[selected.severity]}</span>
            <h3>{selected.title}</h3><p>{selected.description}</p>
            {selected.district && <p>District {selected.district} · Approximate area</p>}
            {selected.magnitude !== null && <p>Magnitude {selected.magnitude}</p>}
            {selected.depth_km !== null && <p>Depth {selected.depth_km.toFixed(1)} km</p>}
            <p>{selected.category.replaceAll('_', ' ')} · {selected.forecast_date ?? date(selected.occurred_at)}</p>
            <p>Updated {date(selected.reported_at ?? selected.updated_at)}</p>
            {selected.road && <p>Road {selected.road}</p>}
            {selected.original_source && <p>Reported by {selected.original_source}</p>}
            {selected.provider === 'transito-agora' && <a href="https://transitoagora.pt" target="_blank" rel="noreferrer">Dados: Trânsito Agora</a>}
            {selected.delay_seconds != null && <p>Reported delay {Math.round(selected.delay_seconds / 60)} min</p>}
            {selected.event_status && <p>Status {selected.event_status}</p>}
            {(selected.direction_from || selected.direction_to) && <p>{selected.direction_from ?? 'Unknown'} → {selected.direction_to ?? 'Unknown'}</p>}
            {area && selected.latitude != null && selected.longitude != null &&
              <p>{distanceKm(area, { latitude: selected.latitude, longitude: selected.longitude }).toFixed(1)} km from monitoring centre</p>}
            <a href={selected.source_url} target="_blank" rel="noreferrer">Source · {selected.provider}</a>
            {alertStatus.data?.acknowledged_at ? <p>Acknowledged · {date(alertStatus.data.acknowledged_at)}</p> :
              alertStatus.data?.eligible && <button onClick={() => void acknowledge(selected)}>Acknowledge alert</button>}
            {!!related.data?.length && <>
              <h4>Related events</h4>
              <p className="muted">Events within 24 hours and 50 km, or in the same warning district.</p>
              <ul>{related.data.map(item => <li key={incidentKey(item)}>
                <a href={item.source_url} target="_blank" rel="noreferrer">{item.title}</a>
              </li>)}</ul>
            </>}
          </div> : <p className="empty">{dictionary.select}</p>}
      </aside>}
      {selectedAsset && <aside className="panel overlay detail-overlay">
        <div className="panel-heading"><h2>{selectedAsset.name}</h2><button onClick={() => setSelected('')}>Close detail</button></div>
        <div className="details">
          {selectedAsset.kind === 'camera' ? <CameraView key={selectedAsset.id} asset={selectedAsset} /> : <>
            <p>Road {selectedAsset.road || 'Not available'} · {selectedAsset.attribution}</p>
            <p>Overall status {selectedAsset.notice?.status ?? 'Unknown'}</p>
            {(['northbound', 'southbound'] as const).map(direction => <p key={direction}>
              {direction === 'northbound' ? 'Northbound' : 'Southbound'} · {
                selectedAsset.notice && ['both', direction].includes(selectedAsset.notice.direction)
                  ? selectedAsset.notice.status : 'Unknown'}
            </p>)}
            {segment.data ? <>
              <p>Nearest reported segment · direction unverified</p>
              <p>Current speed {segment.data.currentSpeed ?? 'Not available'} · Free-flow speed {segment.data.freeFlowSpeed ?? 'Not available'} km/h</p>
              <p>Delay {segment.data.currentTravelTime != null && segment.data.freeFlowTravelTime != null
                ? Math.max(0, segment.data.currentTravelTime - segment.data.freeFlowTravelTime) + ' s' : 'Not available'}</p>
              <p>Confidence {segment.data.confidence ?? 'Not available'} · Checked {date(segment.data.checked_at)}</p>
            </> : <p>Current speed, free-flow speed and delay · Not available for this asset</p>}
            {selectedAsset.notice && <a href={selectedAsset.notice.source_url} target="_blank" rel="noreferrer">Official notice</a>}
            <a href={selectedAsset.source_url} target="_blank" rel="noreferrer">Open operator source</a>
            {(assets.data ?? []).filter(camera => camera.enabled && camera.kind === 'camera' && distanceKm(camera, selectedAsset) < 8)
              .map(camera => <button key={camera.id} onClick={() => setSelected('map-registry:' + camera.id)}>{camera.name}</button>)}
            {items.filter(item => item.road && selectedAsset.road && item.road.split(',').some(road => road.trim() === selectedAsset.road))
              .map(item => <button key={incidentKey(item)} onClick={() => select(item)}>Road report · {item.title}</button>)}
          </>}
        </div>
      </aside>}
      {!mapOnly && !showLayers && mode === 'aviation' && <section className="panel overlay feed aviation-feed" aria-label="Aircraft list">
        <div className="panel-heading"><h2>Aircraft · {flightStatus}</h2></div>
        <div className="details">
          <label>Callsign or ICAO <input value={flightSearch} onChange={event => setFlightSearch(event.target.value)} /></label>
          <div className="aviation-filters">
            <label>Category <select value={flightKind} onChange={event => setFlightKind(event.target.value)}>
              <option value="">All</option>{['airplane', 'rotorcraft', 'other', 'unknown'].map(kind =>
                <option key={kind}>{kind}</option>)}</select></label>
            <label>Status <select value={flightGround} onChange={event => setFlightGround(event.target.value)}>
              <option value="">All</option><option value="ground">On ground</option><option value="airborne">Airborne</option>
            </select></label>
            <label>Min altitude (ft) <input type="number" value={flightAltitude} onChange={event => setFlightAltitude(event.target.value)} /></label>
            <label>Min speed (kt) <input type="number" min="0" value={flightSpeed} onChange={event => setFlightSpeed(event.target.value)} /></label>
            <label>Max distance (km) <input type="number" min="1" value={flightDistance} onChange={event => setFlightDistance(event.target.value)} /></label>
          </div>
          <AviationHealth data={aviation.data} />
          {!filteredFlights.length && <p>{flights.length ? 'No aircraft match the filters.' : flightStatus}</p>}
          {filteredFlights.map(item => <button key={item.id} aria-pressed={item.id === aircraftId} onClick={() => {
            openFlight(item.id);
            setFlightFocus({ latitude: item.latitude, longitude: item.longitude, revision: Date.now() });
          }}>{item.callsign ?? item.id.toUpperCase()} · {item.altitude === null ? '—' : Math.round(item.altitude) + ' ft'} · {item.age}s</button>)}
        </div>
      </section>}
      {!mapOnly && !showLayers && mode === 'maritime' && vesselList && <VesselList
        data={maritime.data} vessels={visibleVessels} selected={vesselId} select={id => selectVessel(id, true)}
        close={() => { setVesselList(false); setVesselFilters(['', '', '']); }}
        centre={() => fit('vessels')} setFilters={(...filters) => setVesselFilters(filters)} />}
      {chosenVessel && <VesselDetails key={chosenVessel.mmsi} vessel={chosenVessel}
        following={vesselFollow} follow={() => setVesselFollow(!vesselFollow)} close={() => selectVessel('')}
        centre={() => setVesselFocus({ latitude: chosenVessel.latitude, longitude: chosenVessel.longitude, revision: Date.now() })} />}
      {selectedAircraft && <AircraftDetails item={selectedAircraft} follow={following}
        distance={area ? distanceKm(selectedAircraft, area) : undefined}
        centre={() => setFlightFocus({ latitude: selectedAircraft.latitude, longitude: selectedAircraft.longitude, revision: Date.now() })}
        toggleFollow={() => setFollowing(!following)} close={() => openFlight('')} />}
      {!mapOnly && showStatus && <section className="panel overlay status-overlay">
          <div className="panel-heading"><h2>{dictionary.network}</h2></div>
          {providers.data ? <ul className="providers">{providers.data.map(provider =>
            <li key={provider.id}><div><a href={provider.docs} target="_blank" rel="noreferrer">{provider.name}</a>
              <span className={'provider-state ' + provider.state.toLowerCase()}>{provider.state}</span></div>
              <small>{provider.succeeded_at ? date(provider.succeeded_at) : 'No successful fetch recorded'}</small>
            </li>)}</ul> : <p className="empty">{providers.isError ? dictionary.retry : dictionary.checking}</p>}
      </section>}
      {mapItems.some(item => item.provider === 'tomtom-incidents') && <a className="tomtom-credit"
        href="https://www.tomtom.com/legal/" target="_blank" rel="noreferrer">© TomTom</a>}
      {mapItems.some(item => item.provider === 'transito-agora') && <a className="traffic-credit"
        href="https://transitoagora.pt" target="_blank" rel="noreferrer">Dados: Trânsito Agora</a>}
      {!mapOnly && <button className="headline-toggle" aria-expanded={headlines} onClick={() => setHeadlines(!headlines)}>Headlines</button>}
    </main>
    {!mapOnly && headlines && <div className="intelligence-strip" aria-label="Latest headlines">
      <strong>HEADLINES</strong>
      {news.data?.map(item => <a key={incidentKey(item)} href={item.source_url} target="_blank" rel="noreferrer">{item.title}</a>)}
      {news.isError && <span>News unavailable</span>}
      {news.data?.length === 0 && <span>No recent headlines</span>}
    </div>}
  </div>;
}

class DashboardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main className="entry">
      <h1>Dashboard could not render</h1>
      <button onClick={() => this.setState({ failed: false })}>Retry dashboard</button>
    </main> : this.props.children;
  }
}

function App() {
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => api<{ required: boolean }>('/setup') });
  const user = useQuery({ queryKey: ['session'], queryFn: () => api<User>('/session'), enabled: setup.data?.required === false });
  if (setup.data?.required) return <Entry setup />;
  if (user.data) return <DashboardBoundary><Dashboard user={user.data} /></DashboardBoundary>;
  if (user.error instanceof ApiError && user.error.status === 401) return <Entry setup={false} />;
  return <main className="entry"><Brand /><p role="status">{setup.isError || user.isError
    ? 'SITREP is temporarily unavailable.' : 'Connecting to SITREP…'}</p>
    {(setup.isError || user.isError) && <button onClick={() => void (setup.isError ? setup.refetch() : user.refetch())}>Retry</button>}</main>;
}

createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);

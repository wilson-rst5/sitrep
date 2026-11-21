import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { OperationalMap, incidentKey } from './map';
import { ApiError, api, type Incident, type Location, type Provider, type User } from './types';
import './style.css';

const client = new QueryClient({ defaultOptions: { queries: {
  retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  staleTime: 10000,
} } });
const labels = {
  en: { normal: 'Overview', weather: 'Weather', emergency: 'Emergency', aviation: 'Aviation',
    maritime: 'Maritime', traffic: 'Traffic', global: 'Global', network: 'Data sources',
    feed: 'Event feed', area: 'Monitoring area', map: 'Operational map', warning: 'Official warnings',
    empty: 'No events match the current filters.', unavailable: 'No data source configured for this mode.',
    observer: 'Event detail', select: 'Select an event from the feed or map.', settings: 'Settings',
    fresh: 'Connected', retry: 'Connection interrupted', checking: 'Connecting', signout: 'Sign out' },
  'pt-PT': { normal: 'Resumo', weather: 'Meteorologia', emergency: 'Emergência', aviation: 'Aviação',
    maritime: 'Marítimo', traffic: 'Trânsito', global: 'Global', network: 'Fontes de dados',
    feed: 'Eventos', area: 'Área monitorizada', map: 'Mapa operacional', warning: 'Avisos oficiais',
    empty: 'Nenhum evento corresponde aos filtros.', unavailable: 'Nenhuma fonte configurada para este modo.',
    observer: 'Detalhes do evento', select: 'Selecione um evento na lista ou no mapa.', settings: 'Definições',
    fresh: 'Ligado', retry: 'Ligação interrompida', checking: 'A ligar', signout: 'Terminar sessão' },
};
const modes = ['normal', 'weather', 'emergency', 'aviation', 'maritime', 'traffic', 'global'] as const;
type Mode = typeof modes[number];
const categories = {
  weather: ['weather_warning', 'weather_observation', 'weather_forecast'],
  aviation: ['aircraft'], maritime: ['vessel'], traffic: ['traffic'],
};
const unsupported = new Set<Mode>(['aviation', 'maritime', 'traffic']);
const severity = ['Information', 'Routine', 'Important', 'High', 'Critical'];
const empty: Incident[] = [];
type AlertRule = { category: string; minimum_severity: number };
type AlertHistory = { event: Incident; acknowledged_at: string };

function Brand() {
  return <a className="brand" href="/" aria-label="SITREP home"><span className="brand-mark" aria-hidden="true">⌖</span>SITREP</a>;
}

function locationInput(data: FormData): Omit<Location, 'id'> {
  return {
    name: String(data.get('name')), country: String(data.get('country')).toUpperCase(),
    latitude: Number(data.get('latitude')), longitude: Number(data.get('longitude')),
    radius: Number(data.get('radius')), timezone: String(data.get('timezone')),
    language: data.get('language') === 'pt-PT' ? 'pt-PT' : 'en',
    units: data.get('units') === 'imperial' ? 'imperial' : 'metric',
    district: String(data.get('district') || '').toUpperCase() || null,
  };
}

function LocationFields() {
  return <div className="form-grid">
    <label>Area name<input name="name" maxLength={120} required /></label>
    <label>Country code<input name="country" pattern="[A-Za-z]{2}" placeholder="ISO two-letter code" required /></label>
    <label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" required /></label>
    <label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" required /></label>
    <label>Radius (km)<input name="radius" type="number" min="1" max="2000" defaultValue="50" required /></label>
    <label>Time zone<input name="timezone" defaultValue="UTC" maxLength={80} required /></label>
    <label>Language<select name="language"><option value="en">English</option><option value="pt-PT">Português (Portugal)</option></select></label>
    <label>Units<select name="units"><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label>
    <label>IPMA district code (optional)<input name="district" pattern="[A-Za-z]{3}" maxLength={3} /></label>
  </div>;
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
        await cache.invalidateQueries({ queryKey: ['setup'] });
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

  return <main className="entry">
    <Brand />
    <section className="entry-card">
      <p className="eyebrow">{setup ? 'FIRST-RUN SETUP' : 'SITUATION AWARENESS PLATFORM'}</p>
      <h1>{setup ? step === 1 ? 'Create administrator' : 'Set monitoring area' : 'Sign in'}</h1>
      <form onSubmit={submit} key={step}>
        {step === 1 ? <>
          {setup && <label>Bootstrap token<input name="token" type="password" autoComplete="off" required /></label>}
          <label>Username<input name="username" autoComplete="username" pattern="[A-Za-z0-9_.\-]{3,80}" required /></label>
          <label>Password<input name="password" type="password" autoComplete={setup ? 'new-password' : 'current-password'}
            minLength={12} maxLength={256} required /></label>
        </> : <>
          <LocationFields />
          <p className="muted">USGS earthquakes and IPMA district warnings require no API key.</p>
        </>}
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary-button" disabled={busy}>{setup ? step === 1 ? 'Continue' : 'Complete setup' : 'Sign in'}</button>
        {step === 2 && <button type="button" onClick={() => setStep(1)}>Back</button>}
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
  const cache = useQueryClient();
  useEffect(() => {
    const stream = new EventSource('/api/v1/stream');
    const refresh = () => {
      void cache.invalidateQueries({ queryKey: ['events'] });
      void cache.invalidateQueries({ queryKey: ['alert-status'] });
    };
    const signOut = () => { cache.clear(); window.location.assign('/'); };
    stream.addEventListener('events-changed', refresh);
    stream.addEventListener('signed-out', signOut);
    return () => stream.close();
  }, [cache]);
  const [mode, setMode] = useState<Mode>('normal');
  const [areaId, setArea] = useState<number>();
  const [minimum, setMinimum] = useState(0);
  const [layer, setLayer] = useState(true);
  const [selectedId, setSelected] = useState('');
  const [settings, setSettings] = useState(false);
  const [ruleCategory, setRuleCategory] = useState('earthquake');
  const [message, setMessage] = useState('');
  const [kiosk, setKiosk] = useState(new URLSearchParams(location.search).get('kiosk') === '1');
  const areas = useQuery({ queryKey: ['locations'], queryFn: () => api<Location[]>('/locations') });
  const area = areas.data?.find(item => item.id === areaId) ?? areas.data?.[0];
  const dictionary = labels[area?.language ?? 'en'];
  const global = mode === 'global';
  const modeCategories = mode in categories ? categories[mode as keyof typeof categories] : [];
  const query = new URLSearchParams({ severity: String(minimum), limit: '500' });
  if (area && !global) query.set('location_id', String(area.id));
  for (const category of modeCategories) query.append('category', category);
  const events = useQuery({ queryKey: ['events', query.toString()], enabled: !!area || global,
    queryFn: () => api<Incident[]>('/events?' + query),
    refetchInterval: 30000 });
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api<Provider[]>('/providers/health'),
    refetchInterval: 60000 });
  const items = events.data ?? empty;
  const selected = items.find(item => incidentKey(item) === selectedId);
  const alertStatus = useQuery({
    queryKey: ['alert-status', selected?.provider, selected?.external_id],
    enabled: !!selected,
    refetchInterval: 30000,
    queryFn: () => api<{ eligible: boolean; acknowledged_at: string | null }>(
      '/alerts/status?' + new URLSearchParams({ provider: selected!.provider, external_id: selected!.external_id }),
    ),
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
  const date = (value: string) => new Intl.DateTimeFormat(area?.language ?? 'en', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: area?.timezone ?? 'UTC',
  }).format(new Date(value));

  async function addArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    try {
      const { id } = await api<{ id: number }>('/locations', locationInput(new FormData(event.currentTarget)));
      await cache.invalidateQueries({ queryKey: ['locations'] });
      setArea(id);
      setSettings(false);
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

  const connectionError = events.isError || providers.isError || areas.isError;
  return <div className={kiosk ? 'dashboard kiosk' : 'dashboard'}>
    <header className="topbar">
      <Brand />
      <label className="area-selector"><span>{dictionary.area}</span><select aria-label={dictionary.area}
        value={area?.id ?? ''} onChange={event => { setArea(Number(event.target.value)); setSelected(''); }}>
        {!area && <option value="">—</option>}
        {areas.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <div className="top-spacer" />
      <span className={connectionError ? 'connection degraded' : 'connection'}>
        {connectionError ? dictionary.retry : events.isSuccess && providers.isSuccess ? dictionary.fresh : dictionary.checking}
      </span>
      <div className="clock"><Clock zone={area?.timezone ?? 'UTC'} language={area?.language ?? 'en'} />
        <span>{area?.timezone ?? 'UTC'}</span></div>
      <button type="button" aria-pressed={kiosk} onClick={toggleKiosk}>{kiosk ? 'Exit kiosk' : 'Kiosk'}</button>
      <button type="button" aria-expanded={settings} onClick={() => setSettings(!settings)}>{dictionary.settings}</button>
    </header>
    <nav aria-label="Dashboard modes" className="modes">{modes.map(item =>
      <button key={item} type="button" aria-pressed={item === mode}
        onClick={() => { setMode(item); setSelected(''); }}>{dictionary[item]}</button>)}</nav>
    {settings && <section className="settings panel">
      <div className="panel-heading"><h2>{dictionary.settings}</h2><button onClick={signOut}>{dictionary.signout}</button></div>
      <p>{user.username} · {user.role}</p>
      {user.role === 'admin' && <>
        <form onSubmit={addArea}><LocationFields /><button className="primary-button">Add monitoring area</button></form>
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
    </section>}
    {message && <p role="alert" className="error">{message}</p>}
    <main className="workspace">
      <section className="panel feed">
        <div className="panel-heading"><h2>{dictionary.feed}</h2><span className="count">{items.length}</span></div>
        <label className="filter"><span>Priority</span><select value={minimum} onChange={event => setMinimum(Number(event.target.value))}>
          <option value="0">All priorities</option><option value="2">Important and higher</option>
          <option value="3">High and critical</option><option value="4">Critical only</option>
        </select></label>
        {unsupported.has(mode) ? <p className="empty">{dictionary.unavailable}</p> :
          connectionError && !events.data ? <p className="empty" role="status">{dictionary.retry}</p> :
          events.isPending ? <p className="empty" role="status">{dictionary.checking}</p> :
          !items.length ? <p className="empty">{dictionary.empty}</p> :
          <ul className="event-list">{items.map(item => <li key={incidentKey(item)}>
            <button onClick={() => select(item)} aria-pressed={incidentKey(item) === selectedId}>
              <span className={'priority level-' + item.severity}>{severity[item.severity]}</span>
              <strong>{item.title}</strong><span>{item.provider} · {item.forecast_date ?? date(item.occurred_at)}</span>
            </button></li>)}</ul>}
      </section>
      <section className="panel terrain">
        <div className="panel-heading"><h1>{dictionary.map}</h1><label className="layer"><input
          type="checkbox" checked={layer} onChange={event => setLayer(event.target.checked)} /> Event markers</label></div>
        <OperationalMap location={area} incidents={layer ? items : empty} select={select} global={global} label={dictionary.map} />
        <div className="map-info"><span>{global ? dictionary.global : area ?
          area.latitude.toFixed(3) + '°, ' + area.longitude.toFixed(3) + '°' : '—'}</span>
          <span>{!global && area && (area.units === 'metric' ? area.radius + ' km' : (area.radius * 0.621371).toFixed(1) + ' mi')}</span></div>
      </section>
      <aside className="side">
        <section className="panel summary">
          <div className="panel-heading"><h2>{dictionary.warning}</h2></div>
          <strong>{events.data ? items.filter(event => event.category === 'weather_warning' &&
            Date.parse(event.occurred_at) <= Date.now()).length : '—'}</strong>
          <span className="muted">In the current view</span>
        </section>
        <section className="panel">
          <div className="panel-heading"><h2>{dictionary.observer}</h2></div>
          {selected ? <div className="details">
            <span className={'priority level-' + selected.severity}>{severity[selected.severity]}</span>
            <h3>{selected.title}</h3><p>{selected.description}</p>
            {selected.district && <p>District {selected.district} · Approximate area</p>}
            {selected.magnitude !== null && <p>Magnitude {selected.magnitude}</p>}
            {selected.depth_km !== null && <p>Depth {selected.depth_km.toFixed(1)} km</p>}
            <p>{selected.forecast_date ?? date(selected.occurred_at)}</p>
            <a href={selected.source_url} target="_blank" rel="noreferrer">Source · {selected.provider}</a>
            {alertStatus.data?.acknowledged_at ? <p>Acknowledged · {date(alertStatus.data.acknowledged_at)}</p> :
              alertStatus.data?.eligible && <button onClick={() => void acknowledge(selected)}>Acknowledge alert</button>}
          </div> : <p className="empty">{dictionary.select}</p>}
        </section>
        <section className="panel">
          <div className="panel-heading"><h2>{dictionary.network}</h2></div>
          {providers.data ? <ul className="providers">{providers.data.map(provider =>
            <li key={provider.id}><div><a href={provider.docs} target="_blank" rel="noreferrer">{provider.name}</a>
              <span className={'provider-state ' + provider.state.toLowerCase()}>{provider.state}</span></div>
              <small>{provider.succeeded_at ? date(provider.succeeded_at) : 'No successful fetch recorded'}</small>
            </li>)}</ul> : <p className="empty">{providers.isError ? dictionary.retry : dictionary.checking}</p>}
        </section>
      </aside>
    </main>
    <footer><span>Civilian monitoring · Consult official channels for emergency instructions</span>
      <span>{events.dataUpdatedAt > 0 && 'Dashboard refreshed · ' + date(new Date(events.dataUpdatedAt).toISOString())}</span></footer>
  </div>;
}

function App() {
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => api<{ required: boolean }>('/setup') });
  const user = useQuery({ queryKey: ['session'], queryFn: () => api<User>('/session'), enabled: setup.data?.required === false });
  if (setup.data?.required) return <Entry setup />;
  if (user.data) return <Dashboard user={user.data} />;
  if (user.error instanceof ApiError && user.error.status === 401) return <Entry setup={false} />;
  return <main className="entry"><Brand /><p role="status">{setup.isError || user.isError
    ? 'SITREP is temporarily unavailable.' : 'Connecting to SITREP…'}</p>
    {(setup.isError || user.isError) && <button onClick={() => void (setup.isError ? setup.refetch() : user.refetch())}>Retry</button>}</main>;
}

createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);

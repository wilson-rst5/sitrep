import { useState, type FormEvent } from 'react';
import { api } from './types';

export type Aircraft = {
  id: string; latitude: number; longitude: number; callsign: string | null;
  altitude: number | null; speed: number | null; heading: number | null;
  vertical_rate: number | null; ground: boolean | null; category: string | null;
  squawk: string | null; contact: number | null; source: string | null; accuracy: number | null;
  observed: number; received: number; provider: string; age: number; freshness: string;
};
type AviationSettings = { radius: number; enabled: boolean; primary_provider: string; fallback: boolean };
export type Aviation = {
  settings: AviationSettings;
  scope: { id: number; latitude: number; longitude: number; radius: number } | null;
  providers: { provider: string; state: string; interval: number; succeeded: string | null;
    attempted: string | null; retry_at: string | null; remaining: number | null;
    requests_today: number; request_budget: number | null }[];
  aircraft: Aircraft[];
};

export function aircraftKind(item: Aircraft) {
  if (item.provider === 'opensky') {
    if (item.category === '8') return 'rotorcraft';
    if (['9', '10', '11', '12', '14'].includes(item.category ?? '')) return 'other';
    return ['2', '3', '4', '5', '6', '7'].includes(item.category ?? '') ? 'airplane' : 'unknown';
  }
  if (item.category === 'A7') return 'rotorcraft';
  if (/^A[1-6]$/.test(item.category ?? '')) return 'airplane';
  return item.category && /^[BC][1-7]$/.test(item.category) ? 'other' : 'unknown';
}

export function AviationAdmin({ data, saved }: { data: Aviation; saved: () => void }) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setMessage('');
    try {
      await api('/aviation/settings', { radius: Number(form.get('radius')), enabled: form.has('enabled'),
        primary_provider: form.get('primary_provider'), fallback: form.has('fallback') }, 'PATCH');
      saved();
      setMessage('Saved. The collector will apply changes within the provider’s request budget.');
    } catch { setMessage('Aviation settings could not be saved.'); }
    finally { setPending(false); }
  }
  return <form className="details" onSubmit={submit}>
    <h3>Aviation tracking</h3>
    <label><input type="checkbox" name="enabled" defaultChecked={data.settings.enabled} /> Enable flight tracking</label>
    <label>Aviation monitoring radius (km) <input type="number" name="radius" min="25" max="450"
      required list="aviation-radii" defaultValue={data.settings.radius} /></label>
    <datalist id="aviation-radii">{[25, 50, 100, 150, 200, 250].map(radius => <option key={radius} value={radius} />)}</datalist>
    <label>Primary provider <select name="primary_provider" defaultValue={data.settings.primary_provider}>
      <option value="adsb.lol">ADSB.lol</option><option value="opensky">OpenSky Network</option>
    </select></label>
    <label><input type="checkbox" name="fallback" defaultChecked={data.settings.fallback} /> Allow configured fallback</label>
    <button disabled={pending}>Save aviation settings</button>
    <p role="status">{message}</p>
  </form>;
}

export function AviationHealth({ data }: { data?: Aviation }) {
  return <>{data?.providers.map(provider => <div key={provider.provider} className="aviation-provider">
    <strong>{provider.provider}</strong> · {provider.state} · {provider.interval}s polling
    <small>Last successful query {provider.succeeded ? new Date(provider.succeeded).toLocaleString() : '—'}</small>
    {provider.request_budget !== null && <small>{provider.requests_today}/{provider.request_budget} SITREP requests today</small>}
    {provider.remaining !== null && <small>{provider.remaining} provider credits remaining</small>}
  </div>)}</>;
}

export function AircraftDetails({ item, distance, follow, toggleFollow, centre, close }: {
  item: Aircraft; distance?: number; follow: boolean; toggleFollow: () => void; centre: () => void; close: () => void;
}) {
  const value = (amount: number | null, unit: string) => amount === null ? '—' : `${Math.round(amount)} ${unit}`;
  const fields = [
    ['ICAO hex', item.id.toUpperCase()], ['Category', aircraftKind(item)], ['Altitude', value(item.altitude, 'ft')],
    ['Ground speed', value(item.speed, 'kt')], ['True track', value(item.heading, '°')],
    ['Vertical rate', value(item.vertical_rate, 'ft/min')], ['Squawk', item.squawk ?? '—'],
    ['Flight status', item.ground === null ? 'Unknown' : item.ground ? 'On ground' : 'Airborne'],
    ['Position', `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}`],
    ['Distance', distance === undefined ? '—' : value(distance, 'km')],
    ['Observed', `${new Date(item.observed * 1000).toLocaleTimeString()} · ${item.age}s ago · ${item.freshness}`],
    ['Received', new Date(item.received * 1000).toLocaleTimeString()],
    ['Last contact', item.contact === null ? '—' : new Date(item.contact * 1000).toLocaleTimeString()],
    ['Source', [item.provider, item.source].filter(Boolean).join(' · ')],
  ];
  return <section className="panel overlay detail-overlay" aria-label="Aircraft details">
    <div className="panel-heading"><h2>{item.callsign ?? item.id.toUpperCase()}</h2><button onClick={close}>Close aircraft</button></div>
    <div className="details"><dl className="aircraft-fields">{fields.map(([key, val]) =>
      <div key={key}><dt>{key}</dt><dd>{val}</dd></div>)}</dl>
      <div className="area-actions"><button onClick={centre}>Centre aircraft</button>
        <button aria-pressed={follow} onClick={toggleFollow}>{follow ? 'Stop following' : 'Follow aircraft'}</button></div>
      {item.provider === 'adsb.lol' && <a href="https://www.adsb.lol/docs/open-data/api" target="_blank" rel="noreferrer">ADSB.lol · ODbL 1.0</a>}
    </div>
  </section>;
}

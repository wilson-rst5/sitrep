import { useState, type FormEvent } from 'react';
import { api } from './types';
import { distanceKm } from './layers';

export type Vessel = {
  mmsi: string; name?: string; latitude: number; longitude: number; speed: number | null;
  heading: number | null; course: number | null; navigation: number | null; category?: number;
  destination?: string; callsign?: string; imo?: number; observed: number; received: number;
  timestamp_source?: string; age: number; freshness: string; source: string;
};
export type Maritime = {
  settings: { radius: number; bounds: number[] | null }; scope: { id: number } | null;
  state: string; provider: string; vessels: Vessel[];
  diagnostics: { connected?: boolean; confirmed?: boolean; messages?: number;
    position_messages?: number; valid_positions?: number; last_position?: number };
};

export function VesselList({ data, vessels, selected, select, close, centre, setFilters }: {
  data?: Maritime; vessels: Vessel[]; selected: string; select: (id: string) => void; close: () => void;
  centre: () => void; setFilters: (query: string, category: string, distance: string) => void;
}) {
  const [query, search] = useState(''), [category, chooseCategory] = useState(''), [distance, chooseDistance] = useState('');
  return <section className="panel overlay feed maritime-feed" aria-label="Vessel list">
    <div className="panel-heading"><h2>Surface traffic</h2><button onClick={close}>Close vessels</button></div>
    <div className="details">
      <p>{data?.provider ?? 'AISStream.io'} · {data?.state ?? 'Checking'}</p>
      {data?.diagnostics.last_position && <small>Last position {new Date(data.diagnostics.last_position * 1000).toLocaleTimeString()}</small>}
      <label>Name or MMSI <input value={query} onChange={e => { search(e.target.value); setFilters(e.target.value, category, distance); }} /></label>
      <div className="aviation-filters">
        <label>Category <select value={category} onChange={e => { chooseCategory(e.target.value); setFilters(query, e.target.value, distance); }}>
          <option value="">All</option><option value="6">Passenger</option><option value="7">Cargo</option>
          <option value="8">Tanker</option><option value="3">Fishing and service</option><option value="unknown">Unknown</option>
        </select></label>
        <label>Max distance (km) <input type="number" min="1" value={distance}
          onChange={e => { chooseDistance(e.target.value); setFilters(query, category, e.target.value); }} /></label>
      </div>
      <button disabled={!vessels.length} onClick={centre}>Fit vessels</button>
      {!vessels.length && <p>{data?.vessels.length ? 'No vessels match the filters.' : 'No fresh vessels reported.'}</p>}
      {vessels.map(vessel => <button key={vessel.mmsi} aria-pressed={selected === vessel.mmsi}
        onClick={() => select(vessel.mmsi)}>{vessel.name || vessel.mmsi} · {vessel.speed ?? '—'} kt · {vessel.freshness}</button>)}
    </div>
  </section>;
}

export function VesselDetails({ vessel, close, centre, following, follow }: {
  vessel: Vessel; close: () => void; centre: () => void; following: boolean; follow: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const fields = [
    ['MMSI', vessel.mmsi], ['Type (AIS code)', vessel.category], ['Speed', vessel.speed == null ? null : vessel.speed + ' kt'],
    ['Course over ground', vessel.course == null ? null : vessel.course + '°'], ['Heading', vessel.heading == null ? null : vessel.heading + '°'],
    ['Navigation status (AIS code)', vessel.navigation], ['Destination', vessel.destination], ['Callsign', vessel.callsign], ['IMO', vessel.imo],
    ['Position', `${vessel.latitude.toFixed(4)}, ${vessel.longitude.toFixed(4)}`],
    [vessel.timestamp_source === 'collector receipt' ? 'Position received' : 'Last position', `${new Date(vessel.observed * 1000).toLocaleTimeString()} · ${vessel.age}s · ${vessel.freshness}`],
    ['Received', new Date(vessel.received * 1000).toLocaleTimeString()], ['Source', vessel.source],
  ];
  return <section className="panel overlay detail-overlay" aria-label="Vessel details">
    <div className="panel-heading"><h2>{vessel.name || vessel.mmsi}</h2><button onClick={close}>Close vessel</button></div>
    <div className="details"><dl className="aircraft-fields">{fields.map(([key, value]) =>
      <div key={key}><dt>{key}</dt><dd>{value ?? 'Not reported'}</dd></div>)}</dl>
      <div className="area-actions"><button onClick={centre}>Centre vessel</button>
        <button aria-pressed={following} onClick={follow}>{following ? 'Stop following' : 'Follow vessel'}</button>
        {navigator.clipboard && <button onClick={() => void navigator.clipboard.writeText(vessel.mmsi).then(() => setCopied(true), () => setCopied(false))}>{copied ? 'Copied' : 'Copy MMSI'}</button>}
      </div></div>
  </section>;
}

export function filterVessel(vessel: Vessel, query: string, category: string, distance: string,
                             area?: { latitude: number; longitude: number }) {
  const term = query.trim().toLowerCase();
  return (vessel.mmsi.includes(term) || vessel.name?.toLowerCase().includes(term)) &&
    (!category || (vessel.category == null ? 'unknown' : String(Math.floor(vessel.category / 10))) === category) &&
    (!distance || !!area && distanceKm(vessel, area) <= Number(distance));
}

export function MaritimeSettings({ data, saved }: { data: Maritime; saved: () => void }) {
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const bounds = String(form.get('bounds')).trim();
    try {
      await api('/maritime/settings', { radius: Number(form.get('radius')), bounds: bounds ? bounds.split(',').map(Number) : null }, 'PATCH');
      setMessage('Maritime coverage saved.');
      saved();
    } catch { setMessage('Enter a 25–450 km radius and valid bounds, or leave bounds blank.'); }
  }
  return <form className="details" onSubmit={submit}>
    <h3>Maritime coverage</h3><p>AISStream.io credentials are set on the collector host.</p>
    <label>Maritime radius (km) <input name="radius" type="number" min="25" max="450" required defaultValue={data.settings.radius} /></label>
    <label>Optional bounds (south, west, north, east) <input name="bounds" defaultValue={data.settings.bounds?.join(', ') ?? ''} /></label>
    <button>Save maritime coverage</button><p role="status">{message}</p>
  </form>;
}

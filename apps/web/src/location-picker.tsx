import { useEffect, useRef, useState } from 'react';
import { OperationalMap, type Point } from './map';
import type { Geography, Location } from './types';

const empty: never[] = [];
const geographyFields = [
  ['country_name', 'Country name'], ['region', 'Region / state'], ['district_name', 'District'],
  ['municipality', 'Municipality / county'], ['city', 'City / town'], ['neighbourhood', 'Parish / neighbourhood'],
  ['postal_code', 'Postal code'], ['formatted', 'Formatted place name'],
] as const;

type Lookup = { country: string | null; timezone: string | null; geography: Geography;
  status: 'resolved' | 'not_configured' | 'unavailable' };

export function LocationPicker({ location, bootstrap }: { location?: Location; bootstrap?: string }) {
  const [point, setPoint] = useState<Point | undefined>(location);
  const [latitude, setLatitude] = useState(location?.latitude.toString() ?? '');
  const [longitude, setLongitude] = useState(location?.longitude.toString() ?? '');
  const [radius, setRadius] = useState(location?.radius ?? 50);
  const [name, setName] = useState(location?.name ?? '');
  const [country, setCountry] = useState(location?.country ?? '');
  const [timezone, setTimezone] = useState(location?.timezone ?? '');
  const [district, setDistrict] = useState(location?.district ?? '');
  const [geography, setGeography] = useState<Geography>(location?.geography ?? {});
  const [lookup, setLookup] = useState<Point>();
  const [status, setStatus] = useState('');
  const [coordinateError, setCoordinateError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [searchResults, setSearchResults] = useState<(Point & { label: string })[]>([]);
  const searchRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/locations/geocoder-status', { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(config => setSearchEnabled(config?.search === true)).catch(() => {});
    return () => { controller.abort(); searchRequest.current?.abort(); };
  }, []);

  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);

  useEffect(() => {
    if (!lookup) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch('/api/v1/locations/reverse-geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(bootstrap ? { 'X-Setup-Token': bootstrap } : {}) },
          body: JSON.stringify(lookup), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(9000)]),
        });
        if (!response.ok) throw new Error('Lookup failed');
        const result: Lookup = await response.json();
        if (controller.signal.aborted) return;
        setGeography(current => ({ ...current, ...result.geography }));
        if (result.country) setCountry(result.country);
        if (result.timezone) setTimezone(result.timezone);
        setName(current => current || result.geography.city || '');
        setStatus(result.status === 'resolved' ? 'Location information resolved.' :
          result.status === 'not_configured' ? 'Address lookup is not configured. You can enter place details below.' :
            'Address lookup is unavailable. Your pin is saved in this form.');
      } catch {
        if (!controller.signal.aborted) setStatus('Lookup failed. Your pin is still selected.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 240);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [lookup, bootstrap]);

  async function search() {
    const query = searchQuery.trim();
    if (query.length < 3) return;
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearchResults([]);
    setSearchStatus('Searching…');
    try {
      const response = await fetch('/api/v1/locations/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(bootstrap ? { 'X-Setup-Token': bootstrap } : {}) },
        body: JSON.stringify({ query }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(9000)]),
      });
      if (!response.ok) throw new Error('Search failed');
      const result = await response.json();
      if (controller.signal.aborted) return;
      setSearchResults(result.results);
      setSearchStatus(result.status !== 'resolved' ? 'Search unavailable.' :
        result.results.length ? '' : 'No matching places.');
    } catch {
      if (!controller.signal.aborted) setSearchStatus('Search unavailable.');
    }
  }

  function select(next: Point) {
    setPoint(next);
    setLatitude(String(next.latitude));
    setLongitude(String(next.longitude));
    setDirty(true);
    setGeography({});
    setCountry('');
    setTimezone('');
    setDistrict('');
    setCoordinateError('');
    setStatus('Looking up the selected location…');
    setLoading(true);
    setLookup(next);
  }

  function manualPoint() {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) ||
        Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      setCoordinateError('Enter latitude between −90 and 90 and longitude between −180 and 180.');
      return;
    }
    select({ latitude: lat, longitude: lon });
  }

  function reset() {
    setLookup(undefined);
    setLoading(false);
    setPoint(undefined);
    setLatitude('');
    setLongitude('');
    setGeography({});
    setCountry('');
    setTimezone('');
    setDistrict('');
    setStatus('');
    setCoordinateError('');
  }

  function deviceLocation() {
    if (!navigator.geolocation || !window.isSecureContext) {
      setCoordinateError('Device location requires HTTPS or localhost.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => select({ latitude: coords.latitude, longitude: coords.longitude }),
      () => setCoordinateError('Device location was unavailable or permission was denied.'),
      { timeout: 10000 },
    );
  }

  const unresolved = (key: string) => geography.resolved_fields?.includes(key) ? ' · Resolved' : '';
  const manualPending = latitude !== (point?.latitude.toString() ?? '') || longitude !== (point?.longitude.toString() ?? '');
  function editGeography(key: string, value: string) {
    setDirty(true);
    setGeography(current => ({ ...current, [key]: value, resolved_fields: current.resolved_fields?.filter(field => field !== key) }));
  }

  return <div className="location-picker" onChange={() => setDirty(true)}>
    <div className="picker-map">
      <OperationalMap location={point && { ...point, radius: radius || 50 }} incidents={empty}
        global={false} label="Location selection map" pick={select} />
      <div className="picker-map-actions">
        <button type="button" onClick={deviceLocation}>Use device location</button>
        <button type="button" disabled={!point} onClick={reset}>Reset pin</button>
      </div>
    </div>
    <div className="picker-details">
      <h3>Selected location</h3>
      {searchEnabled && <div className="place-search">
        <label>Find a city or address<input value={searchQuery} maxLength={120}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }}
          onChange={event => setSearchQuery(event.target.value)} /></label>
        <button type="button" onClick={() => void search()} disabled={searchQuery.trim().length < 3}>Search</button>
        {searchStatus && <p role="status">{searchStatus}</p>}
        {searchResults.map((result, index) => <button key={index} type="button" onClick={() => {
          select({ latitude: result.latitude, longitude: result.longitude });
          setSearchResults([]);
        }}>{result.label}</button>)}
      </div>}
      <p className="muted">Click the map to place a pin. Drag it to refine the location.</p>
      <p role="status" className="lookup-status">{status || 'Choose a point to look up its time zone and address.'}</p>
      <label>Area name<input name="name" value={name} onChange={event => setName(event.target.value)}
        placeholder="Give this area a name" maxLength={120} required /></label>
      <label>Monitoring radius<select aria-label="Radius preset" value={[15, 25, 50, 100, 150].includes(radius) ? radius : 'custom'}
        onChange={event => setRadius(event.target.value === 'custom' ? 75 : Number(event.target.value))}>
        {[15, 25, 50, 100, 150].map(km => <option key={km} value={km}>{km} km</option>)}
        <option value="custom">Custom</option>
      </select></label>
      <label>Radius (km)<input name="radius" type="number" min="1" max="2000" value={radius}
        onChange={event => setRadius(Number(event.target.value))} required /></label>
      <p className="coordinate-readout">{point ? `${point.latitude.toFixed(5)}°, ${point.longitude.toFixed(5)}°` : 'No pin selected'}</p>
      <details>
        <summary>Manual coordinates</summary>
        <div className="form-grid">
          <label>Latitude<input type="number" step="any" min="-90" max="90" value={latitude}
            onChange={event => setLatitude(event.target.value)} /></label>
          <label>Longitude<input type="number" step="any" min="-180" max="180" value={longitude}
            onChange={event => setLongitude(event.target.value)} /></label>
        </div>
        <button type="button" onClick={manualPoint}>Use coordinates</button>
      </details>
      {coordinateError && <p role="alert">{coordinateError}</p>}
      <details>
        <summary>Place details and preferences</summary>
        <fieldset className="form-grid" disabled={loading}>
          <label>Country code{unresolved('country')}<input name="country" pattern="[A-Za-z]{2}" value={country}
            onChange={event => { setCountry(event.target.value); editGeography('country', event.target.value); }} /></label>
          <label>Time zone{unresolved('timezone')}<input name="timezone" value={timezone} placeholder="UTC if unresolved"
            onChange={event => { setTimezone(event.target.value); editGeography('timezone', event.target.value); }} /></label>
          {geographyFields.map(([key, label]) => <label key={key}>{label}{unresolved(key)}
            <input value={geography[key] ?? ''} onChange={event => editGeography(key, event.target.value)}
              maxLength={key === 'formatted' ? 500 : key === 'postal_code' ? 32 : 120} /></label>)}
          <label>IPMA district code<input name="district" pattern="[A-Za-z]{3}" value={district}
            onChange={event => setDistrict(event.target.value)} /></label>
          <label>Language<select name="language" defaultValue={location?.language ?? 'en'}>
            <option value="en">English</option><option value="pt-PT">Português (Portugal)</option>
          </select></label>
          <label>Units<select name="units" defaultValue={location?.units ?? 'metric'}>
            <option value="metric">Metric</option><option value="imperial">Imperial</option>
          </select></label>
        </fieldset>
      </details>
      {(country || timezone || geography.formatted) && <p className="muted">
        {[geography.formatted || geography.city || country, timezone].filter(Boolean).join(' · ')}
      </p>}
      <input name="latitude" type="hidden" value={manualPending ? '' : point?.latitude ?? ''} />
      <input name="longitude" type="hidden" value={manualPending ? '' : point?.longitude ?? ''} />
      <input name="lookup_pending" type="hidden" value={loading ? "yes" : ""} />
      <input name="geography" type="hidden" value={JSON.stringify(geography)} />
    </div>
  </div>;
}

import { useEffect, useState, type FormEvent } from 'react';
import { api, type MapAsset } from './types';

export function AssetEditor({ assets, refresh }: { assets: MapAsset[]; refresh: () => void }) {
  const [chosen, choose] = useState<number>();
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<MapAsset>();
  const asset = assets.find(item => item.id === chosen);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? '').trim();
    try {
      const notice = field('notice_status') && field('notice_expiry') ? {
        status: field('notice_status'), direction: field('notice_direction'),
        source_url: field('notice_source'), expires_at: new Date(field('notice_expiry')).toISOString(),
      } : null;
      const updated = await api<{ id: number }>(asset ? '/map-assets/' + asset.id : '/map-assets', {
        kind: field('kind'), name: field('name'), latitude: Number(field('latitude')), longitude: Number(field('longitude')),
        source_url: field('source_url'), attribution: field('attribution'), enabled: data.has('enabled'),
        road: field('road') || null, camera_type: field('camera_type'), media_url: field('media_url') || null,
        refresh_seconds: Number(field('refresh_seconds')), licensing: field('licensing') || null, notice,
      });
      setMessage('Map asset saved.');
      choose(updated.id);
      refresh();
    } catch (error) { setMessage(String(error)); }
  }

  return <form onSubmit={save}>
    <h3>Watched roads, bridges and cameras</h3>
    <label>Map asset<select value={chosen ?? ''} onChange={event => {
      choose(event.target.value ? Number(event.target.value) : undefined); setPreview(undefined);
    }}>
      <option value="">New asset</option>{assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <div className="form-grid" key={asset?.id ?? 'new'}>
      <label>Asset name<input name="name" defaultValue={asset?.name} required maxLength={120} /></label>
      <label>Asset type<select name="kind" defaultValue={asset?.kind ?? 'bridge'}>
        <option value="bridge">Bridge</option><option value="road_watch">Watched road</option><option value="camera">Public camera</option>
      </select></label>
      <label>Asset latitude<input name="latitude" type="number" min="-90" max="90" step="any" defaultValue={asset?.latitude} required /></label>
      <label>Asset longitude<input name="longitude" type="number" min="-180" max="180" step="any" defaultValue={asset?.longitude} required /></label>
      <label>Publisher source URL<input name="source_url" type="url" defaultValue={asset?.source_url} required /></label>
      <label>Attribution<input name="attribution" defaultValue={asset?.attribution} required maxLength={200} /></label>
      <label>Road reference<input name="road" defaultValue={asset?.road ?? ''} /></label>
      <label>Camera presentation<select name="camera_type" defaultValue={asset?.camera_type ?? 'external'}>
        <option value="external">Publisher link</option><option value="snapshot">Snapshot</option>
        <option value="hls">HLS (native browser support)</option><option value="youtube">YouTube embed</option>
        <option value="iframe">Approved YouTube iframe</option>
      </select></label>
      <label>Permitted media URL<input name="media_url" type="url" defaultValue={asset?.media_url ?? ''} /></label>
      <label>Licensing or permission<input name="licensing" defaultValue={asset?.licensing ?? ''} /></label>
      <label>Minimum snapshot refresh (seconds)<input name="refresh_seconds" type="number" min="15" max="3600"
        defaultValue={asset?.refresh_seconds ?? 60} required /></label>
      <label><span>Enabled</span><input type="checkbox" name="enabled" defaultChecked={asset?.enabled ?? true} /></label>
      <label>Official bridge notice<select name="notice_status" defaultValue={asset?.notice?.status ?? ''}>
        <option value="">No active notice</option><option value="restricted">Restricted</option><option value="closed">Closed</option>
      </select></label>
      <label>Notice direction<select name="notice_direction" defaultValue={asset?.notice?.direction ?? 'both'}>
        <option value="both">Both directions</option><option value="northbound">Northbound</option><option value="southbound">Southbound</option>
      </select></label>
      <label>Notice source<input name="notice_source" type="url" defaultValue={asset?.notice?.source_url ?? ''} /></label>
      <label>Notice expiry (ISO timestamp)<input name="notice_expiry" defaultValue={asset?.notice?.expires_at ?? ''} /></label>
    </div>
    <div className="area-actions">
      <button className="primary-button">Save map asset</button>
      {asset?.kind === 'camera' && <button type="button" onClick={() => setPreview(asset)}>Test saved camera</button>}
    </div>
    {preview && <CameraView key={preview.id} asset={preview} />}
    {message && <p role="status">{message}</p>}
  </form>;
}

export function CameraView({ asset }: { asset: MapAsset }) {
  const [failure, setFailure] = useState(false);
  const [checked, setChecked] = useState<number>();
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(!document.hidden);
  const [refreshAllowed, setRefreshAllowed] = useState(true);
  useEffect(() => {
    const listener = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }, []);
  useEffect(() => {
    if (!checked) return;
    setRefreshAllowed(false);
    const timer = window.setTimeout(() => setRefreshAllowed(true), asset.refresh_seconds * 1000);
    return () => clearTimeout(timer);
  }, [checked, asset.refresh_seconds]);
  const nativeHls = typeof document !== 'undefined' && !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
  const loaded = () => { setChecked(Date.now()); setFailure(false); };
  const refresh = () => {
    setFailure(false); setChecked(undefined); setRevision(value => value + 1);
  };
  return <div className={expanded ? 'camera-view expanded-camera' : 'camera-view'}>
    <p>{asset.attribution} · {asset.latitude.toFixed(4)}°, {asset.longitude.toFixed(4)}°</p>
    <p>{asset.camera_type === 'external' || (asset.camera_type === 'hls' && !nativeHls)
      ? 'Publisher-hosted · check availability there'
      : failure ? 'Media unavailable' : checked ? 'Media loaded · source timestamp unavailable' : 'Source availability unverified'}</p>
    {visible && asset.media_url && asset.camera_type === 'snapshot' && !failure &&
      <img key={revision} alt={asset.name} src={asset.media_url} referrerPolicy="no-referrer" onLoad={loaded} onError={() => setFailure(true)} />}
    {visible && asset.media_url && ['youtube', 'iframe'].includes(asset.camera_type) &&
      <iframe title={asset.name} src={asset.media_url} allow="encrypted-media; fullscreen" referrerPolicy="strict-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation" allowFullScreen />}
    {visible && asset.media_url && asset.camera_type === 'hls' && nativeHls && !failure &&
      <video controls src={asset.media_url} onLoadedData={loaded} onError={() => setFailure(true)} />}
    <div className="area-actions">
      <a href={asset.source_url} target="_blank" rel="noreferrer">Open original source</a>
      {asset.camera_type !== 'external' && <button type="button" onClick={() => setExpanded(!expanded)}>{expanded ? 'Reduce' : 'Expand'}</button>}
      {asset.camera_type === 'snapshot' && <button type="button"
        disabled={!refreshAllowed}
        onClick={refresh}>Refresh snapshot</button>}
    </div>
  </div>;
}

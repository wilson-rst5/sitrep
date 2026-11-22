export type Geography = {
  country_name?: string | null; region?: string | null; district_name?: string | null;
  municipality?: string | null; city?: string | null; neighbourhood?: string | null;
  postal_code?: string | null; formatted?: string | null; resolved_fields?: string[];
};

export type Location = {
  id: number; name: string; country: string | null; geography?: Geography; is_primary?: boolean; district: string | null;
  latitude: number; longitude: number; radius: number;
  timezone: string; language: 'en' | 'pt-PT'; units: 'metric' | 'imperial';
};

export type Incident = {
  provider: string; external_id: string; category: string; title: string;
  description: string; occurred_at: string; updated_at: string; expires_at: string;
  latitude: number | null; longitude: number | null; severity: number;
  official: boolean; district: string | null; source_url: string;
  road?: string | null; original_source?: string | null; event_status?: string | null;
  delay_seconds?: number | null; direction_from?: string | null; direction_to?: string | null;
  reported_at?: string | null; line?: [number, number][] | null;
  magnitude: number | null; depth_km: number | null; forecast_date: string | null;
};

export type Provider = {
  id: string; name: string; category: string; state: string; docs: string;
  attempted_at: string | null; succeeded_at: string | null;
};

export type User = { username: string; role: 'admin' | 'viewer' };

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function api<T>(path: string, body?: object, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await fetch('/api/v1' + path, body ? {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  } : { method, signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ApiError(response.status, typeof error?.detail === 'string' ? error.detail :
      response.status === 422 ? 'Check the values entered.' : 'SITREP could not complete the request.');
  }
  return response.json() as Promise<T>;
}

export type MapAsset = {
  id: number; kind: 'bridge' | 'road_watch' | 'camera'; name: string; latitude: number; longitude: number;
  source_url: string; attribution: string; enabled: boolean; road?: string | null;
  camera_type: 'external' | 'snapshot' | 'hls' | 'iframe' | 'youtube'; media_url?: string | null;
  refresh_seconds: number; licensing?: string | null;
  notice?: { direction: 'both' | 'northbound' | 'southbound'; status: 'restricted' | 'closed';
    source_url: string; expires_at: string } | null;
};

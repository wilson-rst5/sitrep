export type Location = {
  id: number; name: string; country: string; district: string | null;
  latitude: number; longitude: number; radius: number;
  timezone: string; language: 'en' | 'pt-PT'; units: 'metric' | 'imperial';
};

export type Incident = {
  provider: string; external_id: string; category: string; title: string;
  description: string; occurred_at: string; updated_at: string; expires_at: string;
  latitude: number | null; longitude: number | null; severity: number;
  official: boolean; district: string | null; source_url: string;
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

export async function api<T>(path: string, body?: object): Promise<T> {
  const response = await fetch('/api/v1' + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  } : { signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ApiError(response.status, typeof error?.detail === 'string' ? error.detail :
      response.status === 422 ? 'Check the values entered.' : 'SITREP could not complete the request.');
  }
  return response.json() as Promise<T>;
}

# API

All data routes use `/api/v1`. Retrieve the machine-readable OpenAPI contract at `/api/openapi.json`.

Public routes include health, setup status, bootstrap and login. Login sets an HTTP-only SameSite session cookie. Authenticated writes require an exact configured Origin. Administrator routes include adding a monitoring area, updating it with `POST /api/v1/locations/{location_id}`, creating an account and viewing audit history. Viewer sessions can read dashboard data.

`GET /api/v1/events` accepts `location_id`, `category`, minimum `severity`, `limit` and `offset`. Repeat `category` to include multiple categories. Omit `location_id` for global coverage. Events sort by severity, event time, and identity. Expired events are excluded. A location uses circle coverage for points and a district code for nonspatial IPMA warnings.

`GET /api/v1/stream` sends an authenticated server-sent event when the event revision changes. Fetch the event list after an `events-changed` event. The server closes long-lived connections periodically and EventSource reconnects. Clients should also refresh on resume.

`GET /api/v1/alerts` lists the 200 highest-priority active alert records and the signed-in user’s acknowledgements. `POST /api/v1/alerts/acknowledge` accepts a provider and external ID. Repeating the acknowledgement preserves the original time. Acknowledgements remain available after the event expires.

`GET /api/v1/alert-rules` lists saved category overrides. An administrator can create or replace an override with `POST /api/v1/alert-rules`, using a category and a `minimum_severity` from 1 to 4. Categories without an override use severity 2.

`GET /api/v1/alerts/status` accepts `provider` and `external_id` query parameters and reports eligibility and the signed-in user's acknowledgement for a single active event. `GET /api/v1/alerts/history` returns up to 200 acknowledgements made by that user in the past 30 days, with snapshots taken at acknowledgement.

`GET /api/v1/related-events` accepts `provider` and `external_id` and lists up to ten active events within 24 hours of the selected event and within 50 km of its point, or in the same warning district when both events use district coverage. The list describes proximity in space and time.

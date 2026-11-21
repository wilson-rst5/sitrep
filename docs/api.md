# API

All data routes use `/api/v1`. Retrieve the machine-readable OpenAPI contract at `/api/openapi.json`.

Public routes include health, setup status, bootstrap and login. Login sets an HTTP-only SameSite session cookie. Authenticated writes require an exact configured Origin. Administrator routes include adding a monitoring area, creating an account and viewing audit history. Viewer sessions can read dashboard data.

`GET /api/v1/events` accepts `location_id`, `category`, minimum `severity`, `limit` and `offset`. Omit `location_id` for global coverage. Events sort by severity, event time, and identity. Expired events are excluded. A location uses circle coverage for points and a district code for nonspatial IPMA warnings.

`GET /api/v1/stream` sends an authenticated server-sent event when the event revision changes. Fetch the event list after an `events-changed` event. The server closes long-lived connections periodically and EventSource reconnects. Clients should also refresh on resume.

`GET /api/v1/alerts` lists the 200 highest-priority active alert records and the signed-in user’s acknowledgements. `POST /api/v1/alerts/acknowledge` accepts a provider and external ID. Repeating the acknowledgement preserves the original time. Acknowledgements follow the event’s retention period.

# Implementation checklist

- [x] Write Compose manifests, Alembic migration and service entry points
- [x] Implement one-time administrator bootstrap, role checks and dashboard views
- [x] Implement USGS and IPMA warning adapters, durable ingestion and event storage
- [x] Implement geospatial filtering, provider freshness, live signals and alert acknowledgement
- [x] Add kiosk controls, responsive layout, PWA offline page, CI and release workflows
- [ ] Build and start containers, run migrations and verify health
- [ ] Run provider, broker, API and browser tests, and verify live data in the dashboard
- [ ] Add IPMA weather observations and forecasts, a permitted news feed and OpenSky aviation
- [ ] Add incident, traffic, wildfire, air quality, maritime and imagery sources as permitted
- [ ] Add monitoring rules, correlation, alert history, richer setup and administration
- [ ] Measure prolonged kiosk performance and complete dependency, licence and secret audits
- [ ] Publish GitHub repository and GHCR images after the release gates pass

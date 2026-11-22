# Changelog

## 0.3.0-rc.1

- Promoted the operational map to the full workspace, with floating filters, event selection and a map-only view.
- Separated forecasts and observations from the operational feed.
- Added optional TomTom, Trânsito Agora and NASA FIRMS adapters and a configurable bridge, road and public camera registry.

## 0.2.0-rc.1

- Added labeled OpenFreeMap basemaps and a bundled MapLibre worker.
- Added map-based setup and area management with draggable pins, radius previews, offline time zones and configurable address lookup.
- Added the map-centered operations layout, weather intelligence, headlines and kiosk display options.

## 0.1.0-rc.3

- Added a News view with NOAA headlines and original article links.

## 0.1.0-rc.2

- Added configurable alert thresholds and 30-day acknowledgement history.
- Added IPMA station observations and three-day forecasts to the Weather view.
- Added administrator editing of monitoring areas and related-event lookup.
- Added NASA EONET wildfire and natural incident reports to the Emergency view.

## 0.1.0-rc.1

- Added administrator bootstrap, session authentication, monitoring areas and viewer roles.
- Added USGS earthquake and IPMA district warning adapters using JetStream and PostGIS.
- Added a responsive operational dashboard with incident attribution, connectivity and provider status.
- Added Docker Compose manifests, PWA offline fallback and GitHub Actions for testing and GHCR image publishing.

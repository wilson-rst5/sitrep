# SITREP

SITREP is a self-hosted civilian situation awareness dashboard. The initial implementation displays attributed earthquake reports and Portuguese district weather warnings, station observations, and daily forecasts, with an interactive map, local and global views, provider freshness, and a kiosk layout.

SITREP is an early development build. Use official channels for emergency instructions. See the [verification record](docs/validation.md) for deployment and test status.

## Quick start

On a Docker host with Compose v2, run these commands from the repository root.

```sh
./scripts/init-env.sh
docker compose up --build --wait
```

Open [the dashboard](http://localhost:8080/). Use the generated `SETUP_TOKEN` in the ignored `.env` file to create the first administrator. Choose a point on the interactive map, review available location details, and confirm a monitoring radius. Enter the IPMA district code if you want district warnings in the local view.

Web traffic binds to the loopback interface by default. See [deployment](docs/deployment.md) for HTTPS, LAN kiosks, PWA installation, persistence and rollback. The maps use OpenFreeMap by default, with bundled Natural Earth country boundaries available offline. See [map and location configuration](docs/maps-and-location.md) for provider setup.

## Operations map

The map is the primary workspace. Layer controls, incident filtering and source details open on demand. Set the monitoring area to focus the map, or use Map only for a clean display. See [traffic and map assets](docs/traffic-and-map-assets.md) for optional licensed feeds and deployment-owned bridges, watched roads and public cameras.

## Data and architecture

| Provider | Coverage | Implementation |
| --- | --- | --- |
| USGS GeoJSON | Worldwide | Live ingestion verified in local Compose |
| IPMA warnings, station observations and daily forecasts | Portugal | Implemented |
| NASA EONET | Worldwide | Implemented for open incidents with point locations |
| NOAA News | NOAA publications | Attributed headlines and original article links |
| OpenSky, TomTom, NASA FIRMS | Provider-specific | Planned, account or key requirements apply |
| AIS-Catcher and local ADS-B | Receiver coverage | Planned, compatible hardware or authorised feed required |
| Additional incident, news, environment and weather data | Provider-specific | Planned, subject to documented terms |

A React dashboard talks to a same-origin FastAPI service. Independent collector and consumer processes send validated observations through NATS JetStream and store them in PostgreSQL/PostGIS. The authenticated event stream signals changes to the browser, with a bounded polling fallback.

The versioned REST API starts at `/api/v1/`. Its machine-readable contract is at `/api/openapi.json`. See [API documentation](docs/api.md), [architecture](docs/architecture.md), and the [provider guide](docs/provider-development.md).

For development and contributions, see [CONTRIBUTING.md](CONTRIBUTING.md) and [testing](docs/testing.md). For source requirements and restrictions, see [data sources](docs/data-sources.md). For deployment problems, see [troubleshooting](docs/troubleshooting.md).

Original SITREP source is licensed under [Apache 2.0](LICENSE). Source data and optional map styles follow their respective providers’ terms.

Live aircraft can be enabled on the operational map. See [Aviation setup, limits and attribution](docs/aviation.md).

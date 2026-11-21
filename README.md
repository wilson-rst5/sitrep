# SITREP

SITREP is a self-hosted civilian situation awareness dashboard. The initial implementation displays attributed earthquake reports and Portuguese district weather warnings, with an interactive map, local and global views, provider freshness, and a kiosk layout.

SITREP is an early development build. Use official channels for emergency instructions. See the [verification record](docs/validation.md) for deployment and test status.

## Quick start

On a Docker host with Compose v2, run these commands from the repository root.

```sh
./scripts/init-env.sh
docker compose up --build --wait
```

Open [the dashboard](http://localhost:8080/). Use the generated `SETUP_TOKEN` in the ignored `.env` file to create the first administrator. Enter a monitoring area name, ISO country code, coordinates, radius, IANA time zone and display language. For Portuguese warnings, also enter the relevant IPMA district code. Sign in using the username and password you created.

Web traffic binds to the loopback interface by default. See [deployment](docs/deployment.md) for HTTPS, LAN kiosks, PWA installation, persistence and rollback. The Docker build packages a small, public-domain Natural Earth basemap. Configure a licensed MapLibre style for finer geographic detail.

## Data and architecture

| Provider | Coverage | Implementation |
| --- | --- | --- |
| USGS GeoJSON | Worldwide | Live ingestion verified in local Compose |
| IPMA warnings | Portugal | Live ingestion verified in local Compose |
| OpenSky, TomTom, NASA FIRMS | Provider-specific | Planned, account or key requirements apply |
| AIS-Catcher and local ADS-B | Receiver coverage | Planned, compatible hardware or authorised feed required |
| Additional incident, news, environment and weather data | Provider-specific | Planned, subject to documented terms |

A React dashboard talks to a same-origin FastAPI service. Independent collector and consumer processes send validated observations through NATS JetStream and store them in PostgreSQL/PostGIS. The authenticated event stream signals changes to the browser, with a bounded polling fallback.

The versioned REST API starts at `/api/v1/`. Its machine-readable contract is at `/api/openapi.json`. See [API documentation](docs/api.md), [architecture](docs/architecture.md), and the [provider guide](docs/provider-development.md).

For development and contributions, see [CONTRIBUTING.md](CONTRIBUTING.md) and [testing](docs/testing.md). For source requirements and restrictions, see [data sources](docs/data-sources.md). For deployment problems, see [troubleshooting](docs/troubleshooting.md).

Original SITREP source is licensed under [Apache 2.0](LICENSE). Source data and optional map styles follow their respective providers’ terms.

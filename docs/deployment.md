# Deployment

Use Docker Engine, the Compose plugin and OpenSSL. Run `./scripts/init-env.sh` and `docker compose up --build --wait`. The bootstrap token is in the ignored `.env` file. The setup endpoint closes after the first administrator is committed. Retain the database password securely.

## Additional public feeds

New installations enable the two IPMA weather feeds by default. To enable them on an existing installation, add `ipma-observations,ipma-forecasts` to the existing comma-separated `ENABLED_PROVIDERS` value in the ignored `.env` file and recreate the services. Add `nasa-eonet` to enable the natural incident feed on existing installations. Each installation retains its configured list of enabled providers.

## Local display, LAN and HTTPS

The default origin is `http://localhost:8080`. For a separate display device, terminate HTTPS at a reverse proxy on the Docker host, proxy to port 8080, and set `PUBLIC_ORIGIN` to the exact HTTPS origin and `SECURE_COOKIES=true`. Keep the Compose port bound to loopback where the proxy is on the same host. Keep authentication enabled. Preserve the upstream host and allow streamed responses.

Set `MAP_STYLE_URL` to an HTTPS MapLibre style whose licence and terms permit the intended use. Rebuild the web image after changing it. The Docker image serves a low-resolution Natural Earth basemap locally. Building the image requires access to the pinned Natural Earth release on GitHub.

## Kiosk and PWA

Sign in at the HTTPS origin on the display device. Open `/?kiosk=1` or use the Kiosk button. On a Linux display host with Chromium installed, launch it with the browser profile you use for SITREP.

```sh
chromium --kiosk https://sitrep.example.org/?kiosk=1
```

On mobile, use the browser’s install or Add to Home Screen action over HTTPS. The PWA contains an offline status page. Data and authentication requests remain network-bound.

## Persistence

Compose creates PostgreSQL and JetStream volumes. Before upgrading, take a PostgreSQL logical backup and a consistent broker snapshot, then test restoring both in a separate project. To dump the database from the Docker host, redirect this command to a private directory outside the repository.

```sh
docker compose exec -T db pg_dump -U sitrep -Fc sitrep > /path/to/private/sitrep.dump
```

For restore, use an isolated database and `pg_restore --exit-on-error` with the saved dump. Keep the matching release settings and image tags. Existing volumes survive ordinary `docker compose down`.

## Prebuilt images

The [0.1.0 release candidate](https://github.com/wilson-rst5/sitrep/releases/tag/v0.1.0-rc.2) publishes Linux amd64 images. Add these settings to the generated `.env` on the Docker host, replacing the example origin with your HTTPS origin.

```dotenv
SITREP_CORE_IMAGE=ghcr.io/wilson-rst5/sitrep-core:0.1.0-rc.2
SITREP_WEB_IMAGE=ghcr.io/wilson-rst5/sitrep-web:0.1.0-rc.2
SITREP_HTTPS_ORIGIN=https://sitrep.example.org
```

```sh
docker compose -f compose.yaml -f compose.prod.yaml up -d --wait
```

Keep the previously deployed image references for rollback and check database migration compatibility before rolling back.

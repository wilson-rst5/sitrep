# Validation

The public source is on the `main` branch of [SITREP on GitHub](https://github.com/wilson-rst5/sitrep). GitHub Actions runs lint, dependency audits, provider tests, a Compose and Chromium smoke test, and a Git history secret scan. Release tags repeat those checks before publishing images to GHCR. See [GitHub Actions](https://github.com/wilson-rst5/sitrep/actions) for results by commit and release tag.

| Check | Coverage |
| --- | --- |
| Docker Compose | Builds the core and web images, starts PostGIS and NATS JetStream, applies the Alembic migration, and waits for the API and web health checks. |
| Published images | Pulled both Linux amd64 images anonymously and started the production Compose configuration in an isolated project. The API returned `ready` through the web proxy. |
| Ingestion and dashboard | Sends duplicate near and far event fixtures through JetStream. Chromium verifies administrator bootstrap, sign-in, filtering, alert rules and history, related events, monitoring-area edits, viewer permissions, kiosk mode and mobile layout. |
| Provider normalization | Eight pytest cases cover USGS, IPMA, NASA EONET and NOAA RSS fixtures and validation. |
| Database upgrade | Applied the alert migration to a database with an existing acknowledgement, verified snapshot backfill, and deleted the original test event to verify independent history retention. |
| Kiosk smoke soak | An isolated Chromium session stayed responsive and showed a stable event count for three minutes over six refresh intervals. |
| Application licence inventory | Checked declared npm lockfile and installed Python package licences. Container base-image packages and data redistribution terms require separate review. |
| Publication review | Gitleaks scans the publication files and public Git history. Environment files, local deployment overrides and private workspace data are ignored. |

The automated browser test uses simulated events with live providers disabled. A separate local Compose run fetched live USGS and IPMA data, persisted both feeds, and displayed a live USGS earthquake in the authenticated dashboard. The new IPMA observation and forecast adapters also normalized live responses. Deployment on the intended production host remains open in the [roadmap](roadmap.md).

## Map and location redesign

The previously published web image reproduced the basemap error in Chromium. The console reported that the MapLibre worker failed to load, while the bundled Natural Earth geometry was present. The redesign bundles a worker URL explicitly and uses labeled OpenFreeMap vector styles. The browser suite exercises a real vector-tile response and intentionally blocks the primary style in a separate case to check the offline option.

The setup suite uses a disposable installation and synthetic test records. It checks click and drag, input coordinates, timezone resolution, radius, save and reload, and the existing dashboard and viewer-role flows. The local validation screenshots use a test area and stay outside the tracked repository.

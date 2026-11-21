# Validation

The public source is on the `main` branch of [SITREP on GitHub](https://github.com/wilson-rst5/sitrep). GitHub Actions runs lint, dependency audits, provider tests, a Compose and Chromium smoke test, and a Git history secret scan. Release tags repeat those checks before publishing images to GHCR.

| Check | Coverage |
| --- | --- |
| Docker Compose | Builds the core and web images, starts PostGIS and NATS JetStream, applies the Alembic migration, and waits for the API and web health checks. |
| Ingestion and dashboard | Sends duplicate near and far event fixtures through JetStream. Chromium verifies administrator bootstrap, sign-in, local and global filtering, acknowledgement, kiosk mode, and mobile layout. |
| Provider normalization | Three pytest cases cover USGS and IPMA fixture data and event validation. |
| Publication review | Gitleaks scans the publication files and public Git history. Environment files, local deployment overrides and private workspace data are ignored. |

The automated browser test uses simulated events with live providers disabled. A separate local Compose run fetched live USGS and IPMA data, persisted both feeds, and displayed a live USGS earthquake in the authenticated dashboard. Extended kiosk operation and production deployment remain open in the [roadmap](roadmap.md).

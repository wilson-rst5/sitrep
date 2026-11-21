# Development

Use Python 3.13, Node.js 24, Docker and Compose. Run `scripts/init-env.sh` and `docker compose -f compose.yaml -f compose.dev.yaml up --build` for API reload. To develop the UI, install dependencies under `apps/web`. Set `SITREP_DEV_PROXY` to the local Compose origin and run `npm run dev`. The API origin must then match the browser’s development origin. Use the Docker web image for the packaged Natural Earth basemap, or place the corresponding licensed GeoJSON at `apps/web/public/countries.geojson` for local Vite development.

Use temporary, isolated databases for automated tests. Test fixture records belong in test files. Run `PYTHONPATH=services/core python -m pytest tests/unit` from the root after installing Python requirements and pytest. See [testing](testing.md) for Compose and browser checks.

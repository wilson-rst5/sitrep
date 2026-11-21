# Troubleshooting

- If Compose rejects configuration, run `scripts/init-env.sh` once and verify you have a supported Compose version.
- If login writes fail with an Origin error, verify that the public browser origin exactly matches `PUBLIC_ORIGIN`. Check proxy headers and the secure-cookie setting.
- If the map needs finer detail than the packaged Natural Earth basemap, configure a licensed MapLibre style and rebuild the web image. Check browser WebGL availability if the map cannot initialise.
- If the provider panel is offline, inspect `docker compose logs collector` and verify the host can resolve provider domains and establish HTTPS connections.
- If a location has no results, verify its coordinates, radius and IPMA district code. Global mode can help check available reports.

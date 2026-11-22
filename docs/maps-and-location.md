# Maps and monitoring areas

## Basemap

SITREP serves the MapLibre worker as a bundled same-origin asset. OpenFreeMap Liberty is the setup style and OpenFreeMap Dark is the operations style. The browser requests their vector tiles, glyphs and sprites over HTTPS. The style supplies attribution for OpenFreeMap, OpenMapTiles and OpenStreetMap.

Override the following build arguments in the ignored `.env` and rebuild the web image if needed.

| Setting | Purpose |
| --- | --- |
| `MAP_LIGHT_STYLE_URL` | Setup and location editor style |
| `MAP_DARK_STYLE_URL` | Operations style |
| `MAP_STYLE_URL` | Shared style when a theme-specific override is absent |
| `MAP_FALLBACK_STYLE_URL` | Optional secondary provider |

Use an HTTPS MapLibre style that permits your deployment origin, including its tile, glyph and sprite resources. MapTiler, other licensed providers and self-hosted services can use this interface. A self-hosted tile server can serve data from PMTiles through an HTTP tile gateway. Style URLs and any browser-designated keys are public in the built JavaScript. Restrict browser keys with your provider and keep private credentials server-side. Maintain the style's data attribution. The [OpenFreeMap terms](https://openfreemap.org/tos/) describe usage and availability.

On failure, the map offers retry, any configured secondary style and the bundled Natural Earth country-boundary map. The offline map has lower detail. Development builds show a diagnostic with the failing resource host. Full request URLs may include public browser keys, so keep browser network traces private.

## Location setup and management

Click the map to place a pin and drag it to refine the position. Pick a radius and review the location before saving. Settings uses the same picker for adding and editing areas. Administrators can set the primary area or delete an area. Deleting an area leaves event and acknowledgement records intact.

Coordinates are WGS84. API properties are named `latitude` and `longitude`. MapLibre, GeoJSON and PostGIS point constructors take **longitude, latitude**. The clicked point remains authoritative. Reverse geocoding can return address information for a nearby feature, which is editable. The IPMA district identifier is a separate manual field.

Timezone resolution works offline. Device location requires explicit permission and a secure browser context. Manual coordinates and place labels remain available when geocoding is disabled or fails.

## Geocoder configuration

Set `GEOCODER_URL` to the full reverse endpoint of an authorized Nominatim-compatible hosted service or an instance you operate. Optionally set `GEOCODER_SEARCH_URL` to its search endpoint and `GEOCODER_TOKEN` for an HTTPS service that uses bearer authentication. A token-free self-hosted service can use HTTP on a private Compose network. The public OpenStreetMap Foundation Nominatim service is excluded.

Requests require a session or the active first-run setup token. The proxy rate-limits lookups, and repeated reverse results are cached per API process. Configure provider access according to its usage terms. Coordinates and search terms are sent to the configured provider. [Nominatim server documentation](https://nominatim.org/release-docs/latest/admin/Installation/)

# Traffic intelligence and map assets

## Operational map

The default incident query requests hazards and traffic reports within the saved monitoring radius. The Weather mode retains station observations and forecasts. Those records do not appear in the operational incident feed. District-only warnings stay in the feed until a matching geographic area is available. Headlines without source coordinates have no map marker.

Layer changes update the same MapLibre instance. Incidents are clustered, reported road geometries render as lines, and cameras and watched assets use distinct markers. Camera and bridge markers are deployment records. Use the map controls to return to the selected area, fit the displayed incidents or hide the overlays in Map only mode.

## Licensed feeds

Keep all keys in the ignored deployment environment. Activate only integrations covered by your provider agreement. Confirm rights to overlay the data on another basemap, temporarily cache it and expose it to authorized users before enabling it.

| Provider | Variables | Coverage |
| --- | --- | --- |
| TomTom Orbis raster traffic | `TOMTOM_API_KEY`, `TOMTOM_FLOW_ENABLED=true` | Authenticated same-origin PNG proxy. Tiles use the Orbis dark style and refresh every minute. |
| TomTom Orbis incidents | `TOMTOM_API_KEY`, `TOMTOM_INCIDENTS_ENABLED=true`, `TOMTOM_TRAFFIC_BBOX` | Active reports within a configured west,south,east,north box capped at 0.75° per axis. |
| TomTom nearest segment | `TOMTOM_API_KEY`, `TOMTOM_SEGMENT_ENABLED=true` | Separate Traffic Flow Segment Data entitlement. A saved road or bridge displays the nearest sample when available. The direction and bridge association are unverified. |
| Trânsito Agora | `TRANSITO_AGORA_API_KEY` | Active Portuguese GeoJSON reports. One collector request per five minutes with backoff. |
| NASA FIRMS | `FIRMS_MAP_KEY`, `FIRMS_BBOX` | NOAA-20 VIIRS observations in a configured west,south,east,north box. These are thermal anomalies, separate from confirmed fire reports. |

TomTom's raster style uses speed relative to free flow. Green indicates at least 75%, amber 35–75%, red-orange 15–35%, and dark red under 15%. Closures have a separate symbol in the provider's raster. The app uses TomTom's rendered colors directly and leaves road opacity adjustable. Provider credentials stay in the API or collector. The API limits upstream tile and segment requests to 180 per minute per process and caches tiles in memory for 25 seconds. Incident records are current reports, typically expiring within eight minutes of the last successful TomTom fetch. Enable the TomTom incident collector only if your agreement also permits SITREP's persistence and alert acknowledgement snapshot retention. [Orbis flow documentation](https://docs.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/v2/traffic-flow/raster-flow-tiles) · [TomTom terms](https://www.tomtom.com/en-gb/legal/third-party-product-terms/)

Trânsito Agora requires a key even on its temporary trial and requires both map attribution and original-source attribution. SITREP uses stable provider IDs for deduplication. Reports from distinct providers remain separate when their identities cannot be established. Lack of a report conveys no road clearance. [Trânsito Agora documentation](https://transitoagora.pt/api-publica)

## Bridges, watched roads and cameras

Administrators can add or edit point locations under **Settings → Watched roads, bridges and cameras**. Store a verified point and an original operator link. Northbound and southbound status are unknown by default. An administrator can record a time-limited attributed closure or restriction for a reported direction. Matching road-reference reports are shown as corridor reports. They do not establish the bridge's condition.

The Port of Lisbon publishes public Tejo Live views. Its VTS camera can be located at the Algés control tower. A publisher-link marker is appropriate. It does not verify an inline stream or establish road traffic conditions. [Port of Lisbon Tejo Live](https://www.portodelisboa.pt/en/tejo-live) · [Algés control tower location](https://www.cienciaviva.pt/verao/2026/index.php?accao=showactivities&id_activity=10532&id_tag=787)

Use verified HTTPS sources. Public snapshots and browser-supported HLS load directly from their publisher. The approved iframe hosts are YouTube and YouTube NoCookie. Other providers can use a publisher link. Source URLs are never fetched by the backend. Provide licensing or permission details before enabling inline media. The snapshot refresh interval applies to manual refreshes, and playback is removed when the drawer closes or the browser tab is hidden. Camera image timestamps and availability are displayed only when known.

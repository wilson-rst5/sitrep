# Aviation tracking

Enable Live aircraft in Layers or open Aviation from the command bar. The Aviation view shows the coverage radius, provider health, observation ages and aircraft filters. Select a symbol or aircraft list entry for details. True track determines symbol rotation when reported. Unknown tracks have a diamond marker.

Deployment administrators can change the primary provider, fallback and independent 25–450 km aviation radius in Settings. The collector covers the primary monitoring area. Switching to another area in the dashboard does not trigger an upstream request. Settings and latest observations persist in PostgreSQL. GeoJSON coordinates are WGS84 in longitude, latitude order. Changing the aviation radius leaves emergency filtering unchanged.

## Providers

- [ADSB.lol](https://www.adsb.lol/docs/open-data/api) is enabled by default. The documented 500 requests per UTC day per IP are shared with any other software behind that IP. SITREP sends at most one request every 200 seconds with a 450-request daily ceiling. Anonymous access is subject to provider eligibility and best-effort availability. Set `ADSBLOL_ENABLED=false` to turn it off or supply a permitted `ADSBLOL_API_KEY` in the server-side environment. The deployment keeps the same conservative ceiling with a key. Radius is rounded up in nautical miles before requesting and exactly filtered in kilometres after retrieval.
- [OpenSky](https://openskynetwork.github.io/opensky-api/rest.html) is optional. Set `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` using the backend environment. Check [OpenSky’s terms](https://opensky-network.org/about/terms-of-use) before use. SITREP requests geographic state vectors using OAuth2 client credentials and respects the service's credit response and retry headers. Bounding-box area affects credit cost.
- `AVIATION_POLL_SECONDS` can slow polling. The enforced minima are 200 seconds for ADSB.lol and 120 seconds for OpenSky. Restart API and collector services when changing environment configuration. Credentials stay in the server environment and are never returned through endpoints.

ADSB.lol data is available under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Keep attribution and comply with applicable share-alike and redistribution obligations if publishing derived databases. SITREP does not redistribute aircraft enrichment from external registries.

Provider scope and diagnostics are exposed through the authenticated `/api/v1/aviation/aircraft`, `/aviation/status` and `/aviation/providers` routes under `/api/v1`. The aircraft result can be filtered further by supplying latitude, longitude and radius in kilometres together. Provider failures retain last-known positions until expiry and distinguish no coverage, authentication failures, network failures and limits. Observations older than 15 minutes expire. SITREP does not extrapolate positions or store flight trails.

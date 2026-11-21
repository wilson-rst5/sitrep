# Data sources

| Source | Data | Poll interval | Requirements |
| --- | --- | --- | --- |
| [USGS GeoJSON](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | Past-day worldwide earthquakes with source attribution, magnitude, depth and epicentre | 120 seconds | Public HTTPS |
| [IPMA open data](https://api.ipma.pt/) | Yellow, orange and red district warnings, validity window and source description | 600 seconds | Public HTTPS. Local warning views require an applicable district code. |
| [IPMA station observations](https://api.ipma.pt/) | Latest available station temperature, humidity, wind and hourly precipitation | 900 seconds | Public HTTPS |
| [IPMA daily forecasts](https://api.ipma.pt/) | Three calendar days of low and high temperatures and precipitation probability for published localities | 1800 seconds | Public HTTPS |
| [NASA EONET](https://eonet.gsfc.nasa.gov/docs/v3) | Recent open natural incidents and wildfires with reported point locations | 1800 seconds | Public HTTPS |

USGS seismicity is displayed independently of tsunami alerts. IPMA warnings use district identifiers. Observations and forecasts use IPMA coordinates and appear as informational entries in the Weather view. Review the [IPMA terms](https://api.ipma.pt/) for use and attribution.

EONET reports are approximate situational context. Event details link to the curated NASA records.

OpenSky requires integration and terms validation for the intended use. NASA FIRMS, TomTom, EFFIS, Portuguese incident feeds, news, air quality, imagery, tides and infrastructure feeds have no production adapters in this build. AIS-Catcher and ADS-B receiver adapters remain planned.

The repository ships application code and original icons. The Docker build adds a low-resolution country basemap from [Natural Earth v5.1.2](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2). Natural Earth releases its vector data into the public domain. Verify provider usage terms before redistribution. Inspect dependency licences as part of release review.

# Data sources

| Source | Data | Poll interval | Requirements |
| --- | --- | --- | --- |
| [USGS GeoJSON](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | Past-day worldwide earthquakes with source attribution, magnitude, depth and epicentre | 120 seconds | Public HTTPS |
| [IPMA open data](https://api.ipma.pt/) | Yellow, orange and red district warnings, validity window and source description | 600 seconds | Public HTTPS. Local warning views require an applicable district code. |

USGS seismicity is displayed independently of tsunami alerts. IPMA district warnings have no generated coordinates. IPMA observation and forecast adapters are separate future capabilities.

OpenSky requires integration and terms validation for the intended use. NASA FIRMS, TomTom, EFFIS, Portuguese incident feeds, news, air quality, imagery, tides and infrastructure feeds have no production adapters in this build. AIS-Catcher and ADS-B receiver adapters remain planned.

The repository ships application code and original icons. The Docker build adds a low-resolution country basemap from [Natural Earth v5.1.2](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2). Natural Earth releases its vector data into the public domain. Verify provider usage terms before redistribution. Inspect dependency licences as part of release review.

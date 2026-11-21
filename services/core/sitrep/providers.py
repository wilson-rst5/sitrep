"""Provider contracts and deterministic transformations. No arbitrary feed URLs."""
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from math import isfinite
from collections.abc import Callable, Iterable
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, BaseModel, Field, HttpUrl, model_validator


class Event(BaseModel):
    provider: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,49}$")
    external_id: str = Field(min_length=1, max_length=160)
    category: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=2500)
    occurred_at: AwareDatetime
    updated_at: AwareDatetime
    expires_at: AwareDatetime
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    severity: int = Field(ge=0, le=4)
    official: bool = False
    district: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    source_url: HttpUrl
    magnitude: float | None = Field(default=None, allow_inf_nan=False)
    depth_km: float | None = Field(default=None, allow_inf_nan=False)
    forecast_date: date | None = None

    @model_validator(mode="after")
    def validate_event(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Position requires latitude and longitude")
        if self.severity == 4 and not self.official:
            raise ValueError("Critical warnings require an official source")
        if self.expires_at <= self.occurred_at:
            raise ValueError("Expiration must follow occurrence")
        for field in ("occurred_at", "updated_at", "expires_at"):
            setattr(self, field, getattr(self, field).astimezone(UTC))
        return self


def usgs(document, fetched_at):
    if document["type"] != "FeatureCollection" or not isinstance(document["features"], list):
        raise ValueError("Invalid GeoJSON collection")
    for feature in document["features"]:
        properties = feature["properties"]
        geometry = feature["geometry"]
        if geometry["type"] != "Point" or properties["type"] != "earthquake":
            continue
        longitude, latitude, depth = geometry["coordinates"]
        occurred = datetime.fromtimestamp(properties["time"] / 1000, UTC)
        magnitude = properties["mag"]
        url = properties["url"]
        if urlsplit(url).scheme != "https" or urlsplit(url).netloc != "earthquake.usgs.gov":
            raise ValueError("Unexpected USGS attribution URL")
        yield Event(
            provider="usgs", external_id=feature["id"], category="earthquake",
            title=properties["title"], description=properties.get("place") or "",
            occurred_at=occurred, updated_at=datetime.fromtimestamp(properties["updated"] / 1000, UTC),
            expires_at=occurred + timedelta(days=7), latitude=latitude, longitude=longitude,
            magnitude=magnitude, depth_km=depth, severity=2 if magnitude is not None and magnitude >= 5 else 1,
            official=True, source_url=url,
        )


def utc_timestamp(value):
    timestamp = datetime.fromisoformat(value)
    return timestamp.replace(tzinfo=UTC) if timestamp.tzinfo is None else timestamp.astimezone(UTC)


def ipma(document, fetched_at):
    if not isinstance(document, list):
        raise ValueError("Invalid IPMA warning collection")
    for row in document:
        level = row["awarenessLevelID"].lower()
        if level == "green":
            continue
        severity = {"yellow": 2, "orange": 3, "red": 4}[level]
        district = row["idAreaAviso"]
        start = utc_timestamp(row["startTime"])
        end = utc_timestamp(row["endTime"])
        if end <= fetched_at:
            continue
        phenomenon = row["awarenessTypeName"]
        identity = hashlib.sha256(json.dumps(
            [district, phenomenon, start.isoformat()], ensure_ascii=True,
        ).encode()).hexdigest()
        yield Event(
            provider="ipma-warnings", external_id=identity, category="weather_warning",
            title=phenomenon, description=row.get("text") or "",
            severity=severity, official=True, district=district,
            occurred_at=start, updated_at=fetched_at, expires_at=end,
            source_url="https://www.ipma.pt/pt/otempo/prev-sam/",
        )


IPMA_URL = "https://api.ipma.pt/"
IPMA_DATA = IPMA_URL + "open-data/"
OBSERVATION_URL = IPMA_DATA + "observation/meteorology/stations/obs-surface.geojson"
FORECAST_URLS = tuple(
    IPMA_DATA + f"forecast/meteorology/cities/daily/hp-daily-forecast-day{day}.json"
    for day in range(3)
)


def weather_measurement(value, unit):
    try:
        number = float(value)
    except (ValueError, TypeError):
        return None
    if isfinite(number) and number != -99:
        return f"{number:g} {unit}"
    return None


def ipma_observations(document, fetched_at):
    if document["type"] != "FeatureCollection" or not isinstance(document["features"], list):
        raise ValueError("Invalid IPMA station collection")
    latest = {}
    for feature in document["features"]:
        geometry = feature["geometry"]
        if geometry["type"] != "Point" or not geometry["coordinates"]:
            continue
        longitude, latitude = geometry["coordinates"]
        row = feature["properties"]
        station = str(row["idEstacao"])
        observed = utc_timestamp(row["time"])
        expires = observed + timedelta(hours=4)
        if expires <= fetched_at or (station in latest and latest[station].occurred_at >= observed):
            continue
        measurements = [
            (label, weather_measurement(row.get(key), unit))
            for label, key, unit in (
                ("Temperature", "temperatura", "°C"),
                ("Humidity", "humidade", "%"),
                ("Wind", "intensidadeVentoKM", "km/h"),
                ("Hourly precipitation", "precAcumulada", "mm"),
            )
        ]
        if not any(value for _, value in measurements):
            continue
        latest[station] = Event(
            provider="ipma-observations", external_id=station, category="weather_observation",
            title=f"Station observation · {row['localEstacao']}",
            description=" · ".join(f"{label} {value}" for label, value in measurements if value),
            occurred_at=observed, updated_at=observed, expires_at=expires,
            longitude=longitude, latitude=latitude, severity=0, official=True,
            source_url=OBSERVATION_URL,
        )
    yield from latest.values()


def ipma_forecasts(documents, fetched_at):
    *forecasts, locations = documents
    places = {row["globalIdLocal"]: row for row in locations["data"]}
    for document, source in zip(forecasts, FORECAST_URLS, strict=True):
        day = date.fromisoformat(document["forecastDate"])
        updated = utc_timestamp(document["dataUpdate"])
        for row in document["data"]:
            identifier = row["globalIdLocal"]
            place = places.get(identifier, {})
            zone = ZoneInfo("Atlantic/Azores" if place.get("idRegiao") == 3 else "Europe/Lisbon")
            start = datetime.combine(day, time.min, zone)
            expires = datetime.combine(day + timedelta(days=1), time.min, zone)
            if expires <= fetched_at:
                continue
            measurements = [
                (label, weather_measurement(row.get(key), unit))
                for label, key, unit in (
                    ("Low", "tMin", "°C"), ("High", "tMax", "°C"),
                    ("Rain probability", "precipitaProb", "%"),
                )
            ]
            if not any(value for _, value in measurements):
                continue
            yield Event(
                provider="ipma-forecasts", external_id=f"{identifier}-{day}", category="weather_forecast",
                title=f"Daily forecast · {place.get('local', identifier)}",
                description=" · ".join(f"{label} {value}" for label, value in measurements if value),
                occurred_at=start, updated_at=updated, expires_at=expires, forecast_date=day,
                longitude=row["longitude"], latitude=row["latitude"], severity=0, official=True,
                source_url=source,
            )


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    docs: str
    url: str
    category: str
    coverage: str
    interval_seconds: int
    normalize: Callable[[object, datetime], Iterable[Event]]
    terms: str
    credentials: str = "none"
    additional_urls: tuple[str, ...] = ()


PROVIDERS = (
    Provider("usgs", "USGS", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
             "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
             "earthquake", "Worldwide", 120, usgs, "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits"),
    Provider("ipma-warnings", "IPMA", "https://api.ipma.pt/",
             "https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json",
             "weather_warning", "Portugal", 600, ipma, "https://api.ipma.pt/"),
    Provider("ipma-observations", "IPMA station observations", IPMA_URL,
             OBSERVATION_URL, "weather_observation", "Portugal", 900, ipma_observations, IPMA_URL),
    Provider("ipma-forecasts", "IPMA daily forecasts", IPMA_URL,
             FORECAST_URLS[0], "weather_forecast", "Portugal", 1800, ipma_forecasts, IPMA_URL,
             additional_urls=(*FORECAST_URLS[1:], IPMA_DATA + "distrits-islands.json")),
)

DEFAULT_PROVIDERS = ",".join(provider.id for provider in PROVIDERS)

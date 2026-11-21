"""Provider contracts and deterministic transformations. No arbitrary feed URLs."""
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from collections.abc import Callable, Iterable
from urllib.parse import urlsplit

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


PROVIDERS = (
    Provider("usgs", "USGS", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
             "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
             "earthquake", "Worldwide", 120, usgs, "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits"),
    Provider("ipma-warnings", "IPMA", "https://api.ipma.pt/",
             "https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json",
             "weather_warning", "Portugal", 600, ipma, "https://api.ipma.pt/"),
)

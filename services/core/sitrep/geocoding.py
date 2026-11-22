"""Configured reverse geocoding and offline WGS84 timezone resolution."""
import json
import os
import re
from functools import lru_cache
from time import monotonic
from typing import Protocol
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, Field
from timezonefinder import timezone_at


class Coordinates(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class Geography(BaseModel):
    country_name: str | None = Field(default=None, max_length=120)
    region: str | None = Field(default=None, max_length=120)
    district_name: str | None = Field(default=None, max_length=120)
    municipality: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)
    neighbourhood: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=32)
    formatted: str | None = Field(default=None, max_length=500)
    resolved_fields: list[str] = Field(default_factory=list, max_length=12)


class Geocoder(Protocol):
    def reverse(self, latitude: float, longitude: float) -> tuple[dict, str | None]: ...


class Nominatim:
    def __init__(self, endpoint, token):
        url = urlsplit(endpoint)
        if (url.scheme not in {"https", "http"} or not url.hostname or url.username or url.query
                or url.fragment or url.hostname == "nominatim.openstreetmap.org"
                or (token and url.scheme != "https")):
            raise ValueError("Configure an authorized Nominatim endpoint")
        self.endpoint = endpoint
        self.headers = {"User-Agent": "SITREP reverse geocoder"}
        if token:
            self.headers["Authorization"] = "Bearer " + token

    def request(self, params):
        with httpx.Client(timeout=5, follow_redirects=False, trust_env=False) as client:
            with client.stream("GET", self.endpoint, headers=self.headers, params=params) as response:
                response.raise_for_status()
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > 256 * 1024:
                        raise ValueError("Geocoder response too large")
        return json.loads(body)

    def reverse(self, latitude, longitude):
        return normalize_nominatim(self.request({
            "lat": latitude, "lon": longitude, "format": "jsonv2", "addressdetails": 1,
        }))

    def search(self, query):
        payload = self.request({"q": query, "format": "jsonv2", "limit": 5})
        if not isinstance(payload, list):
            raise ValueError("Provider did not return a result list")
        results = []
        for row in payload[:5]:
            if isinstance(row, dict) and isinstance(row.get("display_name"), str):
                try:
                    point = Coordinates(latitude=row.get("lat"), longitude=row.get("lon"))
                except ValueError:
                    continue
                results.append({"label": row["display_name"][:500], **point.model_dump()})
        return results


def search_places(query):
    endpoint = os.getenv("GEOCODER_SEARCH_URL")
    if not endpoint:
        return {"status": "not_configured", "results": []}
    try:
        provider = Nominatim(endpoint, os.getenv("GEOCODER_TOKEN", ""))
        return {"status": "resolved", "results": provider.search(query)}
    except (ValueError, httpx.HTTPError):
        return {"status": "unavailable", "results": []}


def normalize_nominatim(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("address"), dict):
        raise ValueError("Provider did not return a structured address")
    address = payload["address"]

    def value(key, length=120):
        candidate = address.get(key)
        return candidate.strip()[:length] if isinstance(candidate, str) and candidate.strip() else None

    fields = {
        "country_name": value("country"),
        "region": value("state") or value("region"),
        "district_name": value("state_district"),
        "municipality": value("municipality") or value("county"),
        "city": value("city") or value("town") or value("village"),
        "neighbourhood": value("suburb") or value("neighbourhood") or value("city_district"),
        "postal_code": value("postcode", 32),
        "formatted": payload["display_name"][:500] if isinstance(payload.get("display_name"), str) else None,
    }
    country = value("country_code", 3)
    return fields, country.upper() if country and re.fullmatch("[A-Za-z]{2}", country) else None


@lru_cache(maxsize=256)
def cached_address(latitude, longitude, _window):
    provider: Geocoder = Nominatim(os.environ["GEOCODER_URL"], os.getenv("GEOCODER_TOKEN", ""))
    return provider.reverse(latitude, longitude)


def resolve(point):
    zone = timezone_at(lat=point.latitude, lng=point.longitude)
    fields, country, state = {}, None, "not_configured"
    if os.getenv("GEOCODER_URL"):
        try:
            fields, country = cached_address(point.latitude, point.longitude, int(monotonic() // 900))
            state = "resolved"
        except (ValueError, httpx.HTTPError):
            state = "unavailable"
    resolved = [key for key, value in fields.items() if value]
    if country:
        resolved.append("country")
    if zone:
        resolved.append("timezone")
    return {
        "timezone": zone, "country": country, "status": state,
        "geography": Geography(**fields, resolved_fields=resolved),
    }

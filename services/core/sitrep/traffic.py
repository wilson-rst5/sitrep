"""Optional paid-provider adapters. Access tokens stay on the server."""
import math
import os
from datetime import timedelta

from pydantic import ValidationError

from .providers import Event, Provider, utc_timestamp

TOMTOM = "https://api.tomtom.com/maps/orbis/traffic"
AGORA = "https://transitoagora.pt"

INCIDENT_TYPES = {
    "accident": "road_accident", "closure": "road_closure", "roadClosed": "road_closure",
    "roadworks": "roadworks", "roadWorks": "roadworks", "fire": "wildfire",
    "weather": "road_weather", "fog": "road_weather", "rain": "road_weather",
    "ice": "road_weather", "wind": "road_weather", "flooding": "flood",
}


def agora_events(document, now):
    if not isinstance(document, dict) or document.get("type") != "FeatureCollection":
        raise ValueError("Expected a Trânsito Agora FeatureCollection")
    for feature in document["features"]:
        try:
            data = feature["properties"]
            if data.get("status") != "active":
                continue
            geometry = feature.get("geometry") or {}
            if geometry.get("type") != "Point":
                continue
            lon, lat = geometry["coordinates"][:2]
            start = utc_timestamp(data["startedAt"])
            updated = utc_timestamp(data["updatedAt"])
            expiry = now + timedelta(minutes=15)
            if start >= expiry:
                continue
            yield Event(
                provider="transito-agora", external_id=str(data["id"]),
                category=INCIDENT_TYPES.get(data["type"], "traffic"),
                title=data["title"][:300], description=(data.get("description") or "")[:2500],
                latitude=lat, longitude=lon, occurred_at=start, updated_at=max(now, updated),
                expires_at=expiry, severity={"low": 1, "medium": 2, "high": 3}.get(data.get("severity"), 1),
                source_url=data.get("sourceUrl") or AGORA, original_source=data.get("source"),
                road=data.get("road"), event_status="active", reported_at=updated,
            )
        except (KeyError, TypeError, ValueError, ValidationError):
            continue


def tomtom_events(document, now):
    if not isinstance(document, dict) or not isinstance(document.get("incidents"), list):
        raise ValueError("Expected a TomTom incident list")
    for feature in document["incidents"]:
        try:
            data = feature["properties"]
            geometry = feature["geometry"]
            if geometry["type"] not in {"Point", "LineString"}:
                continue
            line = geometry["coordinates"] if geometry["type"] == "LineString" else None
            lon, lat = (line[len(line) // 2] if line else geometry["coordinates"])[:2]
            category = INCIDENT_TYPES.get(data["iconCategory"], "traffic")
            descriptions = [item.get("description") for item in data.get("events", []) if item.get("description")]
            description = " · ".join(descriptions)
            start = utc_timestamp(data["startTime"]) if data.get("startTime") else now
            expiry = min(now + timedelta(minutes=8), utc_timestamp(data["endTime"])) if data.get("endTime") else now + timedelta(minutes=8)
            if expiry <= max(now, start):
                continue
            yield Event(
                provider="tomtom-incidents", external_id=str(data["id"]), category=category,
                title=(descriptions[0] if descriptions else category.replace("_", " ").capitalize())[:300],
                description=description[:2500], latitude=lat, longitude=lon, line=line[:1000] if line else None,
                occurred_at=start, updated_at=now, expires_at=expiry,
                severity=3 if category == "road_closure" else {"minor": 1, "moderate": 2, "major": 3}.get(data.get("magnitudeOfDelay"), 1),
                event_status=data.get("timeValidity"), road=", ".join(data.get("roadNumbers") or [])[:120] or None,
                delay_seconds=data.get("delayInSeconds"), direction_from=data.get("from"), direction_to=data.get("to"),
                reported_at=utc_timestamp(data["lastReportTime"]) if data.get("lastReportTime") else None,
                source_url="https://www.tomtom.com/traffic-index/",
            )
        except (KeyError, TypeError, ValueError, ValidationError):
            continue


def traffic_bbox():
    try:
        west, south, east, north = map(float, os.getenv("TOMTOM_TRAFFIC_BBOX", "").split(","))
        if (-180 <= west < east <= 180 and -90 <= south < north <= 90 and
                east - west <= .75 and north - south <= .75 and all(map(math.isfinite, (west, south, east, north)))):
            return f"{west},{south},{east},{north}"
    except ValueError:
        pass
    return None


def traffic_providers():
    bbox = traffic_bbox()
    return (
        Provider("transito-agora", "Trânsito Agora", AGORA + "/api-publica", AGORA + "/api/v1/incidents?format=geojson",
                 "traffic", "Portugal", 300, agora_events, AGORA + "/api-publica",
                 "TRANSITO_AGORA_API_KEY", request_headers=agora_headers),
        Provider("tomtom-incidents", "TomTom Orbis", "https://docs.tomtom.com/traffic-api/",
                 TOMTOM + f"/incidents/details?apiVersion=2&timeValidity=present&bbox={bbox}",
                 "traffic", "Configured bounding box", 120, tomtom_events, "https://www.tomtom.com/legal/",
                 "TOMTOM_API_KEY", request_headers=tomtom_headers, configured=bool(bbox) and os.getenv("TOMTOM_INCIDENTS_ENABLED", "").lower() == "true"),
    )


def agora_headers():
    return {"Authorization": "Bearer " + os.environ["TRANSITO_AGORA_API_KEY"]}


def tomtom_headers():
    return {"TomTom-Api-Key": os.environ["TOMTOM_API_KEY"],
            "Attributes": "incidents(type,geometry(type,coordinates),properties(id,iconCategory,magnitudeOfDelay,events(description),startTime,endTime,from,to,delayInSeconds,roadNumbers,timeValidity,lastReportTime))"}

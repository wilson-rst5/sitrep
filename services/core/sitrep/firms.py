"""NASA VIIRS thermal anomalies, kept separate from confirmed wildfire reports."""
import csv
import hashlib
import os
import re
from datetime import UTC, datetime, timedelta
from io import StringIO

from .providers import Event, Provider

FIRMS_DOCS = "https://firms.modaps.eosdis.nasa.gov/api/area/"


def detections(document, now):
    for row in document:
        try:
            latitude, longitude = float(row["latitude"]), float(row["longitude"])
            hour = row["acq_time"].zfill(4)
            observed = datetime.fromisoformat(row["acq_date"] + "T" + hour[:2] + ":" + hour[2:]).replace(tzinfo=UTC)
            if observed > now or observed + timedelta(days=1) <= now:
                continue
            identifier = hashlib.sha256(f"{observed.isoformat()}:{latitude}:{longitude}".encode()).hexdigest()
            confidence = {"l": "Low", "n": "Nominal", "h": "High"}.get(row.get("confidence"), "Not reported")
            yield Event(provider="nasa-firms", external_id=identifier, category="fire_detection",
                        title="VIIRS thermal anomaly", description=f"Detection confidence: {confidence}.",
                        latitude=latitude, longitude=longitude, occurred_at=observed, updated_at=observed,
                        expires_at=observed + timedelta(days=1), severity=1, source_url=FIRMS_DOCS)
        except (KeyError, ValueError, TypeError):
            continue


def decode_csv(body):
    reader = csv.DictReader(StringIO(body.decode("utf-8-sig")))
    if not reader.fieldnames or not {"latitude", "longitude", "acq_date", "acq_time"}.issubset(reader.fieldnames):
        raise ValueError("Unexpected FIRMS response")
    return reader


def firms_provider():
    key = os.getenv("FIRMS_MAP_KEY", "")
    area = os.getenv("FIRMS_BBOX", "")
    configured = False
    try:
        west, south, east, north = map(float, area.split(","))
        configured = bool(re.fullmatch(r"[a-fA-F0-9]{32}", key)) and (
            -180 <= west < east <= 180 and -90 <= south < north <= 90 and east - west <= 10 and north - south <= 10)
        area = f"{west},{south},{east},{north}" if configured else ""
    except ValueError:
        pass
    url = FIRMS_DOCS + f"csv/{key}/VIIRS_NOAA20_NRT/{area}/1" if configured else FIRMS_DOCS
    return Provider("nasa-firms", "NASA FIRMS VIIRS", FIRMS_DOCS, url, "fire_detection", "Configured bounding box",
                    600, detections, FIRMS_DOCS, "FIRMS_MAP_KEY", decode=decode_csv,
                    request_headers=dict, configured=configured)

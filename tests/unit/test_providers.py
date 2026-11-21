from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from sitrep.providers import Event, ipma, usgs

NOW = datetime(2026, 1, 1, tzinfo=UTC)


def test_usgs_has_coordinates_and_source():
    document = {"type": "FeatureCollection", "features": [{
        "id": "fixture-seismic",
        "geometry": {"type": "Point", "coordinates": [-123.2, 47.2, 10]},
        "properties": {"type": "earthquake", "mag": 5.2, "place": "Test location", "title": "Test",
                       "time": 1767225600000, "updated": 1767225600000,
                       "url": "https://earthquake.usgs.gov/earthquakes/eventpage/fixture-seismic"},
    }]}
    event, = usgs(document, NOW)
    assert event.latitude == 47.2
    assert event.longitude == -123.2
    assert event.depth_km == 10
    assert event.severity == 2
    assert event.occurred_at == NOW
    assert str(event.source_url).startswith("https://earthquake.usgs.gov/")


def test_ipma_district_no_fabricated_coordinates():
    document = [{"awarenessLevelID": "red", "idAreaAviso": "AVR", "startTime": "2026-01-01T00:00:00",
                 "endTime": "2026-01-02T00:00:00", "awarenessTypeName": "Test storm", "text": "Test"}]
    event, = ipma(document, NOW)
    assert event.official and event.severity == 4
    assert event.latitude is None and event.longitude is None
    assert event.district == "AVR"
    assert next(ipma(document, NOW)).external_id == event.external_id
    with pytest.raises(ValidationError):
        Event.model_validate({**event.model_dump(), "official": False})


def test_invalid_provider_payload_rejected():
    with pytest.raises(ValueError):
        list(usgs({"type": "Fake", "features": []}, NOW))
    with pytest.raises(ValueError):
        list(ipma({"warnings": []}, NOW))

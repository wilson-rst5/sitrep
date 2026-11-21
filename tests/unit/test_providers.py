from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from sitrep.providers import Event, ipma, ipma_forecasts, ipma_observations, usgs

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


def test_ipma_observations_use_latest_station_reading_and_skip_missing_values():
    def observation(hour, temperature):
        return {
            "geometry": {"type": "Point", "coordinates": [-8.65, 40.64]},
            "properties": {
                "idEstacao": 101, "localEstacao": "Test station", "time": f"2026-01-01T{hour}:00:00",
                "temperatura": temperature, "humidade": -99, "precAcumulada": 0,
            },
        }

    event, = ipma_observations(
        {"type": "FeatureCollection", "features": [observation("02", 9), observation("01", 8)]},
        NOW.replace(hour=3),
    )
    assert event.external_id == "101"
    assert event.occurred_at == NOW.replace(hour=2)
    assert event.expires_at == NOW.replace(hour=6)
    assert event.description == "Temperature 9 °C · Hourly precipitation 0 mm"
    assert event.latitude == 40.64
    assert event.severity == 0


def test_ipma_daily_forecast_retains_calendar_day_and_azores_time_zone():
    row = {"globalIdLocal": 101, "latitude": "38.7", "longitude": "-27.2",
           "tMin": "10", "tMax": "15", "precipitaProb": "30"}
    days = [
        {"forecastDate": f"2026-01-0{number}", "dataUpdate": "2026-01-01T00:00:00", "data": [row]}
        for number in (1, 2, 3)
    ]
    locations = {"data": [{"globalIdLocal": 101, "local": "Test town", "idRegiao": 3}]}
    first, second, third = ipma_forecasts([*days, locations], NOW)
    assert first.external_id == "101-2026-01-01"
    assert first.title == "Daily forecast · Test town"
    assert first.occurred_at == NOW.replace(hour=1)
    assert first.forecast_date.isoformat() == "2026-01-01"
    assert first.description == "Low 10 °C · High 15 °C · Rain probability 30 %"
    assert second.occurred_at.day == 2 and third.occurred_at.day == 3

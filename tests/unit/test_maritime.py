from datetime import datetime, UTC

import pytest

from sitrep.maritime import boxes, in_coverage, normalize

NOW = datetime(2026, 10, 30, tzinfo=UTC).timestamp()
MMSI = 123456789


def ais(kind, body, meta=None):
    return {"MessageType": kind, "Message": {kind: {"UserID": MMSI, "Valid": True, **body}}, "MetaData": meta or {}}


@pytest.mark.parametrize("kind", ["PositionReport", "StandardClassBPositionReport",
                                  "ExtendedClassBPositionReport", "LongRangeAisBroadcastMessage"])
def test_positions_keep_knots_and_separate_course_from_heading(kind):
    position = normalize(ais(kind, {"Latitude": 38.7, "Longitude": -9.15,
                                   "Sog": 12.4, "Cog": 91, "TrueHeading": 85}), NOW)
    assert position["mmsi"] == str(MMSI)
    assert (position["speed"], position["course"], position["heading"]) == (12.4, 91, 85)
    assert "name" not in position
    assert position["timestamp_source"] == "collector receipt"


def test_static_enrichment_and_default_values():
    part = normalize(ais("StaticDataReport", {"ReportA": {"Name": "NAME@@@"},
                                             "ReportB": {"CallSign": "CALL", "ShipType": 70}}), NOW)
    assert part["name"] == "NAME"
    assert part["callsign"] == "CALL"
    assert part["category"] == 70
    assert "observed" not in part
    position = normalize(ais("PositionReport", {"Latitude": 38, "Longitude": -9, "TrueHeading": 511,
                                               "Sog": 102.3, "Cog": 360, "NavigationalStatus": 15}), NOW)
    assert all(position[field] is None for field in ("speed", "course", "heading", "navigation"))


def test_reject_invalid_and_expired_positions():
    assert normalize(ais("PositionReport", {"Latitude": 91, "Longitude": -9}), NOW) is None
    item = ais("PositionReport", {"Latitude": 38, "Longitude": -9}, {"time_utc": "2026-10-29T20:00:00Z"})
    assert normalize(item, NOW) is None


def test_bounds_use_lat_lon_and_split_antimeridian():
    scope = {"latitude": 38.7, "longitude": -9.15, "radius": 100}
    ((south, west), (north, east)), = boxes(scope)
    assert south < 38.7 < north and west < -9.15 < east
    assert in_coverage({"latitude": 38.55, "longitude": -8.9}, scope, None)
    assert not in_coverage({"latitude": 41, "longitude": -9.15}, scope, None)
    assert len(boxes({**scope, "longitude": 179.9})) == 2

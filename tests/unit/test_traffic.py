from datetime import UTC, datetime

from sitrep.flow import fetch_tile, flow_status
from sitrep.traffic import agora_events, tomtom_events, traffic_bbox

NOW = datetime(2026, 11, 22, 12, tzinfo=UTC)


def test_agora_congestion_preserves_category_and_original_attribution():
    event, = agora_events({"type": "FeatureCollection", "features": [{
        "geometry": {"type": "Point", "coordinates": [-9.17, 38.69]},
        "properties": {"id": "fixture", "type": "traffic", "status": "active", "severity": "medium",
                       "title": "Congestion", "startedAt": "2026-11-22T11:00:00Z",
                       "updatedAt": "2026-11-22T11:55:00Z", "source": "fixture-source", "road": "A2"},
    }]}, NOW)
    assert event.category == "traffic"
    assert event.original_source == "fixture-source"
    assert (event.longitude, event.latitude) == (-9.17, 38.69)
    assert event.road == "A2"


def test_orbis_closure_preserves_line_and_source_direction_text():
    event, = tomtom_events({"incidents": [{
        "geometry": {"type": "LineString", "coordinates": [[-9.17, 38.69], [-9.16, 38.70]]},
        "properties": {"id": "fixture", "iconCategory": "roadClosed", "events": [{"description": "Closed"}],
                       "roadNumbers": ["A2"], "from": "First location", "to": "Second location", "timeValidity": "present"},
    }]}, NOW)
    assert event.category == "road_closure"
    assert event.line == [(-9.17, 38.69), (-9.16, 38.70)]
    assert event.direction_from == "First location"
    assert event.delay_seconds is None


def test_missing_flow_key_never_requests_tiles(monkeypatch):
    monkeypatch.delenv("TOMTOM_API_KEY", raising=False)
    assert flow_status()["state"] == "needs_key"
    assert fetch_tile(12, 1, 1) == (503, None)


def test_bbox_bounds_limits_provider_request(monkeypatch):
    monkeypatch.setenv("TOMTOM_TRAFFIC_BBOX", "-9.3,38.5,-8.9,38.9")
    assert traffic_bbox() == "-9.3,38.5,-8.9,38.9"
    monkeypatch.setenv("TOMTOM_TRAFFIC_BBOX", "-10,37,-8,40")
    assert traffic_bbox() is None


def test_viirs_anomaly_does_not_become_confirmed_wildfire():
    from sitrep.firms import decode_csv, detections

    csv = b"latitude,longitude,acq_date,acq_time,confidence\n38.69,-9.17,2026-11-22,1130,n\n"
    event, = detections(decode_csv(csv), NOW)
    assert event.category == "fire_detection"
    assert event.official is False
    assert event.occurred_at.minute == 30


def test_flow_proxy_uses_orbis_url_header_and_reuses_recent_tiles(monkeypatch):
    import httpx
    from sitrep import flow

    transport_requests = []
    original_client = httpx.Client

    def respond(request):
        transport_requests.append(request)
        return httpx.Response(200, content=b"\x89PNG\r\n\x1a\nfixture")

    monkeypatch.setenv("TOMTOM_API_KEY", "synthetic-fixture")
    monkeypatch.setenv("TOMTOM_FLOW_ENABLED", "true")
    monkeypatch.setattr(flow.httpx, "Client",
                        lambda **kwargs: original_client(transport=httpx.MockTransport(respond), **kwargs))
    assert fetch_tile(12, 10, 11)[0] == 200
    assert fetch_tile(12, 10, 11)[0] == 200
    request, = transport_requests
    assert request.url.path == "/maps/orbis/traffic/flow/raster/tile/12/10/11"
    assert request.url.params["apiVersion"] == "2"
    assert request.headers["TomTom-Api-Key"] == "synthetic-fixture"
    assert "key" not in request.url.params

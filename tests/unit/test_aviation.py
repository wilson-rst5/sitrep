import asyncio
from datetime import datetime, timezone

import httpx
import pytest

from sitrep.aviation import OpenSky, parse_adsb, parse_opensky, retry_delay, within


def test_adsb_uses_position_timestamp_and_reported_units():
    payload = {"now": 1_700_000_000_000, "ac": [
        {"hex": "a123b4", "lat": 38.68, "lon": -9.16, "seen_pos": 9, "seen": 2,
         "track": 280, "gs": 210, "alt_baro": "ground"},
        {"hex": "a123b5", "lat": 91, "lon": -9.16, "seen_pos": 9},
        {"hex": "a123b6", "lat": 38, "lon": -9, "seen_pos": 1000},
    ]}
    item, invalid, stale = parse_adsb(payload, 1_700_000_004)
    assert invalid is stale is None
    assert item["observed"] == 1_699_999_991
    assert item["contact"] == 1_699_999_998
    assert item["callsign"] is None
    assert item["ground"] and item["altitude"] is None and item["speed"] == 210
    assert item["heading"] == 280
    assert within(item, {"latitude": 38.7, "longitude": -9.2, "radius": 25})
    assert not within(item, {"latitude": 40, "longitude": -9.2, "radius": 25})


def test_opensky_converts_si_units_and_preserves_degrees():
    stamp = 1_700_000_000
    row = ["a123b4", " TEST ", "Country", stamp, stamp, -9.16, 38.68,
           3048, False, 51.4444, 270, 3.048, None, None, "1234", False, 0, 8]
    item, = parse_opensky({"states": [row]}, stamp)
    assert item["altitude"] == 10000
    assert item["speed"] == pytest.approx(100)
    assert item["vertical_rate"] == pytest.approx(600)
    assert item["heading"] == 270 and item["category"] == "8"
    assert item["callsign"] == "TEST" and not item["ground"]


def test_opensky_refreshes_after_unauthorized(monkeypatch):
    monkeypatch.setenv("OPENSKY_CLIENT_ID", "unit-test")
    monkeypatch.setenv("OPENSKY_CLIENT_SECRET", "unit-test")
    token_count = 0

    def respond(request):
        nonlocal token_count
        if request.method == "POST":
            token_count += 1
            assert b"grant_type=client_credentials" in request.content
            return httpx.Response(200, json={"access_token": str(token_count), "expires_in": 1800})
        assert float(request.url.params["lamin"]) < 38.68
        return httpx.Response(401 if request.headers["Authorization"] == "Bearer 1" else 200)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            provider = OpenSky()
            scope = {"latitude": 38.68, "longitude": -9.16, "radius": 200}
            assert (await provider.fetch(client, scope)).status_code == 200
            assert (await provider.fetch(client, scope)).status_code == 200

    asyncio.run(run())
    assert token_count == 2


def test_retry_headers():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert retry_delay({"Retry-After": "120"}, now) == 120
    assert retry_delay({"X-Rate-Limit-Retry-After-Seconds": "90"}, now) == 90
    assert retry_delay({"Retry-After": "Thu, 01 Jan 2026 00:01:00 GMT"}, now) == 60

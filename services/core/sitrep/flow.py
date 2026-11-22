"""Bounded same-origin proxy for authenticated Orbis flow tiles."""
import os
from collections import OrderedDict, deque
from functools import lru_cache
from threading import Lock
from time import monotonic

import httpx

from .traffic import TOMTOM

_lock = Lock()
_cache = OrderedDict()
_requests = deque()
_state = {"state": "unverified", "last_success": None}


def flow_status():
    if not os.getenv("TOMTOM_API_KEY"):
        return {"state": "needs_key", "last_success": None}
    if os.getenv("TOMTOM_FLOW_ENABLED", "").lower() != "true":
        return {"state": "disabled", "last_success": None}
    with _lock:
        return dict(_state)


def fetch_tile(zoom, x, y):
    from datetime import UTC, datetime

    key = os.getenv("TOMTOM_API_KEY", "")
    if not key or os.getenv("TOMTOM_FLOW_ENABLED", "").lower() != "true":
        return 503, None
    now = monotonic()
    coordinates = (zoom, x, y)
    with _lock:
        cached = _cache.get(coordinates)
        if cached and now - cached[0] < 25:
            return 200, cached[1]
        while _requests and _requests[0] <= now - 60:
            _requests.popleft()
        if len(_requests) >= 180:
            return 429, None
        _requests.append(now)
    try:
        with httpx.Client(timeout=5, follow_redirects=False, trust_env=False) as client:
            with client.stream("GET", TOMTOM + f"/flow/raster/tile/{zoom}/{x}/{y}",
                               params={"apiVersion": 2, "style": "dark", "tileSize": 256},
                               headers={"TomTom-Api-Key": key}) as response:
                if response.status_code == 429:
                    return 429, None
                response.raise_for_status()
                data = bytearray()
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    if len(data) > 512 * 1024:
                        raise ValueError("Tile exceeds size limit")
        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Provider did not return PNG")
    except (httpx.HTTPError, ValueError):
        with _lock:
            _state["state"] = "unavailable"
        return 502, None
    with _lock:
        _state.update(state="online", last_success=datetime.now(UTC).isoformat())
        _cache[coordinates] = (now, bytes(data))
        _cache.move_to_end(coordinates)
        if len(_cache) > 256:
            _cache.popitem(last=False)
    return 200, bytes(data)


def segment_snapshot(latitude, longitude):
    if not os.getenv("TOMTOM_API_KEY") or os.getenv("TOMTOM_SEGMENT_ENABLED", "").lower() != "true":
        return None
    return cached_segment(latitude, longitude, int(monotonic() // 30))


@lru_cache(maxsize=256)
def cached_segment(latitude, longitude, _window):
    from datetime import UTC, datetime

    now = monotonic()
    with _lock:
        while _requests and _requests[0] <= now - 60:
            _requests.popleft()
        if len(_requests) >= 180:
            return None
        _requests.append(now)
    try:
        with httpx.Client(timeout=5, follow_redirects=False, trust_env=False) as client:
            response = client.get("https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/15/json",
                                  params={"point": f"{latitude},{longitude}", "unit": "KMPH",
                                          "key": os.environ["TOMTOM_API_KEY"]})
            response.raise_for_status()
            data = response.json()["flowSegmentData"]
        keys = ("currentSpeed", "freeFlowSpeed", "currentTravelTime", "freeFlowTravelTime", "confidence")
        result = {key: data.get(key) if type(data.get(key)) in (int, float) and data[key] >= 0 else None for key in keys}
        result["roadClosure"] = data.get("roadClosure") if isinstance(data.get("roadClosure"), bool) else None
        result["checked_at"] = datetime.now(UTC).isoformat()
        return result
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None

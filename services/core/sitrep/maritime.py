"""AISStream receiver and geographically bounded vessel snapshots."""
import asyncio
from datetime import datetime, UTC
import json
import math
import os
import random
import re
import time

from sqlalchemy import text
from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

from .aviation import current_scope, within

POSITIONS = ("PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport",
             "LongRangeAisBroadcastMessage")
STATIC = ("ShipStaticData", "StaticDataReport")
EXPIRY = 1800


def boxes(scope):
    angular = scope["radius"] / 6371.0088
    lat, lon, span = scope["latitude"], scope["longitude"], math.degrees(angular)
    south, north = max(-90, lat - span), min(90, lat + span)
    if south == -90 or north == 90:
        return [[[south, -180], [north, 180]]]
    width = math.degrees(math.asin(min(1, math.sin(angular) / math.cos(math.radians(lat)))))
    west, east = lon - width, lon + width
    if west < -180:
        return [[[south, west + 360], [north, 180]], [[south, -180], [north, east]]]
    if east > 180:
        return [[[south, west], [north, 180]], [[south, -180], [north, east - 360]]]
    return [[[south, west], [north, east]]]


def bounded(value, low, high):
    return value if type(value) in (int, float) and low <= value <= high else None


def clean(value):
    return value.strip(" @\0")[:80] or None if isinstance(value, str) else None


def normalize(frame, received):
    kind = frame.get("MessageType")
    body = frame.get("Message", {}).get(kind)
    meta = frame.get("MetaData", {})
    if not isinstance(body, dict) or not isinstance(meta, dict) or body.get("Valid") is False:
        return None
    mmsi = str(body.get("UserID", meta.get("MMSI", "")))
    if not re.fullmatch(r"[0-9]{9}", mmsi) or mmsi == "000000000":
        return None
    part = body.get("ReportB") or {}
    fields = dict(mmsi=mmsi, source="AISStream.io",
                  name=clean(body.get("Name")) or clean(meta.get("ShipName")),
                  destination=clean(body.get("Destination")),
                  callsign=clean(body.get("CallSign") or part.get("CallSign")),
                  imo=bounded(body.get("ImoNumber"), 1000000, 9999999),
                  category=bounded(body.get("Type", body.get("ShipType", part.get("ShipType"))), 1, 99))
    fields = {key: val for key, val in fields.items() if val is not None}
    if kind in STATIC:
        if name := clean((body.get("ReportA") or {}).get("Name")):
            fields["name"] = name
        return fields
    if kind not in POSITIONS:
        return None
    lat = bounded(body.get("Latitude", meta.get("Latitude")), -90, 90)
    lon = bounded(body.get("Longitude", meta.get("Longitude")), -180, 180)
    if lat is None or lon is None:
        return None
    observed = received
    timestamp_source = "collector receipt"
    stamp = meta.get("time_utc")
    if isinstance(stamp, str):
        try:
            parsed = datetime.fromisoformat(stamp.removesuffix(" UTC").replace("Z", "+00:00"))
            observed = parsed.replace(tzinfo=parsed.tzinfo or UTC).timestamp()
            timestamp_source = "provider timestamp"
        except ValueError:
            pass
    if not -5 <= received - observed < EXPIRY:
        return None
    return dict(fields, latitude=lat, longitude=lon, observed=observed, received=received, timestamp_source=timestamp_source,
                speed=bounded(body.get("Sog"), 0, 62 if kind == POSITIONS[-1] else 102.2),
                course=bounded(body.get("Cog"), 0, 359.9),
                heading=bounded(body.get("TrueHeading"), 0, 359),
                navigation=bounded(body.get("NavigationalStatus"), 0, 14))


def coverage(conn):
    cfg = dict(conn.execute(text("SELECT radius,bounds FROM maritime_settings WHERE id=1")).mappings().one())
    scope = current_scope(conn, cfg["radius"])
    return cfg, scope


def in_coverage(item, scope, bounds):
    if bounds:
        south, west, north, east = bounds
        return south <= item["latitude"] <= north and west <= item["longitude"] <= east
    return bool(scope and within(item, scope))


def save(conn, pending, state, diagnostics):
    with conn.begin():
        for item in pending.values():
            conn.execute(text("""
                INSERT INTO vessels(mmsi,observed,position,payload)
                VALUES (:mmsi,to_timestamp(:observed),
                  CASE WHEN CAST(:observed AS double precision) IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(CAST(:lon AS double precision),CAST(:lat AS double precision)),4326)::geography END,
                  CAST(:payload AS jsonb))
                ON CONFLICT (mmsi) DO UPDATE SET updated=now(),
                    observed=COALESCE(EXCLUDED.observed,vessels.observed),
                    position=COALESCE(EXCLUDED.position,vessels.position),
                    payload=vessels.payload || EXCLUDED.payload
                WHERE EXCLUDED.observed IS NULL OR vessels.observed IS NULL OR EXCLUDED.observed >= vessels.observed
            """), dict(mmsi=item["mmsi"], observed=item.get("observed"), lon=item.get("longitude"),
                       lat=item.get("latitude"), payload=json.dumps(item)))
        conn.execute(text("DELETE FROM vessels WHERE updated < now() - interval '30 minutes'"))
        conn.execute(text("""
            INSERT INTO maritime_health VALUES(1,:state,now(),CAST(:diagnostics AS jsonb))
            ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state, reported=now(), diagnostics=EXCLUDED.diagnostics
        """), dict(state=state, diagnostics=json.dumps(diagnostics)))
        if pending:
            conn.execute(text("UPDATE event_revisions SET version=version+1 WHERE id=1"))
    pending.clear()


class AISStream:
    def __init__(self, key):
        self.key = key

    async def subscribe(self, socket, bounds):
        await socket.send(json.dumps({"APIKey": self.key, "BoundingBoxes": bounds,
                                      "FilterMessageTypes": [*POSITIONS, *STATIC]}))

    def connect(self):
        return connect("wss://stream.aisstream.io/v0/stream", compression="deflate", open_timeout=12,
                       ping_interval=20, ping_timeout=20, max_size=65536, max_queue=32)


async def receive(conn, provider, cfg, scope, pending, diagnostics):
    bounds = cfg["bounds"]
    subscription = [[[bounds[0], bounds[1]], [bounds[2], bounds[3]]]] if bounds else boxes(scope)
    async with provider.connect() as socket:
        await provider.subscribe(socket, subscription)
        diagnostics["connected"] = True
        save(conn, pending, "awaiting subscription", diagnostics)
        started = flushed = time.monotonic()
        while True:
            try:
                raw = await asyncio.wait_for(socket.recv(), timeout=5)
            except TimeoutError:
                raw = None
            if raw is not None:
                try:
                    frame = json.loads(raw)
                    if not isinstance(frame, dict):
                        continue
                    if frame.get("error") or frame.get("Error") or frame.get("MessageType") == "Error":
                        save(conn, pending, "subscription rejected", diagnostics)
                        return False
                    if frame.get("MessageType") == "SubscriptionConfirmation":
                        diagnostics["confirmed"] = True
                    elif frame.get("MessageType") in (*POSITIONS, *STATIC):
                        diagnostics["messages"] += 1
                        if frame["MessageType"] in POSITIONS:
                            diagnostics["position_messages"] += 1
                        item = normalize(frame, time.time())
                        if item and ("observed" not in item or in_coverage(item, scope, bounds)):
                            previous = pending.get(item["mmsi"], {})
                            if item.get("observed", math.inf) >= previous.get("observed", 0):
                                pending[item["mmsi"]] = previous | item
                            if "observed" in item:
                                diagnostics["valid_positions"] += 1
                                diagnostics["last_position"] = item["observed"]
                except (ValueError, TypeError, AttributeError):
                    diagnostics["invalid"] += 1
            now = time.monotonic()
            if now - started > 30 and not diagnostics["confirmed"] and not diagnostics["messages"]:
                save(conn, pending, "subscription unconfirmed", diagnostics)
                return False
            if now - flushed >= 5 or len(pending) >= 250:
                state = ("receiving positions" if diagnostics["valid_positions"] else "receiving AIS messages"
                         if diagnostics["messages"] else "confirmed · waiting for AIS messages"
                         if diagnostics["confirmed"] else "awaiting subscription")
                save(conn, pending, state, diagnostics)
                flushed = now
                with conn.begin():
                    if coverage(conn) != (cfg, scope):
                        return True


async def collect_maritime():
    from .db import engine

    key = os.getenv("AISSTREAM_API_KEY")
    delay = 5
    while True:
        try:
            with engine.connect() as conn:
                locked = conn.execute(text("SELECT pg_try_advisory_lock(3198106)")).scalar()
                conn.commit()
                if locked:
                    pending = {}
                    diagnostics = dict(connected=False, confirmed=False, messages=0, position_messages=0,
                                       valid_positions=0, invalid=0, last_position=None)
                    try:
                        with conn.begin():
                            cfg, scope = coverage(conn)
                        if not key or not (scope or cfg["bounds"]):
                            save(conn, pending, "not configured" if not key else "no monitoring area", diagnostics)
                        elif await receive(conn, AISStream(key), cfg, scope, pending, diagnostics):
                            delay = 1
                        else:
                            delay = min(300, delay * 2)
                    except (OSError, TimeoutError, WebSocketException) as exc:
                        print(json.dumps({"action": "ais_disconnected", "error": type(exc).__name__}), flush=True)
                        diagnostics["connected"] = False
                        save(conn, pending, "provider unavailable", diagnostics)
                        delay = 5 if diagnostics["valid_positions"] else min(300, delay * 2)
                    finally:
                        conn.rollback()
                        conn.execute(text("SELECT pg_advisory_unlock(3198106)"))
                        conn.commit()
        except Exception as exc:
            print(json.dumps({"action": "ais_collector_error", "error": type(exc).__name__}), flush=True)
        await asyncio.sleep((delay if key else 30) + random.random())


def snapshot(conn, location_id=None):
    cfg, scope = coverage(conn)
    health = conn.execute(text("SELECT state,reported,diagnostics FROM maritime_health WHERE id=1")).mappings().first()
    status = health.state if health else "collector starting"
    if health and time.time() - health.reported.timestamp() > 90 and status not in ("not configured", "no monitoring area"):
        status = "provider unavailable"
    rows = []
    if (scope or cfg["bounds"]) and (location_id is None or scope and scope["id"] == location_id):
        bounds = cfg["bounds"]
        if bounds:
            south, west, north, east = bounds
            clause = "ST_Intersects(position::geometry, ST_MakeEnvelope(:west,:south,:east,:north,4326))"
            params = dict(south=south, west=west, north=north, east=east)
        else:
            clause = "ST_DWithin(position, ST_SetSRID(ST_MakePoint(:longitude,:latitude),4326)::geography,:metres)"
            params = dict(scope, metres=scope["radius"] * 1000)
        rows = conn.execute(text(f"""
            SELECT payload FROM vessels WHERE observed > now()-interval '30 minutes' AND {clause}
            ORDER BY observed DESC LIMIT 3000
        """), params).scalars()
    now = time.time()
    vessels = [dict(item, age=max(0, round(now - item["observed"])),
                    freshness="fresh" if now - item["observed"] <= 300 else "last known") for item in rows]
    return dict(settings=cfg, scope=scope, state=status, provider="AISStream.io",
                diagnostics=health.diagnostics if health else {}, vessels=vessels)

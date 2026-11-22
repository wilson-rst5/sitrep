"""Bounded, deployment-wide aircraft polling. Coordinates are WGS84."""

import asyncio
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import json
import math
import os
import re
import time

import httpx
from sqlalchemy import text


PROVIDERS = ("adsb.lol", "opensky")
AGENT = "SITREP aviation (+https://github.com/wilson-rst5/sitrep)"
EXPIRY = 900
TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"


def number(value):
    return value if type(value) in (float, int) and math.isfinite(value) else None


def label(value):
    return value.strip()[:64] or None if isinstance(value, str) else None


def distance(lat, lon, latitude, longitude):
    a = math.sin(math.radians(lat - latitude) / 2) ** 2
    a += math.cos(math.radians(lat)) * math.cos(math.radians(latitude)) * math.sin(math.radians(lon - longitude) / 2) ** 2
    return 12742.0176 * math.asin(math.sqrt(min(1, a)))


def position(identifier, latitude, longitude, observed, received, provider, **fields):
    identifier = label(identifier)
    latitude, longitude, observed = map(number, (latitude, longitude, observed))
    if (not identifier or not re.fullmatch(r"[0-9a-fA-F]{6}", identifier)
            or latitude is None or longitude is None or abs(latitude) > 90 or abs(longitude) > 180
            or observed is None or not -5 <= received - observed <= EXPIRY):
        return None
    heading = fields.get("heading")
    fields["heading"] = heading % 360 if heading is not None and 0 <= heading <= 360 else None
    return dict(id=identifier.lower(), latitude=latitude, longitude=longitude, observed=observed,
                received=received, provider=provider, **fields)


def parse_adsb(payload, received):
    rows = payload["ac"]
    stamp = number(payload["now"])
    if not isinstance(rows, list) or stamp is None:
        raise ValueError("Invalid ADSB.lol payload")
    stamp /= 1000
    for row in rows:
        if not isinstance(row, dict) or (age := number(row.get("seen_pos"))) is None or age < 0:
            continue
        contact_age = number(row.get("seen"))
        altitude = row.get("alt_baro")
        yield position(row.get("hex"), row.get("lat"), row.get("lon"), stamp - age, received, "adsb.lol",
                       callsign=label(row.get("flight")), altitude=number(altitude), speed=number(row.get("gs")),
                       heading=number(row.get("track")), vertical_rate=number(row.get("baro_rate")),
                       ground=True if altitude == "ground" else False if number(altitude) is not None else None,
                       category=label(row.get("category")), squawk=label(row.get("squawk")),
                       contact=stamp - contact_age if contact_age is not None and contact_age >= 0 else None,
                       source=label(row.get("type")), accuracy=number(row.get("rc")))


def parse_opensky(payload, received):
    rows = payload["states"]
    if rows is None:
        return
    if not isinstance(rows, list):
        raise ValueError("Invalid OpenSky payload")
    for row in rows:
        if not isinstance(row, list) or len(row) < 17:
            continue
        altitude, speed, vertical = map(number, (row[7], row[9], row[11]))
        yield position(row[0], row[6], row[5], row[3], received, "opensky",
                       callsign=label(row[1]), altitude=altitude / .3048 if altitude is not None else None,
                       speed=speed / .514444 if speed is not None else None, heading=number(row[10]),
                       vertical_rate=vertical * 60 / .3048 if vertical is not None else None,
                       ground=row[8] if isinstance(row[8], bool) else None,
                       category=str(row[17]) if len(row) > 17 and type(row[17]) is int else None,
                       squawk=label(row[14]), contact=number(row[4]),
                       source={0: "ADS-B", 1: "ASTERIX", 2: "MLAT", 3: "FLARM"}.get(number(row[16])),
                       accuracy=None)


def within(aircraft, scope):
    return distance(aircraft["latitude"], aircraft["longitude"], scope["latitude"], scope["longitude"]) <= scope["radius"]


def interval(provider):
    try:
        return min(600, max(200 if provider == "adsb.lol" else 120, int(os.getenv("AVIATION_POLL_SECONDS", "200"))))
    except ValueError:
        return 200


class OpenSky:
    token = ""
    expires = 0.0

    async def headers(self, client):
        if time.monotonic() >= self.expires:
            response = await client.post(TOKEN_URL, data={
                "grant_type": "client_credentials", "client_id": os.getenv("OPENSKY_CLIENT_ID"),
                "client_secret": os.getenv("OPENSKY_CLIENT_SECRET"),
            })
            response.raise_for_status()
            data = response.json()
            self.token = data["access_token"]
            if not isinstance(self.token, str) or not self.token:
                raise ValueError("Invalid access token")
            self.expires = time.monotonic() + max(0, min(1800, int(data.get("expires_in", 1800))) - 60)
        return {"Authorization": f"Bearer {self.token}", "User-Agent": AGENT}

    async def fetch(self, client, scope):
        lat, lon = scope["latitude"], scope["longitude"]
        angular = scope["radius"] / 6371.0088
        span = math.degrees(angular)
        ratio = math.sin(angular) / max(1e-9, math.cos(math.radians(lat)))
        width = math.degrees(math.asin(min(1, ratio))) if abs(lat) + span < 90 else 180
        lon_min, lon_max = lon - width, lon + width
        if lon_min < -180 or lon_max > 180:
            lon_min, lon_max = -180, 180
        params = dict(lamin=max(-90, lat - span), lamax=min(90, lat + span),
                      lomin=lon_min, lomax=lon_max, extended=1)
        url = "https://opensky-network.org/api/states/all"
        response = await client.get(url, params=params, headers=await self.headers(client))
        if response.status_code == 401:
            self.expires = 0
            response = await client.get(url, params=params, headers=await self.headers(client))
        return response


def configured(provider):
    if provider == "adsb.lol":
        return os.getenv("ADSBLOL_ENABLED", "true").lower() == "true"
    return bool(os.getenv("OPENSKY_CLIENT_ID") and os.getenv("OPENSKY_CLIENT_SECRET"))


def retry_delay(headers, now):
    value = headers.get("Retry-After") or headers.get("X-Rate-Limit-Retry-After-Seconds")
    if value:
        try:
            return max(0, int(value))
        except ValueError:
            try:
                return max(0, (parsedate_to_datetime(value) - now).total_seconds())
            except (ValueError, TypeError):
                pass
    return 3600


def current_scope(conn, radius):
    area = conn.execute(text("""
        SELECT id, latitude, longitude FROM locations ORDER BY is_primary DESC, id LIMIT 1
    """)).mappings().first()
    return dict(id=area.id, latitude=float(area.latitude), longitude=float(area.longitude), radius=radius) if area else None


def settings(conn):
    return dict(conn.execute(text("SELECT * FROM aviation_settings WHERE id=1")).mappings().one())


async def poll(conn, client, opensky, provider, scope):
    now = datetime.now(timezone.utc)
    with conn.begin():
        conn.execute(text("INSERT INTO aviation_snapshots (provider) VALUES (:p) ON CONFLICT DO NOTHING"), {"p": provider})
        row = conn.execute(text("SELECT * FROM aviation_snapshots WHERE provider=:p"), {"p": provider}).mappings().one()
        if row.retry_at and now < row.retry_at:
            return row.state in ("online", "no recent coverage") and row.scope == scope
        spent = row.spent if row.quota_day == now.date() else 0
        if provider == "adsb.lol" and spent >= 450:
            reset = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), timezone.utc)
            conn.execute(text("""
                UPDATE aviation_snapshots SET state='rate limited', retry_at=:retry WHERE provider=:p
            """), {"retry": reset, "p": provider})
            return False
        delay = interval(provider)
        conn.execute(text("""
            UPDATE aviation_snapshots SET attempted=:now, quota_day=:day, spent=:spent, retry_at=:retry
            WHERE provider=:p
        """), {"now": now, "day": now.date(), "spent": spent + 1, "retry": now + timedelta(seconds=delay), "p": provider})

    state, data, remaining = "online", None, None
    try:
        if provider == "adsb.lol":
            nm = math.ceil(scope["radius"] / 1.852)
            url = f'https://api.adsb.lol/v2/point/{scope["latitude"]}/{scope["longitude"]}/{nm}'
            headers = {"User-Agent": AGENT}
            if key := os.getenv("ADSBLOL_API_KEY"):
                headers["x-api-key"] = key
            response = await client.get(url, headers=headers)
        else:
            response = await opensky.fetch(client, scope)
        response.raise_for_status()
        raw_remaining = response.headers.get("X-Rate-Limit-Remaining", "")
        remaining = min(2147483647, int(raw_remaining)) if re.fullmatch(r"[0-9]{1,12}", raw_remaining) else None
        parser = parse_adsb if provider == "adsb.lol" else parse_opensky
        data = [item for item in parser(response.json(), time.time()) if item and within(item, scope)]
        if not data:
            state = "no recent coverage"
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        state = {401: "authentication failed", 403: "access forbidden", 429: "rate limited"}.get(code, f"HTTP {code}")
        if code == 429:
            delay = max(delay, retry_delay(exc.response.headers, now))
    except (httpx.RequestError, ValueError, TypeError, KeyError, OverflowError) as exc:
        state = "network unavailable" if isinstance(exc, httpx.RequestError) else "invalid provider response"

    failures = row.failures + 1 if data is None else 0
    if failures:
        delay = max(delay, min(3600, 200 * 2 ** min(failures, 5)))
    with conn.begin():
        conn.execute(text("""
            UPDATE aviation_snapshots
            SET state=:state, failures=:failures, remaining=:remaining, retry_at=:retry,
                succeeded=CASE WHEN :ok THEN :now ELSE succeeded END,
                scope=CASE WHEN :ok THEN CAST(:scope AS jsonb) ELSE scope END,
                aircraft=CASE WHEN :ok THEN CAST(:aircraft AS jsonb) ELSE aircraft END
            WHERE provider=:p
        """), dict(state=state, failures=failures, remaining=remaining, retry=now + timedelta(seconds=delay),
                   ok=data is not None, now=now, scope=json.dumps(scope), aircraft=json.dumps(data), p=provider))
        conn.execute(text("UPDATE event_revisions SET version=version+1 WHERE id=1"))
    return data is not None


async def collect_aviation(client):
    from .db import engine

    opensky = OpenSky()
    while True:
        try:
            with engine.connect() as conn:
                acquired = conn.execute(text("SELECT pg_try_advisory_lock(3198105)")).scalar()
                conn.commit()
                if acquired:
                    try:
                        with conn.begin():
                            config = settings(conn)
                            scope = current_scope(conn, config["radius"])
                            conn.execute(text("""
                                UPDATE aviation_snapshots SET aircraft='[]'
                                WHERE succeeded < now() - interval '15 minutes' AND aircraft <> '[]'
                            """))
                        if scope and config["enabled"]:
                            primary = config["primary_provider"]
                            for provider in (primary, *(p for p in PROVIDERS if p != primary and config["fallback"])):
                                if configured(provider) and await poll(conn, client, opensky, provider, scope):
                                    break
                    finally:
                        conn.rollback()
                        conn.execute(text("SELECT pg_advisory_unlock(3198105)"))
                        conn.commit()
        except Exception as exc:
            print(f"aviation collector storage or scheduling error: {type(exc).__name__}", flush=True)
        await asyncio.sleep(10)


def snapshot(conn, latitude=None, longitude=None, radius=None):
    config = settings(conn)
    scope = current_scope(conn, config["radius"])
    newest = {}
    health = []
    now = time.time()
    rows = {row.provider: row for row in conn.execute(text("""
        SELECT provider, attempted, retry_at, succeeded, quota_day, spent, remaining, state, scope, aircraft
        FROM aviation_snapshots
    """)).mappings()}
    for provider in PROVIDERS:
        row = rows.get(provider)
        state = ("disabled" if not config["enabled"] else
                 "waiting" if configured(provider) else
                 "missing credentials" if provider == "opensky" else "disabled")
        matching = bool(scope and row and row.scope == scope)
        if state == "waiting" and row:
            state = row.state
            if state in ("online", "no recent coverage"):
                if not matching:
                    state = "waiting for coverage"
                elif now - row.succeeded.timestamp() > max(interval(provider) * 2, 420):
                    state = "delayed"
        health.append(dict(provider=provider, state=state, interval=interval(provider),
                           attempted=row.attempted if row else None, succeeded=row.succeeded if row else None,
                           retry_at=row.retry_at if row else None, remaining=row.remaining if row else None,
                           requests_today=row.spent if row and row.quota_day == datetime.now(timezone.utc).date() else 0,
                           request_budget=450 if provider == "adsb.lol" else None))
        if not (matching and config["enabled"] and configured(provider)):
            continue
        for item in row.aircraft:
            age = max(0, now - item["observed"])
            if age > EXPIRY:
                continue
            if latitude is not None and distance(latitude, longitude, item["latitude"], item["longitude"]) > radius:
                continue
            item = dict(item, age=round(age), freshness="fresh" if age <= interval(provider) + 45 else
                        "delayed" if age <= interval(provider) * 2 + 45 else "stale")
            if item["observed"] > newest.get(item["id"], {}).get("observed", 0):
                newest[item["id"]] = item
    return dict(settings=config, scope=scope, providers=health, aircraft=sorted(newest.values(), key=lambda item: item["id"]))

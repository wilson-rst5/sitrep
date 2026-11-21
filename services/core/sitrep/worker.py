"""Independent collector and storage consumer entry points."""
import asyncio
import json
import os
import sys
from datetime import UTC, datetime

import httpx
import nats
from nats.errors import TimeoutError as NATSTimeout
from nats.js.api import AckPolicy, ConsumerConfig, StreamConfig
from nats.js.errors import NotFoundError
from sqlalchemy import text

from .db import engine
from .providers import DEFAULT_PROVIDERS, PROVIDERS, Event

SUBJECT = "sitrep.events.v1"


def log(action, **fields):
    print(json.dumps({"action": action, **fields}), flush=True)


async def broker():
    connection = await nats.connect(os.getenv("NATS_URL", "nats://nats:4222"),
                                    max_reconnect_attempts=-1, reconnect_time_wait=2)
    js = connection.jetstream()
    try:
        await js.stream_info("SITREP")
    except NotFoundError:
        await js.add_stream(StreamConfig(name="SITREP", subjects=[SUBJECT, "sitrep.rejected.v1"],
                                         max_age=86400, max_bytes=268435456))
    return connection, js


def health(conn, identifier, attempted, error):
    conn.execute(text("""
        INSERT INTO provider_health VALUES (:provider,:attempted,:succeeded,:error)
        ON CONFLICT (provider) DO UPDATE SET attempted_at=EXCLUDED.attempted_at,
        succeeded_at=COALESCE(EXCLUDED.succeeded_at,provider_health.succeeded_at), error=EXCLUDED.error
    """), dict(provider=identifier, attempted=attempted,
               succeeded=attempted if error is None else None, error=error))


async def fetch_document(client, url, decode):
    body = bytearray()
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > 8 * 1024 * 1024:
                raise ValueError("Response too large")
    return decode(bytes(body))


async def collect(provider, js, client):
    failures = 0
    while True:
        with engine.connect() as conn:
            acquired = conn.execute(text("SELECT pg_try_advisory_lock(hashtext(:id))"),
                                    {"id": provider.id}).scalar()
            if acquired:
                try:
                    previous = conn.execute(text("SELECT attempted_at FROM provider_health WHERE provider=:id"),
                                            {"id": provider.id}).scalar()
                    attempted = datetime.now(UTC)
                    interval = provider.interval_seconds * 2 ** min(failures, 4)
                    if previous is None or (attempted - previous).total_seconds() >= interval:
                        health(conn, provider.id, attempted, "in_progress")
                        conn.commit()
                        try:
                            documents = [await fetch_document(client, url, provider.decode)
                                         for url in (provider.url, *provider.additional_urls)]
                            data = documents if provider.additional_urls else documents[0]
                            events = list(provider.normalize(data, attempted))
                            for event in events:
                                await js.publish(SUBJECT, event.model_dump_json().encode())
                        except (httpx.HTTPError, ValueError, TypeError, KeyError, OverflowError, nats.errors.Error) as exc:
                            failures += 1
                            health(conn, provider.id, attempted, type(exc).__name__)
                            log("collection_failed", provider=provider.id, error=type(exc).__name__)
                        else:
                            failures = 0
                            health(conn, provider.id, attempted, None)
                            log("collection_succeeded", provider=provider.id, events=len(events))
                        conn.commit()
                finally:
                    conn.rollback()
                    conn.execute(text("SELECT pg_advisory_unlock(hashtext(:id))"), {"id": provider.id})
        await asyncio.sleep(min(provider.interval_seconds, 30))


def store(event):
    with engine.begin() as conn:
        result = conn.execute(text("""
            INSERT INTO events VALUES (
                :provider,:external_id,:category,:severity,:occurred_at,:updated_at,:expires_at,:district,
                ST_SetSRID(ST_MakePoint(:longitude,:latitude),4326)::geography,CAST(:payload AS jsonb)
            )
            ON CONFLICT (provider,external_id) DO UPDATE SET category=EXCLUDED.category,
                severity=EXCLUDED.severity, occurred_at=EXCLUDED.occurred_at, updated_at=EXCLUDED.updated_at,
                expires_at=EXCLUDED.expires_at, district=EXCLUDED.district, point=EXCLUDED.point,
                payload=EXCLUDED.payload WHERE events.updated_at < EXCLUDED.updated_at
        """), {**event.model_dump(exclude={"source_url"}), "payload": event.model_dump_json()})


        if result.rowcount:
            conn.execute(text("UPDATE event_revisions SET version = version + 1 WHERE id = 1"))


async def cleanup():
    while True:
        with engine.begin() as conn:
            removed = conn.execute(text("DELETE FROM events WHERE expires_at <= now()"))
            if removed.rowcount:
                conn.execute(text("UPDATE event_revisions SET version = version + 1 WHERE id = 1"))
            conn.execute(text("DELETE FROM alert_acknowledgements WHERE acknowledged_at <= now() - interval '30 days'"))
            conn.execute(text("DELETE FROM sessions WHERE expires_at <= now()"))
        await asyncio.sleep(3600)


async def consume(js):
    subscription = await js.pull_subscribe(SUBJECT, durable="storage-v1", config=ConsumerConfig(
        durable_name="storage-v1", ack_policy=AckPolicy.EXPLICIT, ack_wait=60,
    ))
    while True:
        try:
            messages = await subscription.fetch(batch=20, timeout=3)
        except NATSTimeout:
            continue
        for message in messages:
            try:
                event = Event.model_validate_json(message.data)
            except ValueError:
                await js.publish("sitrep.rejected.v1", b'{"error":"invalid_event_v1"}')
                await message.term()
                log("event_rejected")
                continue
            try:
                await asyncio.to_thread(store, event)
            except Exception as exc:
                log("storage_failed", error=type(exc).__name__)
                await message.nak(delay=15)
            else:
                await message.ack()


async def main(role):
    connection, js = await broker()
    try:
        if role == "collector":
            enabled = set(os.getenv("ENABLED_PROVIDERS", DEFAULT_PROVIDERS).split(","))
            async with httpx.AsyncClient(timeout=12, follow_redirects=False, trust_env=False) as client:
                jobs = [collect(provider, js, client) for provider in PROVIDERS if provider.id in enabled]
                if jobs:
                    await asyncio.gather(*jobs)
                else:
                    await asyncio.Future()
        elif role == "consumer":
            await asyncio.gather(consume(js), cleanup())
        else:
            raise ValueError("Unknown worker role")
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))

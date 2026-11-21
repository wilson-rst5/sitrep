"""Publish test-only events to an explicitly isolated Compose project."""
import asyncio
from datetime import UTC, datetime, timedelta

from sitrep.providers import Event
from sitrep.worker import SUBJECT, broker


async def main():
    now = datetime.now(UTC)
    connection, stream = await broker()
    try:
        for name, latitude, longitude in (
            ("near", 47.21, -123.19),
            ("far", 42.50, -110.30),
        ):
            event = Event(
                provider="test-fixture", external_id=name, category="earthquake",
                title=f"SIMULATED TEST EVENT ({name})", latitude=latitude, longitude=longitude,
                occurred_at=now, updated_at=now, expires_at=now + timedelta(hours=1),
                severity=2, source_url="https://example.org/",
            )
            # Publish the same revision twice to exercise idempotent storage.
            for _ in range(2):
                await stream.publish(SUBJECT, event.model_dump_json().encode())
        weather = Event(
            provider="test-fixture", external_id="weather", category="weather_observation",
            title="SIMULATED TEST WEATHER", latitude=47.21, longitude=-123.19,
            occurred_at=now, updated_at=now, expires_at=now + timedelta(hours=1),
            severity=0, source_url="https://example.org/",
        )
        await stream.publish(SUBJECT, weather.model_dump_json().encode())
        wildfire = Event(
            provider="test-fixture", external_id="wildfire", category="wildfire",
            title="SIMULATED TEST WILDFIRE", latitude=47.21, longitude=-123.19,
            occurred_at=now, updated_at=now, expires_at=now + timedelta(hours=1),
            severity=1, source_url="https://example.org/",
        )
        await stream.publish(SUBJECT, wildfire.model_dump_json().encode())
    finally:
        await connection.close()


asyncio.run(main())

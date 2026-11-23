"""Run only against a disposable regression database."""
import time

from sqlalchemy import text

from sitrep.db import engine
from sitrep.maritime import normalize, save

now = time.time()


def report(kind, **fields):
    return normalize({"MessageType": kind, "Message": {
        kind: {"UserID": 123456789, "Valid": True, **fields}}}, now)


with engine.connect() as connection:
    def write(item):
        save(connection, {item["mmsi"]: item}, "receiving positions", {"valid_positions": 1})

    write(report("ShipStaticData", Name="AIS TEST VESSEL", Destination="TEST ONLY"))
    write(report("StandardClassBPositionReport", Latitude=47.21, Longitude=-123.18, Sog=4, Cog=93))
    write(report("StandardClassBPositionReport", Latitude=47.21, Longitude=-123.18, Sog=5, Cog=93))
    with connection.begin():
        raw = connection.execute(text("SELECT payload FROM vessels WHERE mmsi='123456789'")).scalar_one()
        assert raw["speed"] == 5 and raw["name"] == "AIS TEST VESSEL" and raw["destination"] == "TEST ONLY"
        assert connection.execute(text("SELECT count(*) FROM vessels WHERE mmsi='123456789'")).scalar_one() == 1

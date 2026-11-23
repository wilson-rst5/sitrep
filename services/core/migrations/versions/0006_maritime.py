"""Store current AIS state and maritime coverage."""
from alembic import op

revision = "0006"
down_revision = "0005"


def upgrade():
    op.execute("""
        CREATE TABLE maritime_settings (
            id integer PRIMARY KEY CHECK (id=1),
            radius integer NOT NULL CHECK (radius BETWEEN 25 AND 450),
            bounds jsonb
        );
        INSERT INTO maritime_settings VALUES (1, 100, NULL);
        CREATE TABLE maritime_health (
            id integer PRIMARY KEY CHECK (id=1),
            state text NOT NULL,
            reported timestamptz NOT NULL DEFAULT now(),
            diagnostics jsonb NOT NULL
        );
        CREATE TABLE vessels (
            mmsi text PRIMARY KEY,
            updated timestamptz NOT NULL DEFAULT now(),
            observed timestamptz,
            position geography(Point,4326),
            payload jsonb NOT NULL
        );
        CREATE INDEX vessels_geography ON vessels USING gist(position);
        CREATE INDEX vessels_observed ON vessels(observed);
    """)


def downgrade():
    op.execute("DROP TABLE vessels, maritime_health, maritime_settings")

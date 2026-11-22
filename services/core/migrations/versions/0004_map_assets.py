from alembic import op

revision = "0004"
down_revision = "0003"


def upgrade():
    op.execute("""
        CREATE TABLE map_assets (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            kind text NOT NULL CHECK (kind IN ('bridge', 'road_watch', 'camera')),
            latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
            longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
            point geography(Point,4326) GENERATED ALWAYS AS
                (ST_SetSRID(ST_MakePoint(longitude, latitude),4326)::geography) STORED,
            payload jsonb NOT NULL,
            enabled boolean NOT NULL DEFAULT true
        );
        CREATE INDEX map_assets_point ON map_assets USING gist (point);
    """)


def downgrade():
    op.execute("DROP TABLE map_assets")

from alembic import op

revision = "0001"
down_revision = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("""
    CREATE TABLE accounts (
        username varchar(80) PRIMARY KEY, password_hash text NOT NULL,
        role text NOT NULL CHECK (role IN ('admin', 'viewer'))
    );
    CREATE TABLE sessions (
        digest text PRIMARY KEY, username varchar(80) NOT NULL REFERENCES accounts ON DELETE CASCADE,
        expires_at timestamptz NOT NULL
    );
    CREATE TABLE locations (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name varchar(120) NOT NULL, country char(2) NOT NULL,
        latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
        longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
        radius integer NOT NULL CHECK (radius BETWEEN 1 AND 2000),
        timezone text NOT NULL, language text NOT NULL, units text NOT NULL,
        district varchar(3)
    );
    CREATE TABLE events (
        provider text NOT NULL, external_id text NOT NULL, category text NOT NULL,
        severity integer NOT NULL CHECK (severity BETWEEN 0 AND 4),
        occurred_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL, district varchar(3),
        point geography(Point,4326), payload jsonb NOT NULL,
        PRIMARY KEY (provider, external_id)
    );
    CREATE INDEX events_point ON events USING gist (point);
    CREATE INDEX events_order ON events (severity DESC, occurred_at DESC);
    CREATE INDEX events_expiration ON events (expires_at);
    CREATE TABLE alert_acknowledgements (
        username varchar(80) NOT NULL REFERENCES accounts ON DELETE CASCADE,
        provider text NOT NULL, external_id text NOT NULL,
        acknowledged_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (username, provider, external_id),
        FOREIGN KEY (provider, external_id) REFERENCES events ON DELETE CASCADE
    );
    CREATE TABLE provider_health (
        provider text PRIMARY KEY, attempted_at timestamptz NOT NULL,
        succeeded_at timestamptz, error text
    );
    CREATE TABLE event_revisions (
        id integer PRIMARY KEY CHECK (id = 1), version bigint NOT NULL DEFAULT 0
    );
    INSERT INTO event_revisions (id) VALUES (1);
    CREATE TABLE audit (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        occurred_at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL, action text NOT NULL
    );
    """)


def downgrade():
    op.execute("DROP TABLE audit, event_revisions, provider_health, alert_acknowledgements, events, locations, sessions, accounts")

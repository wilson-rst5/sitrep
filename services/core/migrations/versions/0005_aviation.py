"""Persist aviation settings, provider quota and latest observations."""

from alembic import op

revision = "0005"
down_revision = "0004"


def upgrade():
    op.execute("""
        CREATE TABLE aviation_settings (
            id integer PRIMARY KEY CHECK (id = 1),
            radius integer NOT NULL DEFAULT 200 CHECK (radius BETWEEN 25 AND 450),
            enabled boolean NOT NULL DEFAULT true,
            primary_provider text NOT NULL DEFAULT 'adsb.lol',
            fallback boolean NOT NULL DEFAULT true
        )
    """)
    op.execute("INSERT INTO aviation_settings (id) VALUES (1)")
    op.execute("""
        CREATE TABLE aviation_snapshots (
            provider text PRIMARY KEY,
            attempted timestamptz,
            retry_at timestamptz,
            succeeded timestamptz,
            quota_day date,
            spent integer NOT NULL DEFAULT 0,
            remaining integer,
            failures integer NOT NULL DEFAULT 0,
            state text NOT NULL DEFAULT 'waiting',
            scope jsonb,
            aircraft jsonb NOT NULL DEFAULT '[]'
        )
    """)


def downgrade():
    op.drop_table("aviation_snapshots")
    op.drop_table("aviation_settings")

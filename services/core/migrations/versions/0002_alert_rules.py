from alembic import op

revision = "0002"
down_revision = "0001"


def upgrade():
    op.execute("""
        CREATE TABLE alert_rules (
            category text PRIMARY KEY CHECK (category ~ '^[a-z][a-z0-9_]{0,39}$'),
            minimum_severity smallint NOT NULL CHECK (minimum_severity BETWEEN 1 AND 4)
        );
        ALTER TABLE alert_acknowledgements ADD COLUMN event_snapshot jsonb;
        UPDATE alert_acknowledgements a SET event_snapshot = e.payload
        FROM events e WHERE e.provider = a.provider AND e.external_id = a.external_id;
        ALTER TABLE alert_acknowledgements
            ALTER COLUMN event_snapshot SET NOT NULL,
            DROP CONSTRAINT alert_acknowledgements_provider_external_id_fkey;
        CREATE INDEX alert_acknowledgements_history
            ON alert_acknowledgements (username, acknowledged_at DESC);
        CREATE INDEX alert_acknowledgements_expiry ON alert_acknowledgements (acknowledged_at);
    """)


def downgrade():
    op.execute("""
        DELETE FROM alert_acknowledgements a WHERE NOT EXISTS (
            SELECT 1 FROM events e WHERE e.provider = a.provider AND e.external_id = a.external_id
        );
        DROP INDEX alert_acknowledgements_expiry, alert_acknowledgements_history;
        ALTER TABLE alert_acknowledgements
            DROP COLUMN event_snapshot,
            ADD FOREIGN KEY (provider, external_id) REFERENCES events ON DELETE CASCADE;
        DROP TABLE alert_rules;
    """)

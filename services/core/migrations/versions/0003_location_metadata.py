from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade():
    op.execute("""
        ALTER TABLE locations ALTER COLUMN country DROP NOT NULL,
            ADD COLUMN geography jsonb NOT NULL DEFAULT '{}'::jsonb,
            ADD COLUMN is_primary boolean NOT NULL DEFAULT false;
        UPDATE locations SET is_primary = true WHERE id = (SELECT min(id) FROM locations);
        CREATE UNIQUE INDEX locations_primary ON locations (is_primary) WHERE is_primary;
    """)


def downgrade():
    op.execute("""
        DROP INDEX locations_primary;
        ALTER TABLE locations DROP COLUMN is_primary, DROP COLUMN geography;
    """)

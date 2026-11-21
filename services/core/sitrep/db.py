import os

from sqlalchemy import create_engine, text

engine = create_engine(
    os.environ["DATABASE_URL"], pool_pre_ping=True, pool_size=5, max_overflow=5,
)


def ready():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1 FROM accounts LIMIT 1"))

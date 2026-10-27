"""Development helper: create tables for newly added models in the dev database without a migration.
The proper Alembic migration is generated when a feature is finished.  Usage: python -m app.dev_create_tables"""

import app.models  # noqa: F401
from app.db import Base, engine

if __name__ == "__main__":
    Base.metadata.create_all(engine)
    print("tables created (existing tables untouched)")

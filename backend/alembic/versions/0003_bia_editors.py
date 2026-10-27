"""BIA creator and last editor (4-eyes approval)

Revision ID: 0003
Revises: 0002
"""
from collections.abc import Sequence

from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for col in ("created_by_id", "updated_by_id"):
        op.execute(f"ALTER TABLE inv_bias ADD COLUMN IF NOT EXISTS {col} INTEGER")
        op.execute(f"""DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_inv_bias_{col}_users') THEN
                ALTER TABLE inv_bias ADD CONSTRAINT fk_inv_bias_{col}_users FOREIGN KEY ({col})
                REFERENCES users (id) ON DELETE SET NULL;
            END IF; END $$""")


def downgrade() -> None:
    for col in ("created_by_id", "updated_by_id"):
        op.execute(f"ALTER TABLE inv_bias DROP CONSTRAINT IF EXISTS fk_inv_bias_{col}_users")
        op.execute(f"ALTER TABLE inv_bias DROP COLUMN IF EXISTS {col}")

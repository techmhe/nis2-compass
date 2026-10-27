"""incident follow-up: involved suppliers and follow-up tasks

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-29 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for col in ("supplier_ids", "follow_up_task_ids"):
        op.execute(f"ALTER TABLE inc_profiles ADD COLUMN IF NOT EXISTS {col} JSON NOT NULL DEFAULT '[]'")


def downgrade() -> None:
    for col in ("supplier_ids", "follow_up_task_ids"):
        op.execute(f"ALTER TABLE inc_profiles DROP COLUMN IF EXISTS {col}")

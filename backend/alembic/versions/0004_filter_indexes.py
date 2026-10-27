"""indexes on action plan and work package filter columns

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-29 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEXES = [("action_items", "target_date"), ("action_items", "status"),
           ("work_packages", "planned_finish"), ("work_packages", "status")]


def upgrade() -> None:
    for table, col in INDEXES:
        op.create_index(op.f(f"ix_{table}_{col}"), table, [col], unique=False, if_not_exists=True)


def downgrade() -> None:
    for table, col in INDEXES:
        op.drop_index(op.f(f"ix_{table}_{col}"), table_name=table, if_exists=True)

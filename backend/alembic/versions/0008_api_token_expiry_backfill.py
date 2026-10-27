"""give API tokens without an expiry a 90-day one

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-27 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0008'
down_revision: Union[str, Sequence[str], None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BACKFILL_SQL = "UPDATE api_tokens SET expires_at = now() + interval '90 days' WHERE expires_at IS NULL"


def upgrade() -> None:
    """Tokens created before expiry became mandatory would otherwise stay valid forever."""
    op.execute(sa.text(BACKFILL_SQL))


def downgrade() -> None:
    """The former NULLs cannot be told apart from real expiries; nothing to undo."""

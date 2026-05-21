"""Add eval_status column to evaluations for intake-pause queue

Revision ID: 003_evaluation_status
Revises: 002_enrichment_and_autopause
Create Date: 2026-05-07 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003_evaluation_status"
down_revision: Union[str, None] = "002_enrichment_and_autopause"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NULL = scored normally; "queued" = held because intake was paused at submission time
    op.add_column(
        "evaluations",
        sa.Column("eval_status", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("evaluations", "eval_status")

"""Add stage column to candidates

Revision ID: 010_candidate_stage
Revises: 009_email_controls
Create Date: 2026-05-11 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "010_candidate_stage"
down_revision: Union[str, None] = "009_email_controls"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "candidates",
        sa.Column(
            "stage",
            sa.String(length=32),
            nullable=False,
            server_default="applied",
        ),
    )


def downgrade() -> None:
    op.drop_column("candidates", "stage")

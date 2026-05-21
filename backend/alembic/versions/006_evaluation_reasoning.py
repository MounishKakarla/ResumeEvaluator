"""Add reasoning_summary column to evaluations

Revision ID: 006_evaluation_reasoning
Revises: 005_job_role_enhancements
Create Date: 2026-05-07 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006_evaluation_reasoning"
down_revision: Union[str, None] = "005_job_role_enhancements"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("evaluations", sa.Column("reasoning_summary", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("evaluations", "reasoning_summary")

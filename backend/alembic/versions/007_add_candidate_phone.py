"""Add phone column to candidates

Revision ID: 007_add_candidate_phone
Revises: 006_evaluation_reasoning
Create Date: 2026-05-08 11:45:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007_add_candidate_phone"
down_revision: Union[str, None] = "006_evaluation_reasoning"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("candidates", sa.Column("phone", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("candidates", "phone")

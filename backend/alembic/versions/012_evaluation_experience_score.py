"""Add experience_score to evaluations

Revision ID: 012_evaluation_experience_score
Revises: 011_job_role_skill_is_required
Create Date: 2026-05-23 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "012_evaluation_experience_score"
down_revision: Union[str, None] = "011_job_role_skill_is_required"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "evaluations",
        sa.Column("experience_score", sa.Float(), nullable=False, server_default="0.0"),
    )


def downgrade() -> None:
    op.drop_column("evaluations", "experience_score")

"""Add is_required to job_role_skills

Revision ID: 011_job_role_skill_is_required
Revises: 010_candidate_stage
Create Date: 2026-05-23 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "011_job_role_skill_is_required"
down_revision: Union[str, None] = "010_candidate_stage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "job_role_skills",
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default="true"),
    )


def downgrade() -> None:
    op.drop_column("job_role_skills", "is_required")

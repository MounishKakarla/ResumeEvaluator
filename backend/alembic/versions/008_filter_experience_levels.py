"""Add filter_experience_levels to job_roles

Revision ID: 008_filter_experience_levels
Revises: 007_add_candidate_phone
Create Date: 2026-05-09 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "008_filter_experience_levels"
down_revision: Union[str, None] = "007_add_candidate_phone"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("job_roles", sa.Column("filter_experience_levels", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("job_roles", "filter_experience_levels")

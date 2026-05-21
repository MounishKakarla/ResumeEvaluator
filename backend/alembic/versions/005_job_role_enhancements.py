"""Add description/min_degree/preferred_majors to job_roles; min_years to job_role_requirements

Revision ID: 005_job_role_enhancements
Revises: 004_job_role_requirements
Create Date: 2026-05-07 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005_job_role_enhancements"
down_revision: Union[str, None] = "004_job_role_requirements"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("job_roles", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("job_roles", sa.Column("min_degree", sa.String(50), nullable=True))
    op.add_column("job_roles", sa.Column("preferred_majors", sa.Text(), nullable=True))
    op.add_column("job_role_requirements", sa.Column("min_years", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("job_role_requirements", "min_years")
    op.drop_column("job_roles", "preferred_majors")
    op.drop_column("job_roles", "min_degree")
    op.drop_column("job_roles", "description")

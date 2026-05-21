"""Add auto_email_enabled to job_roles and email_sent_at to evaluations

Revision ID: 009_email_controls
Revises: 008_filter_experience_levels
Create Date: 2026-05-11 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009_email_controls"
down_revision: Union[str, None] = "008_filter_experience_levels"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "job_roles",
        sa.Column("auto_email_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "evaluations",
        sa.Column("email_sent_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("job_roles", "auto_email_enabled")
    op.drop_column("evaluations", "email_sent_at")

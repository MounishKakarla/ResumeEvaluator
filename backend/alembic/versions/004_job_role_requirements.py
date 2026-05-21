"""Add job_role_requirements table and requirements_breakdown on evaluations

Revision ID: 004_job_role_requirements
Revises: 003_evaluation_status
Create Date: 2026-05-07 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004_job_role_requirements"
down_revision: Union[str, None] = "003_evaluation_status"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "job_role_requirements",
        sa.Column("id",          sa.Integer(),      nullable=False),
        sa.Column("job_role_id", sa.Integer(),      nullable=False),
        sa.Column("label",       sa.String(255),    nullable=False),
        sa.Column("weight",      sa.Float(),        nullable=False),
        sa.Column("req_type",    sa.String(50),     nullable=False, server_default="skill"),
        sa.Column("description", sa.Text(),         nullable=True),
        sa.ForeignKeyConstraint(["job_role_id"], ["job_roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_job_role_requirements_id",          "job_role_requirements", ["id"])
    op.create_index("ix_job_role_requirements_job_role_id", "job_role_requirements", ["job_role_id"])

    op.add_column(
        "evaluations",
        sa.Column("requirements_breakdown", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("evaluations", "requirements_breakdown")
    op.drop_index("ix_job_role_requirements_job_role_id", table_name="job_role_requirements")
    op.drop_index("ix_job_role_requirements_id",          table_name="job_role_requirements")
    op.drop_table("job_role_requirements")

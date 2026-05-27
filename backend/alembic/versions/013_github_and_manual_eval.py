"""Add require_github to job_roles and create manual_evaluations table

Revision ID: 013_github_and_manual_eval
Revises: 012_evaluation_experience_score
Create Date: 2026-05-27 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "013_github_and_manual_eval"
down_revision: Union[str, None] = "012_evaluation_experience_score"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # Check if require_github already exists in job_roles
    columns = [col["name"] for col in inspector.get_columns("job_roles")]
    if "require_github" not in columns:
        op.add_column(
            "job_roles",
            sa.Column(
                "require_github",
                sa.Boolean(),
                nullable=False,
                server_default="false",
            ),
        )

    # Check if manual_evaluations table already exists
    tables = inspector.get_table_names()
    if "manual_evaluations" not in tables:
        op.create_table(
            "manual_evaluations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "evaluation_id",
                sa.Integer(),
                sa.ForeignKey("evaluations.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "recruiter_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("manual_score", sa.Float(), nullable=False),
            sa.Column("justification", sa.Text(), nullable=True),
            sa.Column("skills_checklist", sa.Text(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )

    # Check if index already exists (only if table already existed before this migration)
    if "manual_evaluations" in tables:
        try:
            indexes = [idx["name"] for idx in inspector.get_indexes("manual_evaluations")]
            if "ix_manual_evaluations_evaluation_id" not in indexes:
                op.create_index(
                    "ix_manual_evaluations_evaluation_id",
                    "manual_evaluations",
                    ["evaluation_id"],
                )
        except Exception:
            pass


def downgrade() -> None:
    op.drop_index("ix_manual_evaluations_evaluation_id", table_name="manual_evaluations")
    op.drop_table("manual_evaluations")
    op.drop_column("job_roles", "require_github")

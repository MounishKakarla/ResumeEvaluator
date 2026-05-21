"""initial schema

Revision ID: 001_initial
Revises:
Create Date: 2024-01-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- users ---
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False, server_default="recruiter"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )

    # --- skills ---
    op.create_table(
        "skills",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("embedding", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    # --- job_roles ---
    op.create_table(
        "job_roles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("min_experience", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("weight_projects", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("weight_skills", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("weight_education", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("cosine_threshold", sa.Float(), nullable=False, server_default="0.70"),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    # --- job_role_skills ---
    op.create_table(
        "job_role_skills",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("job_role_id", sa.Integer(), nullable=False),
        sa.Column("skill_id", sa.Integer(), nullable=False),
        sa.Column("is_keyword", sa.Boolean(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["job_role_id"], ["job_roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["skill_id"], ["skills.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # --- candidates ---
    op.create_table(
        "candidates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("current_version_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # --- resume_versions ---
    op.create_table(
        "resume_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("candidate_id", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(length=500), nullable=False),
        sa.Column("file_path", sa.String(length=1000), nullable=False),
        sa.Column("simhash", sa.String(length=64), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Add FK from candidates.current_version_id -> resume_versions.id
    # (deferred to avoid circular; SQLite doesn't enforce it strictly anyway)
    op.create_foreign_key(
        "fk_candidates_current_version",
        "candidates",
        "resume_versions",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # --- resumes ---
    op.create_table(
        "resumes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("sections", sa.Text(), nullable=True),
        sa.Column("parsed_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["id"], ["resume_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # --- evaluations ---
    op.create_table(
        "evaluations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("resume_id", sa.Integer(), nullable=False),
        sa.Column("job_role_id", sa.Integer(), nullable=False),
        sa.Column("total_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("project_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("skill_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("education_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("skills_matched", sa.Text(), nullable=True),
        sa.Column("excerpts", sa.Text(), nullable=True),
        sa.Column("evaluated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["job_role_id"], ["job_roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["resume_id"], ["resumes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_role_id", "resume_id", name="uq_eval_job_resume"),
    )

    # --- shortlists ---
    op.create_table(
        "shortlists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("evaluation_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("changed_by", sa.Integer(), nullable=True),
        sa.Column("changed_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["changed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["evaluation_id"], ["evaluations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # --- outcomes ---
    op.create_table(
        "outcomes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("candidate_id", sa.Integer(), nullable=False),
        sa.Column("outcome", sa.String(length=50), nullable=False),
        sa.Column("recorded_by", sa.Integer(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recorded_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    # --- audit_log ---
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=255), nullable=False),
        sa.Column("target_type", sa.String(length=100), nullable=True),
        sa.Column("target_id", sa.Integer(), nullable=True),
        sa.Column("timestamp", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    # --- Indexes ---
    op.create_index(
        "ix_evaluations_total_score",
        "evaluations",
        [sa.text("total_score DESC")],
    )
    op.create_index(
        "ix_resume_versions_simhash",
        "resume_versions",
        ["simhash"],
    )


def downgrade() -> None:
    op.drop_index("ix_resume_versions_simhash", table_name="resume_versions")
    op.drop_index("ix_evaluations_total_score", table_name="evaluations")
    op.drop_table("audit_log")
    op.drop_table("outcomes")
    op.drop_table("shortlists")
    op.drop_table("evaluations")
    op.drop_table("resumes")
    op.drop_constraint("fk_candidates_current_version", "candidates", type_="foreignkey")
    op.drop_table("resume_versions")
    op.drop_table("candidates")
    op.drop_table("job_role_skills")
    op.drop_table("job_roles")
    op.drop_table("skills")
    op.drop_table("users")

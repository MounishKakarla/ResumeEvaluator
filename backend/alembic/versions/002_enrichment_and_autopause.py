"""enrichment columns, auto-pause fields, inbound_emails table

Revision ID: 002_enrichment_and_autopause
Revises: 001_initial
Create Date: 2026-05-06 00:00:00.000000

Adds:
  candidates   — linkedin_url, github_url, portfolio_url, linkedin_data,
                 github_summary, consistency_flags, enrichment_sources,
                 needs_manual_review
  job_roles    — intake_paused, shortlist_target, min_fit_score
  inbound_emails (new table)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002_enrichment_and_autopause"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------ #
    # candidates — enrichment columns                                      #
    # ------------------------------------------------------------------ #
    op.add_column("candidates", sa.Column("linkedin_url",      sa.String(500), nullable=True))
    op.add_column("candidates", sa.Column("github_url",        sa.String(500), nullable=True))
    op.add_column("candidates", sa.Column("portfolio_url",     sa.String(500), nullable=True))
    op.add_column("candidates", sa.Column("linkedin_data",     sa.Text(),      nullable=True))
    op.add_column("candidates", sa.Column("github_summary",    sa.Text(),      nullable=True))
    op.add_column("candidates", sa.Column("consistency_flags", sa.Text(),      nullable=True))
    op.add_column("candidates", sa.Column("enrichment_sources",sa.Text(),      nullable=True))
    op.add_column(
        "candidates",
        sa.Column("needs_manual_review", sa.Boolean(), nullable=False, server_default="0"),
    )

    # ------------------------------------------------------------------ #
    # job_roles — auto-pause fields                                        #
    # ------------------------------------------------------------------ #
    op.add_column(
        "job_roles",
        sa.Column("intake_paused", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.add_column("job_roles", sa.Column("shortlist_target", sa.Integer(), nullable=True))
    op.add_column("job_roles", sa.Column("min_fit_score",    sa.Float(),   nullable=True))

    # ------------------------------------------------------------------ #
    # inbound_emails (new table)                                           #
    # ------------------------------------------------------------------ #
    op.create_table(
        "inbound_emails",
        sa.Column("id",             sa.Integer(),      nullable=False),
        sa.Column("message_id",     sa.String(500),    nullable=False),
        sa.Column("sender_email",   sa.String(255),    nullable=True),
        sa.Column("subject",        sa.String(500),    nullable=True),
        sa.Column("received_at",    sa.DateTime(),     nullable=False, server_default=sa.func.now()),
        sa.Column("job_id",         sa.Integer(),      nullable=True),
        sa.Column("status",         sa.String(50),     nullable=False, server_default="new"),
        sa.Column("raw_file_paths", sa.Text(),         nullable=True),
        sa.Column("error_message",  sa.Text(),         nullable=True),
        sa.ForeignKeyConstraint(["job_id"], ["job_roles.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", name="uq_inbound_emails_message_id"),
    )
    op.create_index("ix_inbound_emails_id",         "inbound_emails", ["id"])
    op.create_index("ix_inbound_emails_received_at","inbound_emails", ["received_at"])


def downgrade() -> None:
    # inbound_emails
    op.drop_index("ix_inbound_emails_received_at", table_name="inbound_emails")
    op.drop_index("ix_inbound_emails_id",          table_name="inbound_emails")
    op.drop_table("inbound_emails")

    # job_roles
    op.drop_column("job_roles", "min_fit_score")
    op.drop_column("job_roles", "shortlist_target")
    op.drop_column("job_roles", "intake_paused")

    # candidates
    op.drop_column("candidates", "needs_manual_review")
    op.drop_column("candidates", "enrichment_sources")
    op.drop_column("candidates", "consistency_flags")
    op.drop_column("candidates", "github_summary")
    op.drop_column("candidates", "linkedin_data")
    op.drop_column("candidates", "portfolio_url")
    op.drop_column("candidates", "github_url")
    op.drop_column("candidates", "linkedin_url")

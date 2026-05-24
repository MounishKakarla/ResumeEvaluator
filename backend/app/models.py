from datetime import datetime, timezone


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="recruiter")  # "admin" | "recruiter"
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)

    # Relationships
    job_roles = relationship(
        "JobRole",
        back_populates="creator",
        foreign_keys="JobRole.created_by",
    )
    shortlists = relationship(
        "Shortlist",
        back_populates="changer",
        foreign_keys="Shortlist.changed_by",
    )
    outcomes = relationship(
        "Outcome",
        back_populates="recorder",
        foreign_keys="Outcome.recorded_by",
    )
    audit_logs = relationship("AuditLog", back_populates="user")


class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    # Nullable FK to resume_versions; use_alter + post_update avoids circular dependency
    current_version_id = Column(
        Integer,
        ForeignKey("resume_versions.id", use_alter=True, ondelete="SET NULL"),
        nullable=True,
    )
    # External profile links (extracted from resume/email)
    linkedin_url = Column(String(500), nullable=True)
    github_url = Column(String(500), nullable=True)
    portfolio_url = Column(String(500), nullable=True)
    # Parsed profile fields (extracted during resume processing)
    current_title = Column(String(200), nullable=True)     # most recent job title
    experience_level = Column(String(20), nullable=True)   # junior | mid | senior | executive
    years_experience = Column(Float, nullable=True)        # calculated from date ranges
    graduation_year = Column(Integer, nullable=True)        # most recent education end year
    # Enrichment data (JSON blobs)
    linkedin_data = Column(Text, nullable=True)       # JSON: enriched LinkedIn profile
    github_summary = Column(Text, nullable=True)      # JSON: github_summary object
    consistency_flags = Column(Text, nullable=True)   # JSON: list of consistency_flag objects
    enrichment_sources = Column(Text, nullable=True)  # JSON: list of source names used
    portfolio_summary = Column(Text, nullable=True)    # JSON: portfolio analysis result
    project_analysis = Column(Text, nullable=True)     # JSON: on-demand deep project analysis result
    needs_manual_review = Column(Boolean, nullable=False, default=False)
    # Intake channel: upload | email | csv | manual
    source = Column(String(32), nullable=True)
    # Hiring pipeline stage
    stage = Column(String(32), nullable=False, default="applied")  # applied|screening|coding|interview|offer|hired|rejected
    # Soft delete — set to non-null to hide the candidate without losing history
    deleted_at = Column(DateTime, nullable=True, default=None)

    # Relationships
    resume_versions = relationship(
        "ResumeVersion",
        back_populates="candidate",
        foreign_keys="ResumeVersion.candidate_id",
    )
    current_version = relationship(
        "ResumeVersion",
        foreign_keys=[current_version_id],
        post_update=True,
    )
    outcomes = relationship("Outcome", back_populates="candidate")


class ResumeVersion(Base):
    __tablename__ = "resume_versions"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(
        Integer,
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
    )
    filename = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)
    simhash = Column(String(64), nullable=True)
    uploaded_at = Column(DateTime, nullable=False, default=_utcnow)
    is_current = Column(Boolean, nullable=False, default=True)

    __table_args__ = (
        Index("ix_resume_versions_simhash", "simhash"),
    )

    # Relationships
    candidate = relationship(
        "Candidate",
        back_populates="resume_versions",
        foreign_keys=[candidate_id],
    )
    resume = relationship("Resume", back_populates="version", uselist=False)


class Resume(Base):
    """Parsed content for a resume version.  id == resume_version_id (1-to-1)."""

    __tablename__ = "resumes"

    id = Column(
        Integer,
        ForeignKey("resume_versions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    raw_text = Column(Text, nullable=True)
    sections = Column(Text, nullable=True)   # JSON-serialised list[Section]
    parsed_at = Column(DateTime, nullable=False, default=_utcnow)

    # Relationships
    version = relationship("ResumeVersion", back_populates="resume")
    evaluations = relationship("Evaluation", back_populates="resume")


class JobRoleRequirement(Base):
    """Per-requirement weight entry for a job role (flexible alternative to fixed 3-weights)."""
    __tablename__ = "job_role_requirements"

    id = Column(Integer, primary_key=True, index=True)
    job_role_id = Column(
        Integer,
        ForeignKey("job_roles.id", ondelete="CASCADE"),
        nullable=False,
    )
    label = Column(String(255), nullable=False)       # e.g. "5+ years Python"
    weight = Column(Float, nullable=False)             # 0-100; all for a role should sum to 100
    req_type = Column(String(50), nullable=False, default="skill")  # skill|experience|education|other
    description = Column(Text, nullable=True)          # optional freeform detail
    min_years = Column(Integer, nullable=True)         # minimum years required (experience type)

    job_role = relationship("JobRole", back_populates="requirements")


class JobRole(Base):
    __tablename__ = "job_roles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    min_experience = Column(Integer, nullable=True, default=0)
    weight_projects = Column(Integer, nullable=False, default=50)
    weight_skills = Column(Integer, nullable=False, default=30)
    weight_education = Column(Integer, nullable=False, default=20)
    cosine_threshold = Column(Float, nullable=False, default=0.70)
    description = Column(Text, nullable=True)          # full job description text
    min_degree = Column(String(50), nullable=True)     # bachelor | master | phd
    preferred_majors = Column(Text, nullable=True)     # JSON list[str]
    created_by = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    # Candidate pre-filter: comma-separated experience levels (e.g. "mid,senior")
    # Empty/null means accept all levels.
    filter_experience_levels = Column(String(100), nullable=True)
    # Auto-pause threshold settings
    intake_paused = Column(Boolean, nullable=False, default=False)
    shortlist_target = Column(Integer, nullable=True)
    min_fit_score = Column(Float, nullable=True)
    # Email controls: when False, auto-emails are suppressed; admin can still send manually
    auto_email_enabled = Column(Boolean, nullable=False, default=True)
    # Hybrid pipeline Stage-1: minimum TF-IDF cosine similarity to pass to LLM.
    # 0.0 (default) = disabled — every resume goes to the LLM scorer.
    tfidf_threshold = Column(Float, nullable=True, default=0.0)
    # Fresher/recency filter: evaluate only candidates whose graduation year falls within
    # [min_graduation_year, max_graduation_year]. Null on either end means unbounded.
    min_graduation_year = Column(Integer, nullable=True)
    max_graduation_year = Column(Integer, nullable=True)
    # When True, all candidates for this role are scored with fresher-friendly rules:
    # design-verb project boost (+15%), no recency decay, global skill coverage.
    is_entry_level = Column(Boolean, nullable=False, default=False)

    # Relationships
    creator = relationship("User", back_populates="job_roles", foreign_keys=[created_by])
    job_role_skills = relationship(
        "JobRoleSkill",
        back_populates="job_role",
        cascade="all, delete-orphan",
    )
    requirements = relationship(
        "JobRoleRequirement",
        back_populates="job_role",
        cascade="all, delete-orphan",
        order_by="JobRoleRequirement.id",
    )
    evaluations = relationship("Evaluation", back_populates="job_role")


class Skill(Base):
    __tablename__ = "skills"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)
    category = Column(String(100), nullable=True)
    embedding = Column(Text, nullable=True)   # JSON-serialised list[float]

    # Relationships
    job_role_skills = relationship(
        "JobRoleSkill",
        back_populates="skill",
        cascade="all, delete-orphan",
    )


class JobRoleSkill(Base):
    __tablename__ = "job_role_skills"

    id = Column(Integer, primary_key=True, index=True)
    job_role_id = Column(
        Integer,
        ForeignKey("job_roles.id", ondelete="CASCADE"),
        nullable=False,
    )
    skill_id = Column(
        Integer,
        ForeignKey("skills.id", ondelete="CASCADE"),
        nullable=False,
    )
    is_keyword = Column(Boolean, nullable=False, default=False)
    is_required = Column(Boolean, nullable=False, default=True)

    # Relationships
    job_role = relationship("JobRole", back_populates="job_role_skills")
    skill = relationship("Skill", back_populates="job_role_skills")


class Evaluation(Base):
    __tablename__ = "evaluations"

    id = Column(Integer, primary_key=True, index=True)
    resume_id = Column(
        Integer,
        ForeignKey("resumes.id", ondelete="CASCADE"),
        nullable=False,
    )
    job_role_id = Column(
        Integer,
        ForeignKey("job_roles.id", ondelete="CASCADE"),
        nullable=False,
    )
    total_score = Column(Float, nullable=False, default=0.0)
    project_score = Column(Float, nullable=False, default=0.0)
    skill_score = Column(Float, nullable=False, default=0.0)
    education_score = Column(Float, nullable=False, default=0.0)
    experience_score = Column(Float, nullable=False, default=0.0)
    skills_matched = Column(Text, nullable=True)          # JSON list[SkillMatchDetail]
    excerpts = Column(Text, nullable=True)                 # JSON list[str]
    requirements_breakdown = Column(Text, nullable=True)   # JSON list[RequirementScore] when req-mode
    reasoning_summary = Column(Text, nullable=True)        # AI-generated or rule-based fit summary
    evaluated_at = Column(DateTime, nullable=False, default=_utcnow)
    # None = scored normally; "queued" = held because intake was paused
    eval_status = Column(String(20), nullable=True, default=None)
    # Set when a next-steps email has been sent to this candidate for this evaluation
    email_sent_at = Column(DateTime, nullable=True, default=None)
    # Set when the candidate opens the email (1×1 tracking pixel hit)
    email_opened_at = Column(DateTime, nullable=True, default=None)
    # Opaque token used to identify the evaluation in tracking pixel requests
    email_tracking_token = Column(String(64), nullable=True, unique=True, index=True)
    # Stage-1 TF-IDF cosine similarity score (0-1). Stored for every evaluation
    # so the UI can surface it regardless of whether the pre-filter fired.
    tfidf_score = Column(Float, nullable=True)
    # AI-generated interview prep questions (JSON list[str])
    interview_questions = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("job_role_id", "resume_id", name="uq_eval_job_resume"),
        Index("ix_evaluations_total_score", "total_score"),
    )

    # Relationships
    resume = relationship("Resume", back_populates="evaluations")
    job_role = relationship("JobRole", back_populates="evaluations")
    shortlists = relationship(
        "Shortlist",
        back_populates="evaluation",
        cascade="all, delete-orphan",
    )


class Shortlist(Base):
    __tablename__ = "shortlists"

    id = Column(Integer, primary_key=True, index=True)
    evaluation_id = Column(
        Integer,
        ForeignKey("evaluations.id", ondelete="CASCADE"),
        nullable=False,
    )
    status = Column(String(50), nullable=False, default="review")  # shortlisted | review | rejected
    note = Column(Text, nullable=True)
    changed_by = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_at = Column(DateTime, nullable=False, default=_utcnow)

    # Relationships
    evaluation = relationship("Evaluation", back_populates="shortlists")
    changer = relationship("User", back_populates="shortlists", foreign_keys=[changed_by])


class Outcome(Base):
    __tablename__ = "outcomes"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(
        Integer,
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
    )
    outcome = Column(String(50), nullable=False)   # hired | rejected | withdrew
    recorded_by = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    recorded_at = Column(DateTime, nullable=False, default=_utcnow)

    # Relationships
    candidate = relationship("Candidate", back_populates="outcomes")
    recorder = relationship("User", back_populates="outcomes", foreign_keys=[recorded_by])


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    action = Column(String(255), nullable=False)   # e.g. "update", "delete", "restore", "stage_change"
    target_type = Column(String(100), nullable=True)  # "candidate" | "evaluation"
    target_id = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)          # JSON: {field: [old, new], ...}
    timestamp = Column(DateTime, nullable=False, default=_utcnow)

    # Relationships
    user = relationship("User", back_populates="audit_logs")


class EmailTemplate(Base):
    """Admin-editable email templates. subject/body_text override hardcoded defaults."""
    __tablename__ = "email_templates"

    key = Column(String(64), primary_key=True)
    subject = Column(Text, nullable=False)
    body_text = Column(Text, nullable=False)
    updated_at = Column(DateTime, nullable=True, default=_utcnow)


class SystemSetting(Base):
    """Key-value store for admin-configurable system settings (e.g. IMAP credentials)."""
    __tablename__ = "system_settings"

    key = Column(String(128), primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, nullable=True, default=_utcnow)


class InboundEmail(Base):
    """Tracks emails received by the ingestion pipeline."""

    __tablename__ = "inbound_emails"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(String(500), unique=True, nullable=False)  # IMAP message-id header
    sender_email = Column(String(255), nullable=True)
    subject = Column(String(500), nullable=True)
    received_at = Column(DateTime, nullable=False, default=_utcnow)
    job_id = Column(
        Integer,
        ForeignKey("job_roles.id", ondelete="SET NULL"),
        nullable=True,
    )
    status = Column(String(50), nullable=False, default="new")  # new | processed | failed | no_attachment
    raw_file_paths = Column(Text, nullable=True)  # JSON list of saved attachment paths
    error_message = Column(Text, nullable=True)


class InterviewFeedback(Base):
    """Structured feedback submitted by interviewers after each interview stage."""

    __tablename__ = "interview_feedback"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(
        Integer,
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    evaluation_id = Column(
        Integer,
        ForeignKey("evaluations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    interviewer_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    stage = Column(String(32), nullable=False)          # screening | coding | interview
    rating = Column(Integer, nullable=False)             # 1–5 overall
    technical_score = Column(Float, nullable=True)       # 0–10
    communication_score = Column(Float, nullable=True)   # 0–10
    culture_fit_score = Column(Float, nullable=True)     # 0–10
    recommendation = Column(String(32), nullable=True)   # strong_hire | hire | no_hire | strong_no_hire
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)

    # Relationships
    candidate = relationship("Candidate")
    evaluation = relationship("Evaluation")
    interviewer = relationship("User")


class CandidateComment(Base):
    """Team collaboration: threaded comments on a candidate visible to all recruiters."""

    __tablename__ = "candidate_comments"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(
        Integer,
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    author_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=True)

    candidate = relationship("Candidate")
    author = relationship("User")

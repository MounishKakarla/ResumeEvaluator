from typing import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.config import settings

# ---------------------------------------------------------------------------
# Engine configuration
# ---------------------------------------------------------------------------

_is_sqlite = "sqlite" in settings.database_url

_connect_args = {"check_same_thread": False} if _is_sqlite else {}

_engine_kwargs: dict = dict(
    connect_args=_connect_args,
    echo=False,
)

if not _is_sqlite:
    # PostgreSQL production settings
    _engine_kwargs.update(
        pool_size=10,
        max_overflow=20,
        pool_recycle=1800,     # recycle connections after 30 min (avoids stale TCP)
        pool_pre_ping=True,    # test connection health before checkout
        pool_timeout=30,
    )

engine = create_engine(settings.database_url, **_engine_kwargs)

# Enable WAL mode for SQLite (better concurrent read performance in dev)
if _is_sqlite:
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, _connection_record):  # type: ignore[misc]
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

def get_db() -> Generator[Session, None, None]:
    """Yield a SQLAlchemy session; roll back on unhandled exceptions."""
    db: Session = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# deps.py imports its own get_db — keep this canonical copy here for
# any non-FastAPI callers that import directly from database.


# ---------------------------------------------------------------------------
# Table creation (dev / first-run only — use Alembic for migrations)
# ---------------------------------------------------------------------------

def create_db_tables() -> None:
    """Create all ORM-mapped tables that don't already exist, and apply
    incremental schema additions that Alembic would normally handle."""
    import app.models  # noqa: F401 — registers all models with Base.metadata
    Base.metadata.create_all(bind=engine)

    # ---------------------------------------------------------------------------
    # Incremental column additions — safe to run multiple times (IF NOT EXISTS)
    # ---------------------------------------------------------------------------
    _apply_schema_patches()


def _apply_schema_patches() -> None:
    """Apply additive schema changes that are safe to run repeatedly.

    Each patch runs in its own transaction so a PostgreSQL error on one patch
    (aborted transaction state) cannot silently kill all subsequent patches.
    """
    _PATCHES = [
        # (primary DDL with IF NOT EXISTS,  SQLite fallback without IF NOT EXISTS)
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phone VARCHAR(50)",
            "ALTER TABLE candidates ADD COLUMN phone VARCHAR(50)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_title VARCHAR(200)",
            "ALTER TABLE candidates ADD COLUMN current_title VARCHAR(200)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS experience_level VARCHAR(20)",
            "ALTER TABLE candidates ADD COLUMN experience_level VARCHAR(20)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS years_experience FLOAT",
            "ALTER TABLE candidates ADD COLUMN years_experience FLOAT",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS filter_experience_levels VARCHAR(100)",
            "ALTER TABLE job_roles ADD COLUMN filter_experience_levels VARCHAR(100)",
        ),
        (
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
            "ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS auto_email_enabled BOOLEAN NOT NULL DEFAULT TRUE",
            "ALTER TABLE job_roles ADD COLUMN auto_email_enabled BOOLEAN NOT NULL DEFAULT 1",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP",
            "ALTER TABLE evaluations ADD COLUMN email_sent_at TIMESTAMP",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS stage VARCHAR(32) NOT NULL DEFAULT 'applied'",
            "ALTER TABLE candidates ADD COLUMN stage VARCHAR(32) NOT NULL DEFAULT 'applied'",
        ),
        (
            "CREATE TABLE IF NOT EXISTS email_templates (key VARCHAR(64) PRIMARY KEY, subject TEXT NOT NULL, body_text TEXT NOT NULL, updated_at TIMESTAMP)",
            "CREATE TABLE IF NOT EXISTS email_templates (key VARCHAR(64) PRIMARY KEY, subject TEXT NOT NULL, body_text TEXT NOT NULL, updated_at TIMESTAMP)",
        ),
        (
            "CREATE TABLE IF NOT EXISTS system_settings (key VARCHAR(128) PRIMARY KEY, value TEXT, updated_at TIMESTAMP)",
            "CREATE TABLE IF NOT EXISTS system_settings (key VARCHAR(128) PRIMARY KEY, value TEXT, updated_at TIMESTAMP)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS portfolio_summary TEXT",
            "ALTER TABLE candidates ADD COLUMN portfolio_summary TEXT",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS email_opened_at TIMESTAMP",
            "ALTER TABLE evaluations ADD COLUMN email_opened_at TIMESTAMP",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS email_tracking_token VARCHAR(64)",
            "ALTER TABLE evaluations ADD COLUMN email_tracking_token VARCHAR(64)",
        ),
        (
            "CREATE TABLE IF NOT EXISTS candidate_comments (id SERIAL PRIMARY KEY, candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, author_id INTEGER REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP)",
            "CREATE TABLE IF NOT EXISTS candidate_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, author_id INTEGER REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP)",
        ),
        (
            "CREATE TABLE IF NOT EXISTS interview_feedback (id SERIAL PRIMARY KEY, candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, evaluation_id INTEGER REFERENCES evaluations(id) ON DELETE SET NULL, interviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL, stage VARCHAR(32) NOT NULL, rating INTEGER NOT NULL, technical_score FLOAT, communication_score FLOAT, culture_fit_score FLOAT, recommendation VARCHAR(32), notes TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS interview_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, evaluation_id INTEGER REFERENCES evaluations(id) ON DELETE SET NULL, interviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL, stage VARCHAR(32) NOT NULL, rating INTEGER NOT NULL, technical_score FLOAT, communication_score FLOAT, culture_fit_score FLOAT, recommendation VARCHAR(32), notes TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        ),
        # Hybrid pipeline: TF-IDF Stage-1 columns
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS tfidf_score FLOAT",
            "ALTER TABLE evaluations ADD COLUMN tfidf_score FLOAT",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS tfidf_threshold FLOAT DEFAULT 0.0",
            "ALTER TABLE job_roles ADD COLUMN tfidf_threshold FLOAT DEFAULT 0.0",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS graduation_year INTEGER",
            "ALTER TABLE candidates ADD COLUMN graduation_year INTEGER",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS min_graduation_year INTEGER",
            "ALTER TABLE job_roles ADD COLUMN min_graduation_year INTEGER",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS max_graduation_year INTEGER",
            "ALTER TABLE job_roles ADD COLUMN max_graduation_year INTEGER",
        ),
        (
            "ALTER TABLE job_roles ADD COLUMN IF NOT EXISTS is_entry_level BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE job_roles ADD COLUMN is_entry_level BOOLEAN NOT NULL DEFAULT FALSE",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS project_analysis TEXT",
            "ALTER TABLE candidates ADD COLUMN project_analysis TEXT",
        ),
        (
            "ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS interview_questions TEXT",
            "ALTER TABLE evaluations ADD COLUMN interview_questions TEXT",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS source VARCHAR(32)",
            "ALTER TABLE candidates ADD COLUMN source VARCHAR(32)",
        ),
        (
            "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP",
            "ALTER TABLE candidates ADD COLUMN deleted_at TIMESTAMP",
        ),
        # Audit trail table
        (
            "CREATE TABLE IF NOT EXISTS audit_log (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, action VARCHAR(255) NOT NULL, target_type VARCHAR(100), target_id INTEGER, details TEXT, timestamp TIMESTAMP NOT NULL DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, action VARCHAR(255) NOT NULL, target_type VARCHAR(100), target_id INTEGER, details TEXT, timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        ),
        (
            "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS details TEXT",
            "ALTER TABLE audit_log ADD COLUMN details TEXT",
        ),
    ]

    for ddl, fallback in _PATCHES:
        # Each patch gets its own connection/transaction so a PostgreSQL
        # "transaction aborted" state on one patch cannot cascade to others.
        try:
            with engine.begin() as conn:
                conn.execute(text(ddl))
        except Exception:
            try:
                with engine.begin() as conn:
                    conn.execute(text(fallback))
            except Exception:
                pass  # Column already exists or other non-fatal DDL error


# ---------------------------------------------------------------------------
# One-time data fixes run on startup
# ---------------------------------------------------------------------------

_SECTION_HEADER_NAMES = {
    "career objective",
    "professional summary",
    "work experience",
    "education background",
    "educational background",
    "skills summary",
    "technical skills",
    "core competencies",
    "key skills",
    "areas of expertise",
    "summary of qualifications",
    "personal information",
    "contact information",
    "references available",
    "about me",
    "profile summary",
    "career summary",
    "objective statement",
    "professional profile",
}


def fix_section_header_candidate_names() -> None:
    """Replace candidate names that are section headers with email username or 'Unknown'."""
    db = SessionLocal()
    try:
        from app.models import Candidate  # noqa: import inside function to avoid circular
        candidates = db.query(Candidate).all()
        updated = 0
        for c in candidates:
            if c.name and c.name.lower() in _SECTION_HEADER_NAMES:
                if c.email:
                    c.name = c.email.split("@")[0].replace(".", " ").title()
                else:
                    c.name = "Unknown"
                updated += 1
        if updated:
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def ensure_admin_user() -> None:
    """Create the admin user from .env on first run if they don't already exist."""
    import os
    from app.auth import get_password_hash
    from app.models import User

    admin_email = os.environ.get("ADMIN_EMAIL", "").strip()
    admin_password = os.environ.get("ADMIN_PASSWORD", "").strip()

    if not admin_email or not admin_password:
        return

    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == admin_email).first() is None:
            db.add(User(
                email=admin_email,
                hashed_password=get_password_hash(admin_password),
                role="admin",
                is_active=True,
            ))
            db.commit()
            print(f"Startup: Created admin user {admin_email}")
    except Exception as exc:
        db.rollback()
        import logging
        logging.getLogger(__name__).error("Startup ensure_admin_user failed: %s", exc)
    finally:
        db.close()

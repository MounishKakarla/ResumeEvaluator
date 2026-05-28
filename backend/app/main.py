from __future__ import annotations

import logging
import logging.config
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import create_db_tables, fix_section_header_candidate_names
from app.middleware.rate_limit import RateLimitMiddleware
from app.routers import admin, analytics, audit, auth, candidates, comments, enrichment, evaluate, inbound_emails, interview_feedback, job_roles, manual_eval, onedrive, results, sharepoint, shortlist, skills, upload

# ---------------------------------------------------------------------------
# Structured logging setup (runs before anything else)
# ---------------------------------------------------------------------------

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": "logging.Formatter",
            "fmt": '{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
            "datefmt": "%Y-%m-%dT%H:%M:%S",
        },
        "plain": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        },
    },
    "handlers": {
        "stdout": {
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
            "formatter": "json",
        },
    },
    "root": {
        "level": settings.log_level.upper(),
        "handlers": ["stdout"],
    },
})

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    # Validate config and warn about insecure defaults
    settings.validate_production()

    # Create DB tables (idempotent — Alembic handles migrations)
    create_db_tables()

    # One-time data fix: replace section-header strings stored as candidate names
    fix_section_header_candidate_names()

    # Ensure admin user is seeded and synced with current env credentials
    try:
        from app.database import ensure_admin_user
        ensure_admin_user()
    except Exception as exc:
        logger.error("Lifespan admin seeding failed: %s", exc)

    # Pre-warm spaCy model
    try:
        from app.services.confidence import _get_nlp
        _get_nlp()
    except Exception:
        pass

    # Pre-warm embedding model in a background thread if enabled and not on Render.
    # SentenceTransformer consumes significant RAM (200MB+ PyTorch + 90MB model)
    # which easily triggers Out-Of-Memory (OOM) kills on Render's 512MB free tier.
    if os.environ.get("PREWARM_EMBEDDING", "true").lower() == "true" and not os.environ.get("RENDER"):
        import threading

        def _warm_embedder() -> None:
            try:
                from app.services.embedder import embedder
                embedder.load(settings.embedding_model)
                logger.info("Embedding model '%s' ready", settings.embedding_model)
            except Exception as exc:
                logger.warning("Embedding model pre-warm failed (will lazy-load on first use): %s", exc)

        threading.Thread(target=_warm_embedder, daemon=True, name="embedder-warmup").start()
    else:
        logger.info("Embedding model pre-warming skipped to conserve memory")

    os.makedirs(settings.upload_dir, exist_ok=True)

    # Start IMAP ingestion worker (reads credentials from DB on each poll)
    from app.services.email_ingestion import start_email_ingestion_worker, stop_email_ingestion_worker
    start_email_ingestion_worker(poll_interval=settings.imap_poll_interval)

    # Start Microsoft Graph API ingestion worker (reads credentials from DB on each poll)
    from app.services.graph_ingestion import start_graph_ingestion_worker, stop_graph_ingestion_worker
    start_graph_ingestion_worker(poll_interval=settings.imap_poll_interval)

    logger.info("Application startup complete")
    yield

    stop_email_ingestion_worker()
    stop_graph_ingestion_worker()
    logger.info("Application shutdown complete")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="TekTalentScan API",
    version="1.0.0",
    description="AI-powered resume evaluation backend",
    lifespan=lifespan,
    # Disable docs in production by checking an env var
    docs_url="/docs" if os.getenv("ENABLE_DOCS", "true").lower() == "true" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)
app.add_middleware(RateLimitMiddleware)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(admin.router)
app.include_router(audit.router)
app.include_router(auth.router)
app.include_router(candidates.router)
app.include_router(comments.router)
app.include_router(interview_feedback.router)
app.include_router(upload.router)
app.include_router(analytics.router)
app.include_router(skills.router)
app.include_router(job_roles.router)
app.include_router(evaluate.router)
app.include_router(results.router)
app.include_router(shortlist.router)
app.include_router(enrichment.router)
app.include_router(inbound_emails.router)
app.include_router(manual_eval.router)
app.include_router(sharepoint.router)
app.include_router(onedrive.router)

# Serve uploaded files directly (fallback when nginx not in front)
os.makedirs(settings.upload_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


# ---------------------------------------------------------------------------
# Health / readiness probes
# ---------------------------------------------------------------------------

@app.get("/health", tags=["ops"], include_in_schema=False)
def health_check() -> dict:
    """Liveness probe — returns 200 as long as the process is alive."""
    return {"status": "ok"}


@app.get("/ready", tags=["ops"], include_in_schema=False)
def readiness_check() -> dict:
    """Readiness probe — verifies DB connectivity before accepting traffic."""
    from app.database import SessionLocal
    try:
        db = SessionLocal()
        db.execute(__import__("sqlalchemy").text("SELECT 1"))
        db.close()
    except Exception as exc:
        logger.error("Readiness check failed: %s", exc)
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Database not ready") from exc
    return {"status": "ready"}


# ---------------------------------------------------------------------------
# Email open tracking pixel
# ---------------------------------------------------------------------------

@app.get("/track/open/{token}", tags=["tracking"], include_in_schema=False)
def track_email_open(token: str):
    """Record the first time a candidate opens their shortlist email.

    Returns a 1×1 transparent GIF so the browser/email client has something
    to load without showing an error.
    """
    from fastapi.responses import Response
    from app.database import SessionLocal
    from app.models import Evaluation, _utcnow

    try:
        db = SessionLocal()
        ev = db.query(Evaluation).filter(Evaluation.email_tracking_token == token).first()
        if ev and ev.email_opened_at is None:
            ev.email_opened_at = _utcnow()
            db.commit()
            logger.info("Email opened: evaluation_id=%s", ev.id)
        db.close()
    except Exception as exc:
        logger.warning("Email open tracking failed for token %s: %s", token, exc)

    # 1×1 transparent GIF
    gif = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
    return Response(content=gif, media_type="image/gif",
                    headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

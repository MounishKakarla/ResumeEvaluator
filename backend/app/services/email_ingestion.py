"""Email Ingestion Pipeline (Prompt 2.1).

Monitors a dedicated IMAP inbox for incoming emails with resume attachments.
On each new email:
 1. Extracts attached PDF/DOCX resume files.
 2. Saves attachments to the uploads directory.
 3. Creates an InboundEmail record in the database.
 4. Triggers the resume upload pipeline (parse + segment + dedup + persist).
 5. Extracts external links (LinkedIn, GitHub, portfolio) from the email body and
    resume text and stores them on the candidate record.

Run as a background thread via start_email_ingestion_worker() called from main.py.
"""

from __future__ import annotations

import email
import email.policy
import imaplib
import json
import logging
import os
import re
import threading
import uuid
from datetime import datetime
from email.message import Message
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Regex patterns for external link extraction
# ---------------------------------------------------------------------------

_LINKEDIN_RE = re.compile(
    r'https?://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9\-_%]+/?', re.IGNORECASE
)
_GITHUB_RE = re.compile(
    r'https?://(?:www\.)?github\.com/[a-zA-Z0-9\-_%]+(?:/[^\s"\'<>]*)?', re.IGNORECASE
)
_PORTFOLIO_RE = re.compile(
    r'https?://(?!(?:www\.)?(?:linkedin|github)\.com)[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:/[^\s"\'<>]*)?',
    re.IGNORECASE,
)

# Allowed resume MIME types
_RESUME_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/octet-stream",  # some mail clients send with generic type
}
_RESUME_EXTENSIONS = {".pdf", ".docx", ".doc"}


# ---------------------------------------------------------------------------
# Link extraction helpers
# ---------------------------------------------------------------------------

def extract_external_links(text: str) -> dict:
    """Return the first LinkedIn, GitHub, and portfolio URL found in text."""
    linkedin = (_LINKEDIN_RE.search(text) or None)
    github = (_GITHUB_RE.search(text) or None)
    portfolio = (_PORTFOLIO_RE.search(text) or None)
    return {
        "linkedin_url": linkedin.group(0) if linkedin else None,
        "github_url": github.group(0) if github else None,
        "portfolio_url": portfolio.group(0) if portfolio else None,
    }


def _parse_job_id_from_subject(subject: str) -> Optional[int]:
    """Extract a job_id from email subject like '[JOB-42]' or 'Application for JOB-42'."""
    match = re.search(r'(?:job[_\-\s]?id[_\-\s]?[:=]?\s*|JOB[-\s]?)(\d+)', subject, re.IGNORECASE)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass
    return None


# ---------------------------------------------------------------------------
# IMAP connection + message fetching
# ---------------------------------------------------------------------------

def _connect_imap(host: str, port: int, username: str, password: str, use_ssl: bool = True) -> imaplib.IMAP4:
    """Open an IMAP connection and authenticate.

    For Office 365 use:
      host=outlook.office365.com, port=993, use_ssl=True  (IMAP over SSL/TLS)
    """
    if use_ssl:
        conn = imaplib.IMAP4_SSL(host, port)
    else:
        conn = imaplib.IMAP4(host, port)
    conn.login(username, password)
    return conn


def _subject_passes_filter(subject: str, keywords: list[str]) -> bool:
    """Return True if subject contains at least one keyword (case-insensitive).

    If no keywords are configured, every email passes.
    """
    if not keywords:
        return True
    subject_lower = subject.lower()
    return any(kw.lower() in subject_lower for kw in keywords)


def _fetch_unseen_message_ids(
    conn: imaplib.IMAP4,
    folder: str = "INBOX",
    subject_keywords: Optional[list[str]] = None,
) -> list[bytes]:
    """Return IMAP sequence numbers for unread, application-like emails.

    Strategy:
    1. SELECT the configured folder (default INBOX).
    2. Search for UNSEEN messages.
    3. For each candidate, fetch Subject header only (cheap BODY.PEEK).
    4. Discard messages whose subject doesn't match any configured keyword.

    This avoids downloading full message bodies for unrelated emails (newsletters,
    meeting invites, etc.) while still marking them as processed only when we
    actually handle them.
    """
    try:
        conn.select(folder)
    except imaplib.IMAP4.error:
        logger.warning("IMAP folder %r not found, falling back to INBOX", folder)
        conn.select("INBOX")

    _, data = conn.search(None, "UNSEEN")
    if not data or not data[0]:
        return []

    all_ids: list[bytes] = data[0].split()
    if not subject_keywords:
        return all_ids

    # Filter: fetch only the Subject header to minimise bandwidth
    accepted: list[bytes] = []
    for mid in all_ids:
        try:
            mid_str = mid.decode("ascii") if isinstance(mid, bytes) else mid
            _, hdr_data = conn.fetch(mid_str, "(BODY.PEEK[HEADER.FIELDS (SUBJECT)])")
            if not hdr_data or not hdr_data[0]:
                accepted.append(mid)   # can't read header — include it to be safe
                continue
            raw_hdr = hdr_data[0][1] if isinstance(hdr_data[0], tuple) else b""
            subject_line = ""
            for line in raw_hdr.decode("utf-8", errors="replace").splitlines():
                if line.lower().startswith("subject:"):
                    subject_line = line[8:].strip()
                    break
            if _subject_passes_filter(subject_line, subject_keywords):
                accepted.append(mid)
            else:
                logger.debug(
                    "Skipping email (subject doesn't match keywords): %r", subject_line
                )
        except Exception:
            accepted.append(mid)   # on error, include to avoid silent drops

    return accepted


def _fetch_message(conn: imaplib.IMAP4, msg_id: bytes) -> Optional[Message]:
    """Fetch and parse a single email message by its IMAP sequence number."""
    mid_str = msg_id.decode("ascii") if isinstance(msg_id, bytes) else msg_id
    _, msg_data = conn.fetch(mid_str, "(RFC822)")
    if not msg_data or not msg_data[0]:
        return None
    raw_email = msg_data[0][1]
    if not isinstance(raw_email, bytes):
        return None
    return email.message_from_bytes(raw_email, policy=email.policy.default)


# ---------------------------------------------------------------------------
# Attachment extraction
# ---------------------------------------------------------------------------

def _save_attachments(msg: Message, upload_dir: str) -> list[tuple[str, str]]:
    """Save resume attachments to disk. Returns list of (file_path, filename) tuples."""
    saved: list[tuple[str, str]] = []
    os.makedirs(upload_dir, exist_ok=True)

    for part in msg.walk():
        content_disposition = part.get_content_disposition() or ""
        if "attachment" not in content_disposition and "inline" not in content_disposition:
            continue

        filename = part.get_filename() or ""
        ext = os.path.splitext(filename)[1].lower()
        content_type = part.get_content_type() or ""

        is_resume = (
            ext in _RESUME_EXTENSIONS
            or content_type in _RESUME_MIME_TYPES
        )
        if not is_resume:
            continue

        payload = part.get_payload(decode=True)
        if not payload:
            continue

        # Use original extension if known, else .pdf as fallback
        safe_ext = ext if ext in _RESUME_EXTENSIONS else ".pdf"
        safe_name = f"{uuid.uuid4()}{safe_ext}"
        file_path = os.path.join(upload_dir, safe_name)
        with open(file_path, "wb") as f:
            f.write(payload)

        saved.append((file_path, filename or safe_name))

    return saved


# ---------------------------------------------------------------------------
# Per-message processing
# ---------------------------------------------------------------------------

def _process_message(msg: Message, upload_dir: str, db_session_factory) -> None:
    """Process a single inbound email: save attachments, parse resumes, store links."""
    from app.models import InboundEmail
    from app.routers.upload import _process_resume
    from app.services.parser import NeedsOCRError

    message_id = str(msg.get("Message-ID", "") or uuid.uuid4())
    sender = str(msg.get("From", "") or "")
    subject = str(msg.get("Subject", "") or "")
    sender_email_match = re.search(r'[\w._%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}', sender)
    sender_email = sender_email_match.group(0).lower() if sender_email_match else None

    # Extract plain text body for link scanning
    body_text = ""
    for part in msg.walk():
        if part.get_content_type() == "text/plain":
            try:
                body_text += part.get_payload(decode=True).decode("utf-8", errors="replace")
            except Exception:
                pass

    job_id = _parse_job_id_from_subject(subject)
    body_links = extract_external_links(body_text)

    db = db_session_factory()
    try:
        # Deduplicate by message_id; allow retry if status was reset to "new"
        _IMAP_RETRYABLE = {"failed", "keyword_filtered", "new"}
        existing = db.query(InboundEmail).filter(InboundEmail.message_id == message_id).first()
        if existing:
            if existing.status not in _IMAP_RETRYABLE:
                return
            # Delete stale record so it is re-processed cleanly
            db.delete(existing)
            db.commit()

        attachments = _save_attachments(msg, upload_dir)

        inbound = InboundEmail(
            message_id=message_id,
            sender_email=sender_email,
            subject=subject,
            received_at=datetime.utcnow(),
            job_id=job_id,
            status="new" if attachments else "no_attachment",
            raw_file_paths=json.dumps([fp for fp, _ in attachments]),
        )
        db.add(inbound)
        db.commit()
        db.refresh(inbound)

        if not attachments:
            return

        stored_count = 0
        for file_path, filename in attachments:
            try:
                result = _process_resume(
                    file_path=file_path,
                    filename=filename,
                    candidate_name="",
                    candidate_email=sender_email,
                    db=db,
                    source="email",
                )
                stored_count += 1
                # Merge body links onto candidate
                from app.models import Candidate
                candidate = db.query(Candidate).filter(Candidate.id == result.candidate_id).first()
                if candidate:
                    if body_links["linkedin_url"] and not candidate.linkedin_url:
                        candidate.linkedin_url = body_links["linkedin_url"]
                    if body_links["github_url"] and not candidate.github_url:
                        candidate.github_url = body_links["github_url"]
                    if body_links["portfolio_url"] and not candidate.portfolio_url:
                        candidate.portfolio_url = body_links["portfolio_url"]
                    db.commit()

            except NeedsOCRError as exc:
                logger.warning("Resume needs OCR, skipping: %s — %s", filename, exc)
                if os.path.exists(file_path):
                    os.remove(file_path)
            except Exception as exc:
                logger.error("Failed to process attachment %s: %s", filename, exc, exc_info=True)
                if os.path.exists(file_path):
                    os.remove(file_path)

        inbound.status = "processed" if stored_count > 0 else "failed"
        if stored_count == 0:
            inbound.error_message = "All attachments failed to parse — check logs for details"
        db.commit()

    except Exception as exc:
        logger.error("Error processing inbound email %s: %s", message_id, exc)
        try:
            inbound = db.query(InboundEmail).filter(InboundEmail.message_id == message_id).first()
            if inbound:
                inbound.status = "failed"
                inbound.error_message = str(exc)[:500]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Background worker
# ---------------------------------------------------------------------------

_worker_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()


def _get_imap_config(db_session_factory) -> Optional[dict]:
    """Return IMAP config dict from DB (priority) or env vars.

    Returns None if unconfigured, disabled, or if Graph API method is selected.
    """
    from app.config import settings

    # Start with env-var defaults; also read method + graph credentials from DB
    host = settings.imap_host or ""
    port = settings.imap_port
    username = settings.imap_username or ""
    password = settings.imap_password or ""
    use_ssl = settings.imap_ssl
    folder = settings.imap_folder or "INBOX"
    keywords = settings.imap_subject_keywords or ""
    method = "auto"
    graph_configured = False

    try:
        db = db_session_factory()
        try:
            from app.models import SystemSetting
            rows = {r.key: r.value for r in db.query(SystemSetting).all()}
            method = rows.get("email_ingestion_method") or "auto"
            graph_configured = bool(
                rows.get("graph_client_id")
                and rows.get("graph_tenant_id")
                and rows.get("graph_client_secret")
                and rows.get("graph_mailbox")
            )
            host = rows.get("imap_host") or host
            port = int(rows.get("imap_port") or port)
            username = rows.get("imap_username") or username
            password = rows.get("imap_password") or password
            if "imap_ssl" in rows and rows["imap_ssl"]:
                use_ssl = rows["imap_ssl"].lower() == "true"
            folder = rows.get("imap_folder") or folder
            if "imap_subject_keywords" in rows:
                keywords = rows["imap_subject_keywords"] or ""
        finally:
            db.close()
    except Exception as exc:
        logger.debug("Could not read IMAP config from DB: %s", exc)

    # Respect selected method
    if method == "disabled" or method == "graph":
        return None
    # auto: Graph takes priority when its credentials are present
    if method == "auto" and graph_configured:
        return None

    if not host or not username or not password:
        return None

    kw_list = [k.strip() for k in keywords.split(",") if k.strip()] if keywords else []
    return {
        "host": host,
        "port": port,
        "username": username,
        "password": password,
        "use_ssl": use_ssl,
        "folder": folder,
        "subject_keywords": kw_list,
    }


def _process_message_with_retry(
    msg, upload_dir: str, db_session_factory, max_retries: int = 3
) -> None:
    """Process a single message with exponential backoff retry on transient failures."""
    import time
    delay = 2.0
    for attempt in range(max_retries):
        try:
            _process_message(msg, upload_dir, db_session_factory)
            return
        except Exception as exc:
            if attempt == max_retries - 1:
                logger.error(
                    "Failed to process message after %d attempts: %s", max_retries, exc
                )
                return
            logger.warning(
                "Message processing attempt %d/%d failed (%s), retrying in %.0fs…",
                attempt + 1, max_retries, exc, delay,
            )
            time.sleep(delay)
            delay = min(delay * 2, 30)


def _ingestion_loop(upload_dir: str, poll_interval: int, db_session_factory) -> None:
    """Continuously poll the IMAP inbox and process new emails.

    Reads IMAP config from DB on every cycle so credential changes take effect
    without a server restart.
    """
    logger.info("Email ingestion worker started (poll_interval=%ds)", poll_interval)
    while not _stop_event.is_set():
        try:
            cfg = _get_imap_config(db_session_factory)
            if cfg:
                logger.debug(
                    "IMAP poll: host=%s user=%s folder=%r",
                    cfg["host"], cfg["username"], cfg["folder"],
                )
                conn = _connect_imap(cfg["host"], cfg["port"], cfg["username"], cfg["password"], cfg["use_ssl"])
                msg_ids = _fetch_unseen_message_ids(conn, folder=cfg["folder"], subject_keywords=cfg["subject_keywords"])
                logger.debug("Found %d candidate email(s) to process", len(msg_ids))
                for mid in msg_ids:
                    if _stop_event.is_set():
                        break
                    msg = _fetch_message(conn, mid)
                    if msg:
                        _process_message_with_retry(msg, upload_dir, db_session_factory)
                    mid_str = mid.decode("ascii") if isinstance(mid, bytes) else mid
                    conn.store(mid_str, "+FLAGS", "\\Seen")
                conn.logout()
            else:
                logger.debug("IMAP not configured, skipping poll")
        except imaplib.IMAP4.error as exc:
            logger.error("IMAP error: %s", exc)
        except OSError as exc:
            logger.error("IMAP network error: %s", exc)
        except Exception as exc:
            logger.error("Ingestion loop error: %s", exc, exc_info=True)

        _stop_event.wait(timeout=poll_interval)


def start_email_ingestion_worker(poll_interval: int = 0) -> None:
    """Start the IMAP ingestion worker in a daemon thread.

    The worker reads IMAP credentials from the DB (or env vars as fallback) on every
    poll cycle, so credentials saved via the admin UI take effect without restart.

    Office 365:  IMAP_HOST=outlook.office365.com  IMAP_PORT=993  IMAP_SSL=true
    Gmail:       IMAP_HOST=imap.gmail.com          IMAP_PORT=993  IMAP_SSL=true
    """
    from app.config import settings
    from app.database import SessionLocal

    if poll_interval <= 0:
        poll_interval = int(getattr(settings, "imap_poll_interval", 60))

    global _worker_thread
    if _worker_thread and _worker_thread.is_alive():
        logger.info("IMAP ingestion worker already running")
        return

    _stop_event.clear()
    _worker_thread = threading.Thread(
        target=_ingestion_loop,
        args=(settings.upload_dir, poll_interval, SessionLocal),
        daemon=True,
        name="email-ingestion",
    )
    _worker_thread.start()
    logger.info("Email ingestion worker thread started")


def stop_email_ingestion_worker() -> None:
    """Signal the ingestion worker to stop."""
    _stop_event.set()
    if _worker_thread and _worker_thread.is_alive():
        _worker_thread.join(timeout=10)

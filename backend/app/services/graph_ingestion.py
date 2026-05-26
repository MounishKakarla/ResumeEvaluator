"""Microsoft Graph API Email Ingestion.

Modern alternative to IMAP — uses OAuth2 app-only auth (client credentials
flow) to read emails from a Microsoft 365 mailbox.  No username/password or
Basic-Auth required.

Prerequisites (one-time Azure setup):
  1. Register an app in Azure AD (portal.azure.com → App registrations)
  2. Add API permission: Microsoft Graph → Application → Mail.Read
  3. Grant admin consent for the permission
  4. Create a client secret under Certificates & Secrets
  5. Save Client ID, Tenant ID, and Client Secret in the admin settings panel
"""

from __future__ import annotations

import base64
import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_RESUME_EXTENSIONS = {".pdf", ".docx", ".doc"}

_worker_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()       # manual trigger stop signal only
_poll_stop_event = threading.Event()  # periodic loop stop (graceful app shutdown only)


# ---------------------------------------------------------------------------
# Config loader
# ---------------------------------------------------------------------------

def _get_graph_config(db_session_factory) -> Optional[dict]:
    """Return Graph API config from DB. Returns None if not fully configured or not selected."""
    client_id = tenant_id = client_secret = mailbox = ""
    folder = "Inbox"
    keywords = ""
    method = "auto"
    fetch_from_date = ""
    fetch_to_date = ""

    try:
        db = db_session_factory()
        try:
            from app.models import SystemSetting
            rows = {r.key: r.value for r in db.query(SystemSetting).all()}
            method = rows.get("email_ingestion_method") or "auto"
            client_id = rows.get("graph_client_id") or ""
            tenant_id = rows.get("graph_tenant_id") or ""
            client_secret = rows.get("graph_client_secret") or ""
            mailbox = rows.get("graph_mailbox") or ""
            folder = rows.get("graph_folder") or "Inbox"
            keywords = rows.get("graph_subject_keywords") or ""
            fetch_from_date = rows.get("graph_fetch_from_date") or ""
            fetch_to_date = rows.get("graph_fetch_to_date") or ""
            tz_offset_minutes = int(rows.get("graph_tz_offset_minutes") or "0")
        finally:
            db.close()
    except Exception as exc:
        logger.debug("Could not read Graph config from DB: %s", exc)

    # Respect the selected ingestion method
    if method == "disabled" or method == "imap":
        return None

    if not client_id or not tenant_id or not client_secret or not mailbox:
        return None

    kw_list = [k.strip() for k in keywords.split(",") if k.strip()] if keywords else []
    return {
        "client_id": client_id,
        "tenant_id": tenant_id,
        "client_secret": client_secret,
        "mailbox": mailbox,
        "folder": folder,
        "subject_keywords": kw_list,
        "fetch_from_date": fetch_from_date,
        "fetch_to_date": fetch_to_date,
        "tz_offset_minutes": tz_offset_minutes,
    }


# ---------------------------------------------------------------------------
# Graph API helpers
# ---------------------------------------------------------------------------

def _acquire_token(client_id: str, tenant_id: str, client_secret: str) -> str:
    try:
        import msal
    except ImportError:
        raise RuntimeError("msal package not installed. Run: pip install msal")

    app = msal.ConfidentialClientApplication(
        client_id,
        authority=f"https://login.microsoftonline.com/{tenant_id}",
        client_credential=client_secret,
    )
    result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    if "access_token" not in result:
        error = result.get("error_description") or result.get("error") or "Unknown error"
        raise RuntimeError(f"Failed to acquire token: {error}")
    return result["access_token"]


def _graph_get(token: str, url: str, params: Optional[dict] = None) -> dict:
    import requests
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
        params=params,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


# Well-known folder names the Graph API accepts directly in the URL path.
_WELL_KNOWN_FOLDERS = {
    "inbox", "sentitems", "deleteditems", "drafts", "junkemail",
    "outbox", "archive", "clutter", "conversationhistory",
    "msgfolderroot", "recoverableitemsdeletions", "searchfolders",
}


def _resolve_folder_id(token: str, mailbox: str, folder_name: str) -> str:
    """Resolve a folder display name to its Graph folder ID.

    The mailFolders URL path only accepts well-known names (e.g. 'Inbox') or
    GUIDs. Custom folder names like 'AI Product Engg Intern July 26' must be
    resolved to their ID first via the mailFolders list endpoint.

    Searches root-level folders first, then one level of child folders so
    sub-folders of Inbox (a common pattern) are also found.
    """
    if folder_name.lower() in _WELL_KNOWN_FOLDERS:
        return folder_name

    import requests
    headers = {"Authorization": f"Bearer {token}"}
    root_url = f"https://graph.microsoft.com/v1.0/users/{mailbox}/mailFolders"

    def _search(list_url: str) -> Optional[str]:
        next_u: Optional[str] = list_url
        params: Optional[dict] = {"$top": "100", "$select": "id,displayName,childFolderCount"}
        while next_u:
            resp = requests.get(next_u, headers=headers, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            for f in data.get("value", []):
                if f["displayName"].lower() == folder_name.lower():
                    return f["id"]
            next_u = data.get("@odata.nextLink")
            params = None
        return None

    # 1. Check root-level folders
    folder_id = _search(root_url)
    if folder_id:
        logger.debug("Resolved folder '%s' to ID %s (root level)", folder_name, folder_id)
        return folder_id

    # 2. Check one level of child folders (e.g. sub-folders inside Inbox)
    resp = requests.get(
        root_url, headers=headers,
        params={"$top": "100", "$select": "id,displayName,childFolderCount"},
        timeout=30,
    )
    resp.raise_for_status()
    for parent in resp.json().get("value", []):
        if parent.get("childFolderCount", 0) > 0:
            child_url = f"{root_url}/{parent['id']}/childFolders"
            folder_id = _search(child_url)
            if folder_id:
                logger.debug(
                    "Resolved folder '%s' to ID %s (child of '%s')",
                    folder_name, folder_id, parent["displayName"],
                )
                return folder_id

    raise ValueError(
        f"Mail folder '{folder_name}' not found in mailbox {mailbox}. "
        "Check the folder name in admin settings (it must match exactly)."
    )


def _local_date_to_utc(date_str: str, end_of_day: bool, tz_offset_minutes: int) -> str:
    """Convert a YYYY-MM-DD local date to a UTC ISO datetime string.

    tz_offset_minutes is the JS getTimezoneOffset() value: UTC − local in minutes.
    e.g. IST (UTC+5:30) → tz_offset_minutes = -330
    """
    from datetime import datetime, timedelta
    if end_of_day:
        local_dt = datetime.strptime(date_str, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    else:
        local_dt = datetime.strptime(date_str, "%Y-%m-%d")
    utc_dt = local_dt + timedelta(minutes=tz_offset_minutes)
    return utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _get_messages_with_attachments(
    token: str,
    mailbox: str,
    folder: str,
    from_date: str = "",
    to_date: str = "",
    tz_offset_minutes: int = 0,
) -> list[dict]:
    """Fetch messages that have attachments, with optional date-range filter.

    Does NOT filter by subject keywords here — keyword filtering is applied per-message
    inside _process_graph_message so that keyword-skipped emails are still recorded
    in the InboundEmail log (status='keyword_filtered') and the user can see them.

    Graph API constraint: $filter and $orderby must operate on the same property.
    When date params are supplied the OData filter uses only receivedDateTime so
    $orderby=receivedDateTime desc is legal; hasAttachments is filtered client-side.
    Without date params $filter uses hasAttachments eq true (no $orderby needed).
    Follows @odata.nextLink to retrieve all matching pages.
    """
    # Resolve display name → folder ID (required for any non-well-known folder name)
    resolved_folder = _resolve_folder_id(token, mailbox, folder)

    date_filter_parts = []
    if from_date:
        utc_from = _local_date_to_utc(from_date, end_of_day=False, tz_offset_minutes=tz_offset_minutes)
        date_filter_parts.append(f"receivedDateTime ge {utc_from}")
    if to_date:
        utc_to = _local_date_to_utc(to_date, end_of_day=True, tz_offset_minutes=tz_offset_minutes)
        date_filter_parts.append(f"receivedDateTime le {utc_to}")

    if date_filter_parts:
        # Date-range path: OData can't combine receivedDateTime $orderby with
        # hasAttachments $filter on all Graph tenants — filter client-side.
        odata_filter = " and ".join(date_filter_parts)
        query_params: dict = {
            "$filter": odata_filter,
            "$select": "id,subject,from,receivedDateTime,body,bodyPreview,hasAttachments",
            "$top": "100",
            "$orderby": "receivedDateTime desc",
        }
    else:
        # Do NOT filter by isRead — emails opened in Outlook before the poller
        # runs would be silently skipped forever. Dedup is handled by the
        # InboundEmail table (keyed on message_id) inside _process_graph_message.
        query_params = {
            "$filter": "hasAttachments eq true",
            "$select": "id,subject,from,receivedDateTime,body,bodyPreview,hasAttachments",
            "$top": "100",
        }

    base_url = f"https://graph.microsoft.com/v1.0/users/{mailbox}/mailFolders/{resolved_folder}/messages"
    next_url: Optional[str] = base_url
    page_params: Optional[dict] = query_params
    messages: list[dict] = []
    while next_url:
        data = _graph_get(token, next_url, params=page_params)
        messages.extend(data.get("value", []))
        next_url = data.get("@odata.nextLink")
        page_params = None  # nextLink already encodes all query params

    # Date-range path: hasAttachments was not in the OData filter, check client-side.
    if date_filter_parts:
        messages = [m for m in messages if m.get("hasAttachments")]

    return messages


# Keep old name as alias for any external callers
_get_unread_messages = _get_messages_with_attachments


def _get_attachments(token: str, mailbox: str, message_id: str) -> list[dict]:
    url = f"https://graph.microsoft.com/v1.0/users/{mailbox}/messages/{message_id}/attachments"
    data = _graph_get(token, url)
    return data.get("value", [])


def _mark_as_read(token: str, mailbox: str, message_id: str) -> None:
    import requests
    requests.patch(
        f"https://graph.microsoft.com/v1.0/users/{mailbox}/messages/{message_id}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"isRead": True},
        timeout=15,
    )


# ---------------------------------------------------------------------------
# Per-message processing (mirrors IMAP pipeline)
# ---------------------------------------------------------------------------

_RETRYABLE_STATUSES = {"failed", "keyword_filtered", "new"}


def _process_graph_message(
    msg: dict, token: str, mailbox: str, upload_dir: str,
    db_session_factory, subject_keywords: Optional[list] = None,
) -> None:
    from app.models import InboundEmail
    from app.routers.upload import _process_resume
    from app.services.parser import NeedsOCRError
    from app.services.email_ingestion import _parse_job_id_from_subject, extract_external_links
    from sqlalchemy.exc import IntegrityError

    message_id = msg.get("id") or str(uuid.uuid4())
    subject = msg.get("subject") or ""
    sender_addr = (msg.get("from") or {}).get("emailAddress", {}).get("address", "").lower() or None
    body_text = (msg.get("body") or {}).get("content") or msg.get("bodyPreview") or ""
    body_links = extract_external_links(body_text)
    job_id = _parse_job_id_from_subject(subject)

    received_raw = msg.get("receivedDateTime") or datetime.now(timezone.utc).isoformat()
    try:
        received_at = datetime.fromisoformat(received_raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        received_at = datetime.now(timezone.utc).replace(tzinfo=None)

    db = db_session_factory()
    inbound = None
    try:
        existing = db.query(InboundEmail).filter(InboundEmail.message_id == message_id).first()
        if existing:
            if existing.status not in _RETRYABLE_STATUSES:
                logger.debug("Message %s already in DB (status=%s), skipping", message_id, existing.status)
                return
            # Delete stale record so it can be re-processed cleanly
            logger.info("Retrying message %s (previous status: %s)", message_id, existing.status)
            db.delete(existing)
            db.commit()

        # Keyword filter — log the email but don't process attachments if no keyword matches
        if subject_keywords and not any(kw.lower() in subject.lower() for kw in subject_keywords):
            kw_inbound = InboundEmail(
                message_id=message_id,
                sender_email=sender_addr,
                subject=subject,
                received_at=received_at,
                job_id=None,
                status="keyword_filtered",
                raw_file_paths="[]",
            )
            db.add(kw_inbound)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
            logger.debug("Message %s subject '%s' skipped by keyword filter", message_id, subject)
            return

        # Download and save resume attachments
        os.makedirs(upload_dir, exist_ok=True)
        saved_files: list[tuple[str, str]] = []
        try:
            raw_atts = _get_attachments(token, mailbox, message_id)
        except Exception as exc:
            logger.error("Could not fetch attachments for message %s: %s", message_id, exc)
            raw_atts = []

        for att in raw_atts:
            filename = att.get("name") or ""
            ext = os.path.splitext(filename)[1].lower()
            if ext not in _RESUME_EXTENSIONS:
                continue
            content_b64 = att.get("contentBytes") or ""
            if not content_b64:
                continue
            try:
                data = base64.b64decode(content_b64)
            except Exception:
                continue
            safe_name = f"{uuid.uuid4()}{ext}"
            fp = os.path.join(upload_dir, safe_name)
            with open(fp, "wb") as f:
                f.write(data)
            saved_files.append((fp, filename))

        inbound = InboundEmail(
            message_id=message_id,
            sender_email=sender_addr,
            subject=subject,
            received_at=received_at,
            job_id=job_id,
            status="new" if saved_files else "no_attachment",
            raw_file_paths=json.dumps([fp for fp, _ in saved_files]),
        )
        db.add(inbound)
        try:
            db.commit()
        except IntegrityError:
            # Another worker processed this message concurrently — clean up and skip
            db.rollback()
            for fp, _ in saved_files:
                if os.path.exists(fp):
                    os.remove(fp)
            logger.debug("Message %s handled by another worker, skipping", message_id)
            return
        db.refresh(inbound)

        if not saved_files:
            return

        stored_count = 0
        for file_path, filename in saved_files:
            try:
                result = _process_resume(
                    file_path=file_path,
                    filename=filename,
                    candidate_name="",
                    candidate_email=sender_addr,
                    db=db,
                    source="email",
                )
                stored_count += 1
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
                logger.warning("Resume needs OCR, skipping %s: %s", filename, exc)
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
        logger.error("Error processing Graph message %s: %s", message_id, exc)
        try:
            if inbound is None:
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

def _process_graph_message_with_retry(
    msg: dict, token: str, mailbox: str, upload_dir: str, db_session_factory,
    subject_keywords: Optional[list] = None, max_retries: int = 3,
) -> None:
    import time
    delay = 2.0
    for attempt in range(max_retries):
        try:
            _process_graph_message(msg, token, mailbox, upload_dir, db_session_factory, subject_keywords)
            return
        except Exception as exc:
            if attempt == max_retries - 1:
                logger.error("Failed to process Graph message after %d attempts: %s", max_retries, exc)
                return
            logger.warning(
                "Graph message attempt %d/%d failed (%s), retrying in %.0fs…",
                attempt + 1, max_retries, exc, delay,
            )
            time.sleep(delay)
            delay = min(delay * 2, 30)


def _graph_ingestion_loop(upload_dir: str, poll_interval: int, db_session_factory) -> None:
    logger.info("Graph API ingestion worker started (poll_interval=%ds)", poll_interval)
    while not _poll_stop_event.is_set():
        try:
            cfg = _get_graph_config(db_session_factory)
            if cfg:
                logger.info("Graph poll: mailbox=%s folder=%s", cfg["mailbox"], cfg["folder"])
                token = _acquire_token(cfg["client_id"], cfg["tenant_id"], cfg["client_secret"])
                messages = _get_messages_with_attachments(
                    token, cfg["mailbox"], cfg["folder"],
                    from_date=cfg.get("fetch_from_date", ""),
                    to_date=cfg.get("fetch_to_date", ""),
                    tz_offset_minutes=cfg.get("tz_offset_minutes", 0),
                )
                logger.info("Graph: found %d message(s) with attachments to process", len(messages))
                for msg in messages:
                    if _poll_stop_event.is_set():
                        break
                    _process_graph_message_with_retry(
                        msg, token, cfg["mailbox"], upload_dir, db_session_factory,
                        subject_keywords=cfg["subject_keywords"],
                    )
                    try:
                        _mark_as_read(token, cfg["mailbox"], msg["id"])
                    except Exception as exc:
                        logger.debug("Could not mark message %s as read: %s", msg.get("id"), exc)
            else:
                logger.info("Graph API ingestion: disabled or not configured, skipping poll")
        except Exception as exc:
            logger.error("Graph ingestion loop error: %s", exc)
        _poll_stop_event.wait(timeout=poll_interval)


def start_graph_ingestion_worker(poll_interval: int = 0) -> None:
    from app.config import settings
    from app.database import SessionLocal

    if poll_interval <= 0:
        poll_interval = int(getattr(settings, "imap_poll_interval", 60))

    global _worker_thread
    if _worker_thread and _worker_thread.is_alive():
        logger.info("Graph API ingestion worker already running")
        return

    _poll_stop_event.clear()
    _worker_thread = threading.Thread(
        target=_graph_ingestion_loop,
        args=(settings.upload_dir, poll_interval, SessionLocal),
        daemon=True,
        name="graph-ingestion",
    )
    _worker_thread.start()
    logger.info("Graph API ingestion worker thread started")


def stop_graph_ingestion_worker() -> None:
    _poll_stop_event.set()
    if _worker_thread and _worker_thread.is_alive():
        _worker_thread.join(timeout=10)

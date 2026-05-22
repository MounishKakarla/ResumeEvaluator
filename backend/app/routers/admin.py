import os
import secrets
import string
import tempfile
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.deps import get_current_user, get_db
from app.models import Candidate, EmailTemplate, User
from app.schemas import EmailTemplateOut, EmailTemplateUpdate
from app.services.email import send_password_reset_email, send_welcome_email

router = APIRouter(prefix="/admin", tags=["admin"])


class UserOut(BaseModel):
    id: int
    email: str
    role: str
    is_active: bool = True
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateUserRequest(BaseModel):
    email: str
    role: str = "recruiter"


def _gen_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _require_admin(current_user: User) -> None:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


@router.get("/users", response_model=List[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    return db.query(User).order_by(User.created_at.desc()).all()


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    req: CreateUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    if req.role not in ("admin", "recruiter"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="role must be 'admin' or 'recruiter'")
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with that email already exists")

    password = _gen_password()
    name = req.email.split("@")[0].replace(".", " ").title()
    user = User(
        email=req.email,
        hashed_password=get_password_hash(password),
        role=req.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    try:
        send_welcome_email(req.email, name, req.role, password)
    except Exception:
        pass  # Never block user creation due to email failure

    return user


@router.post("/users/{user_id}/reset-password", status_code=status.HTTP_200_OK)
def reset_user_password(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a new temporary password for a user and email it to them."""
    _require_admin(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    new_password = _gen_password()
    user.hashed_password = get_password_hash(new_password)
    db.commit()

    name = user.email.split("@")[0].replace(".", " ").title()
    try:
        send_password_reset_email(user.email, name, new_password)
    except Exception:
        pass  # Password is already reset; email failure is non-fatal

    return {"message": f"Password reset and email sent to {user.email}"}


@router.patch("/users/{user_id}/revoke", response_model=UserOut)
def revoke_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Toggle a user's active status. Revoked users cannot log in."""
    _require_admin(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot revoke your own account")
    user.is_active = not user.is_active
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Permanently delete a user account. Cannot delete yourself or the last admin."""
    _require_admin(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own account")
    if user.role == "admin":
        admin_count = db.query(User).filter(User.role == "admin").count()
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete the last admin account",
            )
    db.delete(user)
    db.commit()


@router.get("/system-status")
def system_status(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    """Return system configuration status flags (no secrets exposed)."""
    from app.config import settings
    from app.models import SystemSetting
    llm_configured = bool(settings.llm_api_key)
    llm_provider = "unknown"
    if llm_configured:
        url = settings.llm_base_url.lower()
        if "groq" in url:
            llm_provider = "groq"
        elif "openai" in url:
            llm_provider = "openai"
        elif "anthropic" in url:
            llm_provider = "anthropic"
        elif "together" in url:
            llm_provider = "together"
        elif "localhost" in url or "127.0.0.1" in url:
            llm_provider = "ollama"

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}
    imap_host = rows.get("imap_host") or settings.imap_host or ""
    imap_username = rows.get("imap_username") or settings.imap_username or ""
    imap_password = rows.get("imap_password") or settings.imap_password or ""

    return {
        "smtp_configured": bool(settings.smtp_server and settings.smtp_username and settings.smtp_from_email),
        "llm_configured": llm_configured,
        "llm_provider": llm_provider,
        "llm_model": settings.llm_model if llm_configured else None,
        "imap_configured": bool(imap_host and imap_username and imap_password),
        "imap_host": imap_host if imap_host else None,
    }


class ImapSettingsRequest(BaseModel):
    imap_host: str = ""
    imap_port: int = 993
    imap_username: str = ""
    imap_password: str = ""
    imap_ssl: bool = True
    imap_folder: str = "INBOX"
    imap_subject_keywords: str = ""


@router.get("/imap-settings")
def get_imap_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return current IMAP settings (password masked)."""
    _require_admin(current_user)
    from app.config import settings
    from app.models import SystemSetting

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}

    def _get(key: str, default: str) -> str:
        v = rows.get(key)
        return v if v is not None else default

    host = _get("imap_host", settings.imap_host or "")
    port_raw = _get("imap_port", str(settings.imap_port))
    username = _get("imap_username", settings.imap_username or "")
    has_password = bool(_get("imap_password", settings.imap_password or ""))
    ssl_raw = _get("imap_ssl", "true" if settings.imap_ssl else "false")
    folder = _get("imap_folder", settings.imap_folder or "INBOX")
    keywords = _get("imap_subject_keywords", settings.imap_subject_keywords or "")

    return {
        "imap_host": host,
        "imap_port": int(port_raw) if port_raw else 993,
        "imap_username": username,
        "imap_password_set": has_password,
        "imap_ssl": ssl_raw.lower() == "true",
        "imap_folder": folder,
        "imap_subject_keywords": keywords,
        "configured": bool(host and username and has_password),
    }


@router.post("/imap-settings")
def save_imap_settings(
    req: ImapSettingsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Save IMAP settings to the database. The ingestion worker picks them up on next poll."""
    _require_admin(current_user)
    from app.models import SystemSetting

    now = datetime.now(timezone.utc)

    def _upsert(key: str, value: str) -> None:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row:
            row.value = value
            row.updated_at = now
        else:
            db.add(SystemSetting(key=key, value=value, updated_at=now))

    _upsert("imap_host", req.imap_host.strip())
    _upsert("imap_port", str(req.imap_port))
    _upsert("imap_username", req.imap_username.strip())
    if req.imap_password:
        _upsert("imap_password", req.imap_password)
    _upsert("imap_ssl", "true" if req.imap_ssl else "false")
    _upsert("imap_folder", req.imap_folder.strip() or "INBOX")
    _upsert("imap_subject_keywords", req.imap_subject_keywords)
    db.commit()

    return {"message": "IMAP settings saved. The ingestion worker will use these on the next poll cycle."}


@router.post("/test-imap")
def test_imap_connection(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Test IMAP connectivity with the currently saved settings."""
    _require_admin(current_user)
    import imaplib as _imap
    from app.config import settings
    from app.models import SystemSetting

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}

    def _get(key: str, default: str) -> str:
        v = rows.get(key)
        return v if v is not None else default

    host = _get("imap_host", settings.imap_host or "")
    port_raw = _get("imap_port", str(settings.imap_port))
    username = _get("imap_username", settings.imap_username or "")
    password = _get("imap_password", settings.imap_password or "")
    ssl_raw = _get("imap_ssl", "true" if settings.imap_ssl else "false")
    use_ssl = ssl_raw.lower() == "true"

    if not host or not username or not password:
        return {"ok": False, "error": "IMAP host, username, or password not set. Save settings first."}

    port = int(port_raw) if port_raw else 993
    try:
        if use_ssl:
            conn = _imap.IMAP4_SSL(host, port)
        else:
            conn = _imap.IMAP4(host, port)
        conn.login(username, password)
        _, data = conn.select("INBOX")
        count = data[0].decode() if data and data[0] else "?"
        conn.logout()
        return {"ok": True, "message": f"Connected to {host}:{port} successfully. INBOX has {count} message(s)."}
    except _imap.IMAP4.error as exc:
        return {"ok": False, "error": f"Authentication failed: {exc}"}
    except OSError as exc:
        return {"ok": False, "error": f"Cannot reach {host}:{port} — {exc}"}
    except Exception as exc:
        return {"ok": False, "error": f"Connection error: {exc}"}


@router.post("/test-smtp")
def test_smtp_connection(
    current_user: User = Depends(get_current_user),
) -> dict:
    """Send a test email to the logged-in admin to verify SMTP settings."""
    _require_admin(current_user)
    import smtplib
    from email.mime.text import MIMEText
    from app.config import settings

    host = settings.smtp_server
    port = settings.smtp_port
    username = settings.smtp_username
    password = settings.smtp_password
    from_email = settings.smtp_from_email
    to_email = current_user.email

    if not host or not username or not from_email:
        return {"ok": False, "error": "SMTP_SERVER, SMTP_USERNAME, or SMTP_FROM_EMAIL is not configured."}

    msg = MIMEText("This is a test email from your ResumeEvals instance. If you received it, SMTP is configured correctly.")
    msg["Subject"] = "ResumeEvals — SMTP Test"
    msg["From"] = from_email
    msg["To"] = to_email

    try:
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            smtp.ehlo()
            if port != 465:
                smtp.starttls()
                smtp.ehlo()
            if username and password:
                smtp.login(username, password)
            smtp.sendmail(from_email, [to_email], msg.as_string())
        return {"ok": True, "message": f"Test email sent to {to_email} via {host}:{port}."}
    except smtplib.SMTPAuthenticationError as exc:
        return {"ok": False, "error": f"Authentication failed: {exc}"}
    except OSError as exc:
        return {"ok": False, "error": f"Cannot reach {host}:{port} — {exc}"}
    except Exception as exc:
        return {"ok": False, "error": f"SMTP error: {exc}"}


class GraphSettingsRequest(BaseModel):
    graph_client_id: str = ""
    graph_tenant_id: str = ""
    graph_client_secret: str = ""
    graph_mailbox: str = ""
    graph_folder: str = "Inbox"
    graph_subject_keywords: str = ""
    graph_fetch_from_date: str = ""
    graph_fetch_to_date: str = ""


@router.get("/graph-settings")
def get_graph_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return current Microsoft Graph API settings (secret masked)."""
    _require_admin(current_user)
    from app.models import SystemSetting

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}

    def _get(key: str, default: str = "") -> str:
        v = rows.get(key)
        return v if v is not None else default

    client_id = _get("graph_client_id")
    tenant_id = _get("graph_tenant_id")
    mailbox = _get("graph_mailbox")
    has_secret = bool(_get("graph_client_secret"))

    return {
        "graph_client_id": client_id,
        "graph_tenant_id": tenant_id,
        "graph_client_secret_set": has_secret,
        "graph_mailbox": mailbox,
        "graph_folder": _get("graph_folder", "Inbox"),
        "graph_subject_keywords": _get("graph_subject_keywords"),
        "graph_fetch_from_date": _get("graph_fetch_from_date"),
        "graph_fetch_to_date": _get("graph_fetch_to_date"),
        "configured": bool(client_id and tenant_id and has_secret and mailbox),
    }


@router.post("/graph-settings")
def save_graph_settings(
    req: GraphSettingsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Save Microsoft Graph API settings to the database."""
    _require_admin(current_user)
    from app.models import SystemSetting

    now = datetime.now(timezone.utc)

    def _upsert(key: str, value: str) -> None:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row:
            row.value = value
            row.updated_at = now
        else:
            db.add(SystemSetting(key=key, value=value, updated_at=now))

    _upsert("graph_client_id", req.graph_client_id.strip())
    _upsert("graph_tenant_id", req.graph_tenant_id.strip())
    _upsert("graph_mailbox", req.graph_mailbox.strip())
    _upsert("graph_folder", req.graph_folder.strip() or "Inbox")
    _upsert("graph_subject_keywords", req.graph_subject_keywords)
    _upsert("graph_fetch_from_date", req.graph_fetch_from_date.strip())
    _upsert("graph_fetch_to_date", req.graph_fetch_to_date.strip())
    if req.graph_client_secret:
        _upsert("graph_client_secret", req.graph_client_secret)
    db.commit()

    return {"message": "Graph API settings saved. The ingestion worker will use these on the next poll cycle."}


class TriggerFetchRequest(BaseModel):
    from_date: str = ""
    to_date: str = ""


@router.post("/trigger-graph-fetch")
def trigger_graph_fetch(
    req: Optional[TriggerFetchRequest] = Body(default=None),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Trigger an immediate Graph API email fetch in the background.

    Optional body fields ``from_date`` / ``to_date`` (YYYY-MM-DD) override the
    saved settings so the caller does not need to save first.
    """
    _require_admin(current_user)
    import threading
    from app.config import settings as _settings
    from app.database import SessionLocal
    from app.services.graph_ingestion import (
        _get_graph_config,
        _acquire_token,
        _get_messages_with_attachments,
        _process_graph_message_with_retry,
        _stop_event,
    )

    # Capture body values before thread starts (avoid closure over mutable state)
    body_from = req.from_date if req else ""
    body_to = req.to_date if req else ""

    def _run() -> None:
        _stop_event.clear()
        cfg = _get_graph_config(SessionLocal)
        if not cfg:
            return
        # Request body dates take priority over DB-saved dates
        from_date = body_from or cfg.get("fetch_from_date", "")
        to_date = body_to or cfg.get("fetch_to_date", "")
        try:
            token = _acquire_token(cfg["client_id"], cfg["tenant_id"], cfg["client_secret"])
            messages = _get_messages_with_attachments(
                token, cfg["mailbox"], cfg["folder"],
                from_date=from_date,
                to_date=to_date,
            )
            for msg in messages:
                if _stop_event.is_set():
                    import logging as _logging
                    _logging.getLogger(__name__).info("Manual Graph fetch stopped by user request.")
                    break
                _process_graph_message_with_retry(
                    msg, token, cfg["mailbox"], _settings.upload_dir, SessionLocal,
                    subject_keywords=cfg["subject_keywords"],
                )
        except Exception as exc:
            import logging as _logging
            _logging.getLogger(__name__).error("Manual Graph trigger error: %s", exc)

    threading.Thread(target=_run, daemon=True, name="graph-manual-trigger").start()
    return {"message": "Graph email fetch triggered in background. Check the email log in a moment."}


@router.post("/stop-graph-fetch")
def stop_graph_fetch(current_user: User = Depends(get_current_user)) -> dict:
    """Signal the currently running Graph fetch (manual or periodic) to stop after the current message."""
    _require_admin(current_user)
    from app.services.graph_ingestion import _stop_event
    _stop_event.set()
    return {"message": "Stop signal sent. The fetch will halt after the current email is processed."}


@router.post("/trigger-imap-fetch")
def trigger_imap_fetch(
    current_user: User = Depends(get_current_user),
) -> dict:
    """Trigger an immediate one-shot IMAP fetch in the background."""
    _require_admin(current_user)
    import threading
    from app.config import settings as _settings
    from app.database import SessionLocal
    from app.services.email_ingestion import (
        _get_imap_config,
        _connect_imap,
        _fetch_unseen_message_ids,
        _fetch_message,
        _process_message_with_retry,
        _stop_event as _imap_stop_event,
    )

    def _run() -> None:
        _imap_stop_event.clear()
        cfg = _get_imap_config(SessionLocal)
        if not cfg:
            return
        try:
            conn = _connect_imap(
                cfg["host"], cfg["port"], cfg["username"], cfg["password"], cfg["use_ssl"]
            )
            msg_ids = _fetch_unseen_message_ids(
                conn, folder=cfg["folder"], subject_keywords=cfg["subject_keywords"]
            )
            for mid in msg_ids:
                if _imap_stop_event.is_set():
                    import logging as _logging
                    _logging.getLogger(__name__).info("Manual IMAP fetch stopped by user request.")
                    break
                msg = _fetch_message(conn, mid)
                if msg:
                    _process_message_with_retry(msg, _settings.upload_dir, SessionLocal)
                mid_str = mid.decode("ascii") if isinstance(mid, bytes) else mid
                conn.store(mid_str, "+FLAGS", "\\Seen")
            conn.logout()
        except Exception as exc:
            import logging as _logging
            _logging.getLogger(__name__).error("Manual IMAP trigger error: %s", exc)

    threading.Thread(target=_run, daemon=True, name="imap-manual-trigger").start()
    return {"message": "IMAP fetch triggered in background. Check the email log in a moment."}


@router.post("/stop-imap-fetch")
def stop_imap_fetch(current_user: User = Depends(get_current_user)) -> dict:
    """Signal the currently running IMAP fetch (manual or periodic) to stop after the current message."""
    _require_admin(current_user)
    from app.services.email_ingestion import _stop_event as _imap_stop_event
    _imap_stop_event.set()
    return {"message": "Stop signal sent. The IMAP fetch will halt after the current email is processed."}


@router.post("/test-graph")
def test_graph_connection(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Test Microsoft Graph API connectivity with currently saved settings."""
    _require_admin(current_user)
    from app.models import SystemSetting

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}

    def _get(key: str) -> str:
        return rows.get(key) or ""

    client_id = _get("graph_client_id")
    tenant_id = _get("graph_tenant_id")
    client_secret = _get("graph_client_secret")
    mailbox = _get("graph_mailbox")
    folder = _get("graph_folder") or "Inbox"

    if not client_id or not tenant_id or not client_secret or not mailbox:
        return {"ok": False, "error": "Client ID, Tenant ID, Client Secret, and Mailbox are all required."}

    try:
        import msal, requests as _req
        app = msal.ConfidentialClientApplication(
            client_id,
            authority=f"https://login.microsoftonline.com/{tenant_id}",
            client_credential=client_secret,
        )
        result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
        if "access_token" not in result:
            error = result.get("error_description") or result.get("error") or "Unknown"
            return {"ok": False, "error": f"Token acquisition failed: {error}"}

        token = result["access_token"]
        url = f"https://graph.microsoft.com/v1.0/users/{mailbox}/mailFolders/{folder}/messages"
        resp = _req.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params={"$top": "1", "$select": "id"},
            timeout=15,
        )
        if resp.status_code == 404:
            return {"ok": False, "error": f"Mailbox or folder '{folder}' not found. Check the mailbox address and folder name."}
        resp.raise_for_status()
        return {"ok": True, "message": f"Connected successfully. Mailbox {mailbox} / folder {folder} is accessible."}
    except ImportError:
        return {"ok": False, "error": "msal package not installed on server. Run: pip install msal"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


_INGESTION_METHODS = {"disabled", "imap", "graph"}


@router.get("/email-ingestion-method")
def get_email_ingestion_method(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _require_admin(current_user)
    from app.models import SystemSetting
    rows = {r.key: r.value for r in db.query(SystemSetting).all()}
    return {"method": rows.get("email_ingestion_method") or "auto"}


class IngestionMethodRequest(BaseModel):
    method: str  # "disabled", "imap", "graph", or "auto"


@router.post("/email-ingestion-method")
def set_email_ingestion_method(
    req: IngestionMethodRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _require_admin(current_user)
    if req.method not in _INGESTION_METHODS and req.method != "auto":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="method must be one of: disabled, imap, graph, auto")
    from app.models import SystemSetting
    now = datetime.now(timezone.utc)
    existing = db.query(SystemSetting).filter(SystemSetting.key == "email_ingestion_method").first()
    if existing:
        existing.value = req.method
        existing.updated_at = now
    else:
        db.add(SystemSetting(key="email_ingestion_method", value=req.method, updated_at=now))
    db.commit()
    return {"method": req.method, "message": f"Email ingestion method set to '{req.method}'."}


_TEMPLATE_DEFAULTS: dict = {
    "next_steps": {
        "subject": "Your Application for {job_title} — Next Steps",
        "body_text": (
            "Hi {candidate_name},\n\n"
            "Congratulations! Your application for {job_title} has been shortlisted.\n\n"
            "Our hiring process consists of three stages:\n"
            "  1. Coding Assessment (~60–90 min online challenge)\n"
            "  2. Technical Interview (live session with the engineering team)\n"
            "  3. HR Interview (background, expectations, compensation)\n\n"
            "Our team will be in touch within 2–3 business days with further details.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        ),
    },
    "rejection": {
        "subject": "Your Application for {job_title} — Update",
        "body_text": (
            "Hi {candidate_name},\n\n"
            "Thank you for your interest in the {job_title} position and for taking the time to go through our process.\n\n"
            "After careful consideration, we have decided to move forward with other candidates whose profiles more closely match our current requirements.\n\n"
            "We appreciate your time and encourage you to apply for future opportunities.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        ),
    },
    "coding_invite": {
        "subject": "Coding Assessment Invite — {job_title}",
        "body_text": (
            "Hi {candidate_name},\n\n"
            "You have been invited to complete a coding assessment for the {job_title} role.\n\n"
            "Please complete it within 72 hours of receiving this email.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        ),
    },
    "interview_invite": {
        "subject": "Technical Interview Invitation — {job_title}",
        "body_text": (
            "Hi {candidate_name},\n\n"
            "We are pleased to invite you to a technical interview for the {job_title} role.\n\n"
            "Please confirm your availability by replying to this email.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        ),
    },
}

_TEMPLATE_LABELS: dict = {
    "next_steps": "Shortlist / Next Steps",
    "rejection": "Rejection",
    "coding_invite": "Coding Assessment Invite",
    "interview_invite": "Technical Interview Invite",
}


@router.get("/email-templates", response_model=List[EmailTemplateOut])
def list_email_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[EmailTemplateOut]:
    """Return all email templates, merging DB overrides with hardcoded defaults."""
    _require_admin(current_user)
    result = []
    for key, defaults in _TEMPLATE_DEFAULTS.items():
        tpl = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
        result.append(EmailTemplateOut(
            key=key,
            subject=tpl.subject if tpl else defaults["subject"],
            body_text=tpl.body_text if tpl else defaults["body_text"],
            updated_at=tpl.updated_at if tpl else None,
        ))
    return result


@router.put("/email-templates/{key}", response_model=EmailTemplateOut)
def update_email_template(
    key: str,
    req: EmailTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EmailTemplateOut:
    """Create or replace a template override. Use DELETE /reset to restore the default."""
    _require_admin(current_user)
    if key not in _TEMPLATE_DEFAULTS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown template key")
    tpl = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
    now = datetime.now(timezone.utc)
    if tpl:
        tpl.subject = req.subject
        tpl.body_text = req.body_text
        tpl.updated_at = now
    else:
        tpl = EmailTemplate(key=key, subject=req.subject, body_text=req.body_text, updated_at=now)
        db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return EmailTemplateOut(key=tpl.key, subject=tpl.subject, body_text=tpl.body_text, updated_at=tpl.updated_at)


@router.delete("/email-templates/{key}/reset", response_model=EmailTemplateOut)
def reset_email_template(
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EmailTemplateOut:
    """Delete any DB override, restoring the hardcoded default."""
    _require_admin(current_user)
    if key not in _TEMPLATE_DEFAULTS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown template key")
    db.query(EmailTemplate).filter(EmailTemplate.key == key).delete()
    db.commit()
    defaults = _TEMPLATE_DEFAULTS[key]
    return EmailTemplateOut(key=key, subject=defaults["subject"], body_text=defaults["body_text"], updated_at=None)


@router.post("/jd-extract")
async def extract_jd_text(
    file: UploadFile = File(...),
    _current_user: User = Depends(get_current_user),
):
    """Accept a PDF or DOCX job-description file and return its extracted plain text."""
    filename = file.filename or ""
    if filename.endswith(".pdf"):
        suffix = ".pdf"
    elif filename.endswith((".docx", ".doc")):
        suffix = ".docx"
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PDF and DOCX files are supported")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large (max 10 MB)")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        from app.services.parser import parse_document
        doc = parse_document(tmp_path)
        return {"text": doc.text, "page_count": doc.page_count}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@router.post("/reclassify-experience-levels")
def reclassify_experience_levels(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    """Reclassify all candidates experience_level using years_experience ranges.

    entry  = 0–1 yr | junior = 1–3 yrs | mid = 3–5 yrs | senior = 5–10 yrs | executive = 10+ yrs
    Candidates with no years_experience are reclassified via keyword inference on stored title.
    """
    from app.services.parser import infer_experience_level

    def _level_from_years(yrs: float) -> str:
        if yrs < 1:
            return "entry"
        if yrs < 3:
            return "junior"
        if yrs < 5:
            return "mid"
        if yrs < 10:
            return "senior"
        return "executive"

    candidates = db.query(Candidate).all()
    updated = 0
    for c in candidates:
        if c.years_experience is not None:
            new_level = _level_from_years(float(c.years_experience))
        else:
            # Fallback: infer from current title text only
            new_level = infer_experience_level(c.current_title or "")
        if c.experience_level != new_level:
            c.experience_level = new_level
            updated += 1
    db.commit()
    return {"updated": updated, "total": len(candidates)}

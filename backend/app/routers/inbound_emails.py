"""API for the email ingestion log."""
from __future__ import annotations

import json
import math
import os
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict
from datetime import datetime
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.config import settings
from app.deps import get_current_user, get_db
from app.models import InboundEmail, JobRole, User

router = APIRouter(prefix="/inbound-emails", tags=["inbound-emails"])


class InboundEmailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    message_id: str
    sender_email: Optional[str] = None
    subject: Optional[str] = None
    received_at: datetime
    job_id: Optional[int] = None
    job_title: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    attachment_count: int = 0


class PaginatedInboundEmails(BaseModel):
    items: List[InboundEmailOut]
    total: int
    page: int
    limit: int
    pages: int


class ImapConfigOut(BaseModel):
    enabled: bool
    method: str = "imap"  # "imap", "graph", or "none"
    host: Optional[str] = None  # IMAP host:port or Graph mailbox address
    port: int
    poll_interval: int
    stats: Dict[str, int]


@router.get("/config", response_model=ImapConfigOut)
def get_imap_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ImapConfigOut:
    """Return email ingestion configuration status and aggregate stats.

    Graph API takes priority over IMAP when both are configured.
    """
    from app.models import SystemSetting

    rows = {r.key: r.value for r in db.query(SystemSetting).all()}

    total = db.query(func.count(InboundEmail.id)).scalar() or 0
    processed = db.query(func.count(InboundEmail.id)).filter(InboundEmail.status == "processed").scalar() or 0
    failed = db.query(func.count(InboundEmail.id)).filter(InboundEmail.status == "failed").scalar() or 0
    no_attachment = db.query(func.count(InboundEmail.id)).filter(InboundEmail.status == "no_attachment").scalar() or 0
    stats = {"total": total, "processed": processed, "failed": failed, "no_attachment": no_attachment}

    selected_method = rows.get("email_ingestion_method") or "auto"

    # Check what's configured
    graph_mailbox = rows.get("graph_mailbox") or ""
    graph_configured = bool(
        rows.get("graph_client_id") and rows.get("graph_tenant_id")
        and rows.get("graph_client_secret") and graph_mailbox
    )
    imap_host = rows.get("imap_host") or settings.imap_host or ""
    imap_port_raw = rows.get("imap_port") or str(settings.imap_port)
    imap_port = int(imap_port_raw) if imap_port_raw else settings.imap_port
    imap_username = rows.get("imap_username") or settings.imap_username or ""
    imap_configured = bool(imap_host and imap_username and (rows.get("imap_password") or settings.imap_password))

    # Determine active method based on selection
    if selected_method == "disabled":
        active_method = "none"
    elif selected_method == "graph":
        active_method = "graph" if graph_configured else "none"
    elif selected_method == "imap":
        active_method = "imap" if imap_configured else "none"
    else:  # auto: Graph takes priority
        active_method = "graph" if graph_configured else ("imap" if imap_configured else "none")

    if active_method == "graph":
        return ImapConfigOut(
            enabled=True,
            method="graph",
            host=graph_mailbox,
            port=0,
            poll_interval=settings.imap_poll_interval,
            stats=stats,
        )
    if active_method == "imap":
        return ImapConfigOut(
            enabled=True,
            method="imap",
            host=f"{imap_host}:{imap_port}",
            port=imap_port,
            poll_interval=settings.imap_poll_interval,
            stats=stats,
        )
    return ImapConfigOut(
        enabled=False,
        method="none",
        host=None,
        port=imap_port,
        poll_interval=settings.imap_poll_interval,
        stats=stats,
    )


@router.get("", response_model=PaginatedInboundEmails)
def list_inbound_emails(
    status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaginatedInboundEmails:
    """Paginated, optionally status-filtered log of inbound emails."""
    query = db.query(InboundEmail)
    if status:
        query = query.filter(InboundEmail.status == status)
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                InboundEmail.sender_email.ilike(pattern),
                InboundEmail.subject.ilike(pattern),
            )
        )
    query = query.order_by(InboundEmail.received_at.desc())

    total = query.count()
    pages = math.ceil(total / limit) if total > 0 else 1
    emails: List[InboundEmail] = query.offset((page - 1) * limit).limit(limit).all()

    # Batch-load job titles to avoid N+1
    job_ids = {e.job_id for e in emails if e.job_id}
    job_title_map: Dict[int, str] = {}
    if job_ids:
        for jr in db.query(JobRole).filter(JobRole.id.in_(job_ids)).all():
            job_title_map[jr.id] = jr.title

    items: List[InboundEmailOut] = []
    for e in emails:
        att_count = 0
        if e.raw_file_paths:
            try:
                att_count = len(json.loads(e.raw_file_paths))
            except (json.JSONDecodeError, ValueError):
                pass
        items.append(
            InboundEmailOut(
                id=e.id,
                message_id=e.message_id,
                sender_email=e.sender_email,
                subject=e.subject,
                received_at=e.received_at,
                job_id=e.job_id,
                job_title=job_title_map.get(e.job_id) if e.job_id else None,
                status=e.status,
                error_message=e.error_message,
                attachment_count=att_count,
            )
        )

    return PaginatedInboundEmails(items=items, total=total, page=page, limit=limit, pages=pages)


def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


@router.post("/{email_id}/retry", status_code=status.HTTP_200_OK)
def retry_inbound_email(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Reset a single email log entry so it will be re-ingested on the next fetch.

    Works for any status. Sets status back to 'new' and clears any error message
    so the ingestion pipeline picks it up again.
    """
    row = db.query(InboundEmail).filter(InboundEmail.id == email_id).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email log entry not found")
    row.status = "new"
    row.error_message = None
    db.commit()
    return {"message": "Email reset for re-ingestion."}


@router.delete("/{email_id}")
def delete_inbound_email(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Delete a single email log entry (admin only). Also removes saved attachment files."""
    _require_admin(current_user)
    row = db.query(InboundEmail).filter(InboundEmail.id == email_id).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email log entry not found")

    # Clean up saved attachment files
    if row.raw_file_paths:
        try:
            for fp in json.loads(row.raw_file_paths):
                if fp and os.path.exists(fp):
                    os.remove(fp)
        except Exception:
            pass

    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_200_OK)
def clear_inbound_emails(
    filter_status: Optional[str] = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Delete all (or status-filtered) email log entries (admin only).

    Pass ?status=failed to clear only failed entries, etc.
    No ?status param deletes everything.
    """
    _require_admin(current_user)
    query = db.query(InboundEmail)
    if filter_status:
        query = query.filter(InboundEmail.status == filter_status)

    rows = query.all()

    # Remove attachment files first
    for row in rows:
        if row.raw_file_paths:
            try:
                for fp in json.loads(row.raw_file_paths):
                    if fp and os.path.exists(fp):
                        os.remove(fp)
            except Exception:
                pass

    deleted = len(rows)
    query.delete(synchronize_session=False)
    db.commit()

    return {"deleted": deleted, "message": f"Deleted {deleted} email log entr{'y' if deleted == 1 else 'ies'}."}

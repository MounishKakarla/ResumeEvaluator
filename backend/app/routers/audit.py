"""Audit trail — records who changed what and when on candidates/evaluations."""
from __future__ import annotations

import json
import math
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import AuditLog, User

router = APIRouter(prefix="/audit-log", tags=["audit"])


# ---------------------------------------------------------------------------
# Helper — call this from other routers to record a change
# ---------------------------------------------------------------------------

def record_audit(
    db: Session,
    user_id: Optional[int],
    action: str,
    target_type: str,
    target_id: int,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    """Append one row to audit_log. Caller must commit the session."""
    entry = AuditLog(
        user_id=user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=json.dumps(details) if details else None,
    )
    db.add(entry)


# ---------------------------------------------------------------------------
# Response schema
# ---------------------------------------------------------------------------

class AuditLogItem(BaseModel):
    id: int
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    action: str
    target_type: Optional[str] = None
    target_id: Optional[int] = None
    details: Optional[Dict[str, Any]] = None
    timestamp: str

    class Config:
        from_attributes = True


class PaginatedAuditLog(BaseModel):
    items: List[AuditLogItem]
    total: int
    page: int
    limit: int
    pages: int


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("", response_model=PaginatedAuditLog)
def list_audit_log(
    target_type: Optional[str] = Query(None),
    target_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    query = db.query(AuditLog)

    if target_type:
        query = query.filter(AuditLog.target_type == target_type)
    if target_id is not None:
        query = query.filter(AuditLog.target_id == target_id)
    if action:
        query = query.filter(AuditLog.action == action)

    total = query.count()
    rows = (
        query.order_by(AuditLog.timestamp.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    # Batch-fetch user emails
    user_ids = {r.user_id for r in rows if r.user_id}
    user_emails: Dict[int, str] = {}
    if user_ids:
        users = db.query(User).filter(User.id.in_(user_ids)).all()
        user_emails = {u.id: u.email for u in users}

    items = [
        AuditLogItem(
            id=row.id,
            user_id=row.user_id,
            user_email=user_emails.get(row.user_id) if row.user_id else None,
            action=row.action,
            target_type=row.target_type,
            target_id=row.target_id,
            details=json.loads(row.details) if row.details else None,
            timestamp=row.timestamp.isoformat() if row.timestamp else "",
        )
        for row in rows
    ]

    return PaginatedAuditLog(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=max(1, math.ceil(total / limit)),
    )

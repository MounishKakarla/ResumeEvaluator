"""Manual Evaluation router.

POST /resumes/{evaluation_id}/manual-evaluation  — Create / replace manual eval
GET  /resumes/{evaluation_id}/manual-evaluation  — Fetch latest manual eval
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import Evaluation, ManualEvaluation, User
from app.schemas import ManualEvaluationCreate, ManualEvaluationOut

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/resumes", tags=["manual-evaluation"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@router.post(
    "/{evaluation_id}/manual-evaluation",
    response_model=ManualEvaluationOut,
    status_code=status.HTTP_201_CREATED,
)
def create_or_update_manual_evaluation(
    evaluation_id: int,
    body: ManualEvaluationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ManualEvaluationOut:
    """Create or replace the manual evaluation for an evaluation result."""
    ev = db.query(Evaluation).filter(Evaluation.id == evaluation_id).first()
    if ev is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evaluation {evaluation_id} not found",
        )

    # Upsert: one manual eval per evaluation (replace if exists)
    existing: Optional[ManualEvaluation] = (
        db.query(ManualEvaluation)
        .filter(ManualEvaluation.evaluation_id == evaluation_id)
        .order_by(ManualEvaluation.created_at.desc())
        .first()
    )

    checklist_json = (
        json.dumps(body.skills_checklist) if body.skills_checklist is not None else None
    )

    if existing:
        existing.manual_score = body.manual_score
        existing.justification = body.justification
        existing.skills_checklist = checklist_json
        existing.recruiter_id = current_user.id
        existing.updated_at = _utcnow()
        db.commit()
        db.refresh(existing)
        record = existing
    else:
        record = ManualEvaluation(
            evaluation_id=evaluation_id,
            recruiter_id=current_user.id,
            manual_score=body.manual_score,
            justification=body.justification,
            skills_checklist=checklist_json,
        )
        db.add(record)
        db.commit()
        db.refresh(record)

    # Deserialise checklist for response
    return _to_out(record)


@router.get(
    "/{evaluation_id}/manual-evaluation",
    response_model=ManualEvaluationOut,
)
def get_manual_evaluation(
    evaluation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ManualEvaluationOut:
    """Fetch the latest manual evaluation for an evaluation result."""
    record: Optional[ManualEvaluation] = (
        db.query(ManualEvaluation)
        .filter(ManualEvaluation.evaluation_id == evaluation_id)
        .order_by(ManualEvaluation.created_at.desc())
        .first()
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No manual evaluation found for this result",
        )
    return _to_out(record)


def _to_out(record: ManualEvaluation) -> ManualEvaluationOut:
    checklist = None
    if record.skills_checklist:
        try:
            checklist = json.loads(record.skills_checklist)
        except Exception:
            checklist = None
    return ManualEvaluationOut(
        id=record.id,
        evaluation_id=record.evaluation_id,
        recruiter_id=record.recruiter_id,
        manual_score=record.manual_score,
        justification=record.justification,
        skills_checklist=checklist,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )

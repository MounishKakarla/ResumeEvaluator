"""Interview feedback endpoints."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import InterviewFeedback, User
from app.routers.audit import record_audit

router = APIRouter(prefix="/interview-feedback", tags=["interview-feedback"])


class FeedbackCreate(BaseModel):
    candidate_id: int
    evaluation_id: Optional[int] = None
    stage: str = Field(..., pattern="^(screening|coding|interview)$")
    rating: int = Field(..., ge=1, le=5)
    technical_score: Optional[float] = Field(None, ge=0, le=10)
    communication_score: Optional[float] = Field(None, ge=0, le=10)
    culture_fit_score: Optional[float] = Field(None, ge=0, le=10)
    recommendation: Optional[str] = Field(None, pattern="^(strong_hire|hire|no_hire|strong_no_hire)$")
    notes: Optional[str] = None


class FeedbackOut(BaseModel):
    id: int
    candidate_id: int
    evaluation_id: Optional[int] = None
    interviewer_email: Optional[str] = None
    stage: str
    rating: int
    technical_score: Optional[float] = None
    communication_score: Optional[float] = None
    culture_fit_score: Optional[float] = None
    recommendation: Optional[str] = None
    notes: Optional[str] = None
    created_at: str

    class Config:
        from_attributes = True


def _to_out(fb: InterviewFeedback) -> FeedbackOut:
    return FeedbackOut(
        id=fb.id,
        candidate_id=fb.candidate_id,
        evaluation_id=fb.evaluation_id,
        interviewer_email=fb.interviewer.email if fb.interviewer else None,
        stage=fb.stage,
        rating=fb.rating,
        technical_score=fb.technical_score,
        communication_score=fb.communication_score,
        culture_fit_score=fb.culture_fit_score,
        recommendation=fb.recommendation,
        notes=fb.notes,
        created_at=fb.created_at.isoformat(),
    )


@router.post("", response_model=FeedbackOut, status_code=status.HTTP_201_CREATED)
def create_feedback(
    body: FeedbackCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FeedbackOut:
    fb = InterviewFeedback(
        candidate_id=body.candidate_id,
        evaluation_id=body.evaluation_id,
        interviewer_id=current_user.id,
        stage=body.stage,
        rating=body.rating,
        technical_score=body.technical_score,
        communication_score=body.communication_score,
        culture_fit_score=body.culture_fit_score,
        recommendation=body.recommendation,
        notes=body.notes,
    )
    db.add(fb)
    record_audit(db, current_user.id, "interview_feedback_added", "candidate", body.candidate_id,
                 {"stage": body.stage, "rating": body.rating, "recommendation": body.recommendation})
    db.commit()
    db.refresh(fb)
    return _to_out(fb)


@router.get("/candidate/{candidate_id}", response_model=List[FeedbackOut])
def list_feedback_for_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> List[FeedbackOut]:
    rows = (
        db.query(InterviewFeedback)
        .filter(InterviewFeedback.candidate_id == candidate_id)
        .order_by(InterviewFeedback.created_at.desc())
        .all()
    )
    return [_to_out(r) for r in rows]


@router.delete("/{feedback_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_feedback(
    feedback_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    fb = db.query(InterviewFeedback).filter(InterviewFeedback.id == feedback_id).first()
    if fb is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")
    if fb.interviewer_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your feedback")
    record_audit(db, current_user.id, "interview_feedback_deleted", "candidate", fb.candidate_id,
                 {"stage": fb.stage, "feedback_id": feedback_id})
    db.delete(fb)
    db.commit()

"""Team collaboration: candidate comment threads."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.deps import get_current_user, get_db
from app.models import Candidate, CandidateComment, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/candidates/{candidate_id}/comments", tags=["comments"])


class CommentOut(BaseModel):
    id: int
    candidate_id: int
    author_id: Optional[int]
    author_email: Optional[str]
    body: str
    created_at: str
    updated_at: Optional[str]

    class Config:
        from_attributes = True


class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)


class CommentUpdate(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)


def _to_out(comment: CandidateComment) -> CommentOut:
    return CommentOut(
        id=comment.id,
        candidate_id=comment.candidate_id,
        author_id=comment.author_id,
        author_email=comment.author.email if comment.author else None,
        body=comment.body,
        created_at=comment.created_at.isoformat(),
        updated_at=comment.updated_at.isoformat() if comment.updated_at else None,
    )


@router.get("", response_model=List[CommentOut])
def list_comments(
    candidate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[CommentOut]:
    """Return all comments for a candidate, oldest first."""
    _require_candidate(candidate_id, db)
    comments = (
        db.query(CandidateComment)
        .options(joinedload(CandidateComment.author))
        .filter(CandidateComment.candidate_id == candidate_id)
        .order_by(CandidateComment.created_at.asc())
        .all()
    )
    return [_to_out(c) for c in comments]


@router.post("", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
def create_comment(
    candidate_id: int,
    body: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentOut:
    """Add a comment to a candidate's thread."""
    _require_candidate(candidate_id, db)
    comment = CandidateComment(
        candidate_id=candidate_id,
        author_id=current_user.id,
        body=body.body,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    # Reload with author relation
    comment = (
        db.query(CandidateComment)
        .options(joinedload(CandidateComment.author))
        .filter(CandidateComment.id == comment.id)
        .one()
    )
    return _to_out(comment)


@router.patch("/{comment_id}", response_model=CommentOut)
def update_comment(
    candidate_id: int,
    comment_id: int,
    body: CommentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentOut:
    """Edit own comment body (admins can edit any)."""
    comment = _get_comment(comment_id, candidate_id, db)
    if comment.author_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot edit another user's comment")
    comment.body = body.body
    comment.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(comment)
    comment = (
        db.query(CandidateComment)
        .options(joinedload(CandidateComment.author))
        .filter(CandidateComment.id == comment.id)
        .one()
    )
    return _to_out(comment)


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_comment(
    candidate_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete own comment (admins can delete any)."""
    comment = _get_comment(comment_id, candidate_id, db)
    if comment.author_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete another user's comment")
    db.delete(comment)
    db.commit()


# ── helpers ──────────────────────────────────────────────────────────────────

def _require_candidate(candidate_id: int, db: Session) -> None:
    if not db.query(Candidate.id).filter(Candidate.id == candidate_id).scalar():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")


def _get_comment(comment_id: int, candidate_id: int, db: Session) -> CandidateComment:
    comment = (
        db.query(CandidateComment)
        .filter(
            CandidateComment.id == comment_id,
            CandidateComment.candidate_id == candidate_id,
        )
        .first()
    )
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    return comment

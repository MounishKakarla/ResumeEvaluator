"""Candidate search endpoint — cross-role candidate lookup."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import Candidate, Evaluation, JobRole, Resume, ResumeVersion
from app.routers.audit import record_audit

router = APIRouter(prefix="/candidates", tags=["candidates"])


class CandidateSearchItem(BaseModel):
    id: int
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    current_title: Optional[str] = None
    experience_level: Optional[str] = None
    years_experience: Optional[float] = None
    stage: str = "applied"
    source: Optional[str] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    latest_job_role: Optional[str] = None
    latest_evaluation_id: Optional[int] = None

    class Config:
        from_attributes = True


class PaginatedCandidates(BaseModel):
    items: List[CandidateSearchItem]
    total: int
    page: int
    limit: int
    pages: int


class BulkDeleteRequest(BaseModel):
    ids: List[int]


class CandidateUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    current_title: Optional[str] = None
    experience_level: Optional[str] = None
    years_experience: Optional[float] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    stage: Optional[str] = None


@router.get("/search", response_model=PaginatedCandidates)
def search_candidates(
    q: Optional[str] = Query(None, description="Search name, email, or title"),
    stage: Optional[str] = Query(None),
    experience_level: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    query = db.query(Candidate).filter(Candidate.deleted_at.is_(None))

    if q and q.strip():
        pattern = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Candidate.name.ilike(pattern),
                Candidate.email.ilike(pattern),
                Candidate.current_title.ilike(pattern),
            )
        )
    if stage:
        query = query.filter(Candidate.stage == stage)
    if experience_level:
        query = query.filter(Candidate.experience_level == experience_level)

    total = query.count()
    candidates = (
        query.order_by(Candidate.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    # Fetch latest evaluation (id + job role title) per candidate in one query
    candidate_ids = [c.id for c in candidates]
    latest_roles: dict[int, str] = {}
    latest_eval_ids: dict[int, int] = {}
    if candidate_ids:
        rows = (
            db.query(Evaluation.id, ResumeVersion.candidate_id, JobRole.title)
            .join(Resume, Evaluation.resume_id == Resume.id)
            .join(ResumeVersion, ResumeVersion.id == Resume.id)
            .join(JobRole, Evaluation.job_role_id == JobRole.id)
            .filter(ResumeVersion.candidate_id.in_(candidate_ids))
            .order_by(Evaluation.evaluated_at.desc())
            .all()
        )
        for eval_id, cid, title in rows:
            if cid not in latest_roles:
                latest_roles[cid] = title
                latest_eval_ids[cid] = eval_id

    items = [
        CandidateSearchItem(
            id=c.id,
            name=c.name,
            email=c.email,
            phone=getattr(c, "phone", None),
            current_title=getattr(c, "current_title", None),
            experience_level=getattr(c, "experience_level", None),
            years_experience=getattr(c, "years_experience", None),
            stage=c.stage or "applied",
            linkedin_url=c.linkedin_url,
            github_url=c.github_url,
            portfolio_url=c.portfolio_url,
            latest_job_role=latest_roles.get(c.id),
            latest_evaluation_id=latest_eval_ids.get(c.id),
        )
        for c in candidates
    ]

    return PaginatedCandidates(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=max(1, math.ceil(total / limit)),
    )


@router.patch("/{candidate_id}", response_model=CandidateSearchItem)
def update_candidate(
    candidate_id: int,
    body: CandidateUpdate,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
) -> CandidateSearchItem:
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    changes: dict = {}
    for field, value in body.model_dump(exclude_unset=True).items():
        old = getattr(candidate, field, None)
        if old != value:
            changes[field] = [old, value]
        setattr(candidate, field, value)

    if changes:
        record_audit(db, _current_user.id, "update", "candidate", candidate_id, changes)
    db.commit()
    db.refresh(candidate)

    return CandidateSearchItem(
        id=candidate.id,
        name=candidate.name,
        email=candidate.email,
        phone=getattr(candidate, "phone", None),
        current_title=getattr(candidate, "current_title", None),
        experience_level=getattr(candidate, "experience_level", None),
        years_experience=getattr(candidate, "years_experience", None),
        stage=candidate.stage or "applied",
        linkedin_url=candidate.linkedin_url,
        github_url=candidate.github_url,
        portfolio_url=candidate.portfolio_url,
        latest_job_role=None,
        latest_evaluation_id=None,
    )


@router.delete("/{candidate_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
def hard_delete_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """Permanently delete a candidate and ALL their data (resumes, evaluations, emails).

    This is irreversible. Use soft-delete (DELETE /{id}) when you want to archive instead.
    """
    import os as _os
    from app.models import InboundEmail
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    # Delete all resume versions (cascade handles resumes + evaluations via FK)
    versions = db.query(ResumeVersion).filter(ResumeVersion.candidate_id == candidate_id).all()
    for rv in versions:
        if rv.file_path and _os.path.exists(rv.file_path):
            try:
                _os.remove(rv.file_path)
            except OSError:
                pass
        resume = db.query(Resume).filter(Resume.id == rv.id).first()
        if resume:
            from app.models import Evaluation
            db.query(Evaluation).filter(Evaluation.resume_id == resume.id).delete()
            db.delete(resume)
        db.delete(rv)

    # Delete inbound email records for this candidate's email
    if candidate.email:
        db.query(InboundEmail).filter(
            InboundEmail.sender_email == candidate.email
        ).delete()

    record_audit(db, _current_user.id, "hard_delete", "candidate", candidate_id)
    db.delete(candidate)
    db.commit()


@router.delete("/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    candidate.deleted_at = datetime.now(timezone.utc)
    record_audit(db, _current_user.id, "delete", "candidate", candidate_id)
    db.commit()


@router.post("/bulk-delete", status_code=status.HTTP_200_OK)
def bulk_delete_candidates(
    body: BulkDeleteRequest,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
) -> dict:
    if not body.ids:
        return {"deleted": 0}
    now = datetime.now(timezone.utc)
    updated = (
        db.query(Candidate)
        .filter(Candidate.id.in_(body.ids), Candidate.deleted_at.is_(None))
        .all()
    )
    for c in updated:
        c.deleted_at = now
        record_audit(db, _current_user.id, "delete", "candidate", c.id)
    db.commit()
    return {"deleted": len(updated)}


@router.post("/{candidate_id}/restore", response_model=CandidateSearchItem)
def restore_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
) -> CandidateSearchItem:
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    candidate.deleted_at = None
    record_audit(db, _current_user.id, "restore", "candidate", candidate_id)
    db.commit()
    db.refresh(candidate)
    return CandidateSearchItem(
        id=candidate.id,
        name=candidate.name,
        email=candidate.email,
        phone=getattr(candidate, "phone", None),
        current_title=getattr(candidate, "current_title", None),
        experience_level=getattr(candidate, "experience_level", None),
        years_experience=getattr(candidate, "years_experience", None),
        stage=candidate.stage or "applied",
        source=getattr(candidate, "source", None),
        linkedin_url=candidate.linkedin_url,
        github_url=candidate.github_url,
        portfolio_url=candidate.portfolio_url,
        latest_job_role=None,
        latest_evaluation_id=None,
    )


@router.post("/reparse-all")
def reparse_all_candidates(
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
) -> dict:
    """Re-extract name and graduation year for every active candidate that has a current resume."""
    from app.models import Resume, ResumeVersion
    from app.services.parser import (
        extract_name, extract_name_from_pdf_fonts,
        extract_graduation_year, extract_metadata_via_llm, is_plausible_name,
    )
    from app.services.segmenter import segment_text

    candidates = db.query(Candidate).filter(Candidate.deleted_at.is_(None)).all()
    updated = 0
    for candidate in candidates:
        rv = (
            db.query(ResumeVersion)
            .filter(ResumeVersion.candidate_id == candidate.id, ResumeVersion.is_current.is_(True))
            .first()
        )
        if not rv or not rv.resume or not rv.resume.raw_text:
            continue
        raw_text = rv.resume.raw_text
        # 1st: font-size (largest text in top 30% of page 1 — immune to column ordering)
        # 2nd: regex on extracted text (geographic/non-name blacklist)
        # 3rd: LLM validated against the same blacklist
        new_name = extract_name_from_pdf_fonts(rv.file_path or "")
        if not new_name:
            new_name = extract_name(raw_text)
        if not new_name:
            llm_meta = extract_metadata_via_llm(raw_text) or {}
            llm_name = (llm_meta.get("name") or "").strip()
            if llm_name and is_plausible_name(llm_name):
                new_name = llm_name
        if new_name and new_name != candidate.name:
            candidate.name = new_name
            updated += 1
        sections = segment_text(raw_text)
        new_year = extract_graduation_year(sections, raw_text=raw_text)
        if new_year and new_year != candidate.graduation_year:
            candidate.graduation_year = new_year
    db.commit()
    return {"updated": updated, "total": len(candidates)}


@router.post("/{candidate_id}/reparse", response_model=CandidateSearchItem)
def reparse_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
) -> CandidateSearchItem:
    """Re-extract name and graduation year from the stored resume text using the current parser."""
    from app.services.parser import (
        extract_name, extract_name_from_pdf_fonts,
        extract_graduation_year, extract_metadata_via_llm, is_plausible_name,
    )
    from app.models import Resume, ResumeVersion
    from app.services.segmenter import segment_text

    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    rv = (
        db.query(ResumeVersion)
        .filter(ResumeVersion.candidate_id == candidate_id, ResumeVersion.is_current.is_(True))
        .first()
    )
    if not rv or not rv.resume or not rv.resume.raw_text:
        raise HTTPException(status_code=404, detail="No current resume text found for this candidate")

    raw_text = rv.resume.raw_text
    changes: dict = {}

    # 1st: font-size (largest text in top 30% of page 1)
    # 2nd: regex on extracted text (geographic/non-name blacklist)
    # 3rd: LLM validated against the same blacklist
    new_name = extract_name_from_pdf_fonts(rv.file_path or "")
    if not new_name:
        new_name = extract_name(raw_text)
    if not new_name:
        llm_meta = extract_metadata_via_llm(raw_text) or {}
        llm_name = (llm_meta.get("name") or "").strip()
        if llm_name and is_plausible_name(llm_name):
            new_name = llm_name
    if new_name and new_name != candidate.name:
        changes["name"] = [candidate.name, new_name]
        candidate.name = new_name

    sections = segment_text(raw_text)
    new_year = extract_graduation_year(sections, raw_text=raw_text)
    if new_year and new_year != candidate.graduation_year:
        changes["graduation_year"] = [candidate.graduation_year, new_year]
        candidate.graduation_year = new_year

    if changes:
        record_audit(db, _current_user.id, "reparse", "candidate", candidate_id, changes)

    db.commit()
    db.refresh(candidate)
    return CandidateSearchItem(
        id=candidate.id,
        name=candidate.name,
        email=candidate.email,
        phone=getattr(candidate, "phone", None),
        current_title=getattr(candidate, "current_title", None),
        experience_level=getattr(candidate, "experience_level", None),
        years_experience=getattr(candidate, "years_experience", None),
        stage=candidate.stage or "applied",
        source=getattr(candidate, "source", None),
        linkedin_url=candidate.linkedin_url,
        github_url=candidate.github_url,
        portfolio_url=candidate.portfolio_url,
        latest_job_role=None,
        latest_evaluation_id=None,
    )

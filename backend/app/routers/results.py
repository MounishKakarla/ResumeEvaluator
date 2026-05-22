from __future__ import annotations

import csv
import io
import json
import logging
import math
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, desc, asc, or_, select as sa_select
from sqlalchemy.orm import Session, joinedload

from app.deps import get_current_user, get_db
from app.models import (
    Candidate,
    Evaluation,
    JobRole,
    JobRoleSkill,
    Resume,
    ResumeVersion,
    Shortlist,
    Skill,
    User,
)
from app.schemas import (
    EvaluationDetail,
    ManualEmailRequest,
    PaginatedResults,
    RejectionEmailRequest,
    RequirementBreakdown,
    ResultsResponse,
    SkillMatchDetail,
    UpdateCandidateStageRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/results", tags=["results"])


def _parse_json_list(raw: Optional[str]) -> list:
    """Safely parse a JSON-encoded list stored in a Text column. Returns [] on failure."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, ValueError):
        return []


# Whitelist of sortable columns to prevent ORM injection
_SORT_COLUMNS: Dict[str, Any] = {
    "total_score":    Evaluation.total_score,
    "project_score":  Evaluation.project_score,
    "skill_score":    Evaluation.skill_score,
    "education_score": Evaluation.education_score,
    "evaluated_at":   Evaluation.evaluated_at,
}


@router.get("", response_model=PaginatedResults)
def list_results(
    job_role_id: Optional[int] = Query(default=None),
    sort: str = Query(default="total_score", alias="sort_by"),
    order: str = Query(default="desc", pattern="^(asc|desc)$", alias="sort_dir"),
    shortlist_status: Optional[str] = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaginatedResults:
    """Paginated, DB-sorted list of evaluation results with candidate info."""

    # ── Base query with eager-loaded relations ────────────────────────────────
    # Subquery: resume_ids whose candidate is soft-deleted — exclude these from leaderboard
    soft_deleted_resume_ids = (
        db.query(Resume.id)
        .join(ResumeVersion, Resume.id == ResumeVersion.id)
        .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
        .filter(Candidate.deleted_at.isnot(None))
    )

    query = (
        db.query(Evaluation)
        .options(
            joinedload(Evaluation.resume)
            .joinedload(Resume.version)
            .joinedload(ResumeVersion.candidate),
            joinedload(Evaluation.shortlists),
            joinedload(Evaluation.job_role),
        )
        # Exclude soft-deleted candidates and intake-paused evaluations
        .filter(
            Evaluation.resume_id.notin_(soft_deleted_resume_ids),
            or_(
                Evaluation.eval_status.is_(None),
                Evaluation.eval_status == "tfidf_filtered",
                Evaluation.eval_status == "experience_filtered",
            ),
        )
    )

    if job_role_id is not None:
        query = query.filter(Evaluation.job_role_id == job_role_id)

    # ── Shortlist status filter (DB subquery, not Python loop) ────────────────
    if shortlist_status == "pending":
        # "pending" = no shortlist record at all
        query = query.filter(
            ~db.query(Shortlist.id)
            .filter(Shortlist.evaluation_id == Evaluation.id)
            .exists()
        )
    elif shortlist_status:
        latest_sl_subq = (
            db.query(Shortlist.status)
            .filter(Shortlist.evaluation_id == Evaluation.id)
            .order_by(Shortlist.changed_at.desc())
            .limit(1)
            .correlate(Evaluation)
            .scalar_subquery()
        )
        query = query.filter(latest_sl_subq == shortlist_status)

    # ── DB-level sort (whitelisted column) ────────────────────────────────────
    sort_col = _SORT_COLUMNS.get(sort, Evaluation.total_score)
    query = query.order_by(desc(sort_col) if order == "desc" else asc(sort_col))

    # ── Total count before pagination ─────────────────────────────────────────
    total: int = query.count()
    pages = math.ceil(total / limit) if total > 0 else 1

    # ── Paginate ──────────────────────────────────────────────────────────────
    evals: List[Evaluation] = query.offset((page - 1) * limit).limit(limit).all()

    # ── Batch-load skills_total per job_role to avoid N+1 ────────────────────
    role_ids = {ev.job_role_id for ev in evals}
    skills_total_map: Dict[int, int] = {}
    if role_ids:
        rows = (
            db.query(JobRoleSkill.job_role_id, func.count(JobRoleSkill.id))
            .filter(JobRoleSkill.job_role_id.in_(role_ids))
            .group_by(JobRoleSkill.job_role_id)
            .all()
        )
        skills_total_map = {r[0]: r[1] for r in rows}

    # ── Build response items ──────────────────────────────────────────────────
    items: List[ResultsResponse] = []
    for ev in evals:
        rv: Optional[ResumeVersion] = ev.resume.version if ev.resume else None
        cand: Optional[Candidate] = rv.candidate if rv else None

        skills_matched_list = json.loads(ev.skills_matched) if ev.skills_matched else []

        project_match_label = "Low"
        if ev.project_score >= 80:
            project_match_label = "High"
        elif ev.project_score >= 50:
            project_match_label = "Med"

        # Latest shortlist status from already-loaded relation (no extra query)
        latest_sl: Optional[str] = None
        if ev.shortlists:
            latest_sl = max(ev.shortlists, key=lambda s: s.changed_at).status

        items.append(
            ResultsResponse(
                evaluation_id=ev.id,
                candidate_id=cand.id if cand else 0,
                candidate_name=cand.name if cand else "Unknown",
                candidate_email=cand.email if cand else None,
                candidate_phone=getattr(cand, "phone", None) if cand else None,
                candidate_current_title=getattr(cand, "current_title", None) if cand else None,
                candidate_experience_level=getattr(cand, "experience_level", None) if cand else None,
                candidate_years_experience=getattr(cand, "years_experience", None) if cand else None,
                candidate_graduation_year=getattr(cand, "graduation_year", None) if cand else None,
                resume_id=ev.resume_id,
                total_score=ev.total_score,
                project_score=ev.project_score,
                skill_score=ev.skill_score,
                education_score=ev.education_score,
                skills_matched=len(skills_matched_list),
                skills_total=skills_total_map.get(ev.job_role_id, 0),
                project_match_score=ev.project_score / 100.0,
                project_match_label=project_match_label,
                status=latest_sl or "pending",
                needs_manual_review=cand.needs_manual_review if cand else False,
                evaluated_at=ev.evaluated_at,
                email_sent_at=ev.email_sent_at,
                email_opened_at=getattr(ev, 'email_opened_at', None),
                job_role_id=ev.job_role_id,
                job_role_title=ev.job_role.title if ev.job_role else "",
                matched_skill_names=[
                    m["skill_name"] for m in skills_matched_list
                    if isinstance(m, dict) and "skill_name" in m
                ],
                candidate_stage=getattr(cand, "stage", "applied") if cand else "applied",
                tfidf_score=getattr(ev, "tfidf_score", None),
                filter_stage=(
                    "experience_filtered" if ev.eval_status == "experience_filtered"
                    else "tfidf_filtered" if ev.eval_status == "tfidf_filtered"
                    else "llm_scored"
                ),
            )
        )

    return PaginatedResults(items=items, total=total, page=page, limit=limit, pages=pages)


# ---------------------------------------------------------------------------
# Full-text resume search
# ---------------------------------------------------------------------------

class ResumeSearchHit(BaseModel):
    evaluation_id: int
    candidate_id: int
    candidate_name: str
    candidate_email: Optional[str]
    job_role_title: str
    total_score: float
    snippet: str   # excerpt around the match

class ResumeSearchResponse(BaseModel):
    hits: List[ResumeSearchHit]
    total: int

@router.get("/search", response_model=ResumeSearchResponse)
def search_resumes(
    q: str = Query(..., min_length=2, max_length=200, description="Text to search in resume content"),
    job_role_id: Optional[int] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ResumeSearchResponse:
    """Full-text search across resume raw_text using ILIKE."""
    pattern = f"%{q}%"
    query = (
        db.query(Evaluation)
        .join(Resume, Resume.id == Evaluation.resume_id)
        .options(
            joinedload(Evaluation.resume)
            .joinedload(Resume.version)
            .joinedload(ResumeVersion.candidate),
            joinedload(Evaluation.job_role),
        )
        .filter(
            Evaluation.eval_status.is_(None),
            Resume.raw_text.ilike(pattern),
        )
    )
    if job_role_id is not None:
        query = query.filter(Evaluation.job_role_id == job_role_id)

    total = query.count()
    evals = query.order_by(Evaluation.total_score.desc()).offset((page - 1) * limit).limit(limit).all()

    hits: List[ResumeSearchHit] = []
    q_lower = q.lower()
    for ev in evals:
        rv = ev.resume.version if ev.resume else None
        cand = rv.candidate if rv else None
        raw = ev.resume.raw_text or "" if ev.resume else ""

        # Build a ~200-char snippet centred around the first match
        idx = raw.lower().find(q_lower)
        if idx >= 0:
            start = max(0, idx - 80)
            end = min(len(raw), idx + len(q) + 120)
            snippet = ("…" if start > 0 else "") + raw[start:end].strip() + ("…" if end < len(raw) else "")
        else:
            snippet = raw[:200] + ("…" if len(raw) > 200 else "")

        hits.append(ResumeSearchHit(
            evaluation_id=ev.id,
            candidate_id=cand.id if cand else 0,
            candidate_name=cand.name if cand else "Unknown",
            candidate_email=cand.email if cand else None,
            job_role_title=ev.job_role.title if ev.job_role else "",
            total_score=ev.total_score,
            snippet=snippet,
        ))

    return ResumeSearchResponse(hits=hits, total=total)


@router.get("/{evaluation_id}", response_model=EvaluationDetail)
def get_result(
    evaluation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EvaluationDetail:
    """Full breakdown for an evaluation: skills, excerpts, confidence tiers."""
    ev: Optional[Evaluation] = (
        db.query(Evaluation)
        .options(
            joinedload(Evaluation.resume).joinedload(Resume.version).joinedload(ResumeVersion.candidate),
            joinedload(Evaluation.job_role),
            joinedload(Evaluation.shortlists),
        )
        .filter(Evaluation.id == evaluation_id)
        .first()
    )
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Evaluation {evaluation_id} not found")

    # Resolve candidate (was undefined bug — now via eager-loaded relations)
    rv: Optional[ResumeVersion] = ev.resume.version if ev.resume else None
    cand: Optional[Candidate] = rv.candidate if rv else None

    # Parse skills_matched JSON
    skills_matched: List[SkillMatchDetail] = []
    if ev.skills_matched:
        try:
            raw = json.loads(ev.skills_matched)
            skills_matched = [SkillMatchDetail(**s) for s in raw]
        except Exception:
            logger.warning("Failed to parse skills_matched for evaluation %d", evaluation_id)

    # Excerpts
    excerpts: List[str] = []
    if ev.excerpts:
        try:
            excerpts = json.loads(ev.excerpts)
        except (json.JSONDecodeError, ValueError):
            pass

    # Skill gaps: required skills not matched
    jrs_rows = (
        db.query(JobRoleSkill)
        .filter(JobRoleSkill.job_role_id == ev.job_role_id)
        .all()
    )
    skill_ids = [j.skill_id for j in jrs_rows]
    required_skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()
    matched_names = {sm.skill_name.lower() for sm in skills_matched}
    skill_gaps = [s.name for s in required_skills if s.name.lower() not in matched_names]

    # Confidence tiers
    confidence_tiers: dict = {"high": [], "medium": [], "low": []}
    for sm in skills_matched:
        if sm.confidence >= 1.0:
            confidence_tiers["high"].append(sm.skill_name)
        elif sm.confidence >= 0.75:
            confidence_tiers["medium"].append(sm.skill_name)
        else:
            confidence_tiers["low"].append(sm.skill_name)

    # Resume text and sections
    resume_text: str = ev.resume.raw_text or "" if ev.resume else ""
    resume_sections: list = []
    if ev.resume and ev.resume.sections:
        try:
            resume_sections = json.loads(ev.resume.sections)
        except (json.JSONDecodeError, ValueError):
            pass

    # Latest shortlist status + note from eager-loaded relation
    latest_status: Optional[str] = None
    latest_note: Optional[str] = None
    if ev.shortlists:
        latest_sl = max(ev.shortlists, key=lambda s: s.changed_at)
        latest_status = latest_sl.status
        latest_note = latest_sl.note

    # Requirements breakdown (populated when requirements-mode scoring was used)
    requirements_breakdown: list = []
    if ev.requirements_breakdown:
        try:
            requirements_breakdown = [
                RequirementBreakdown(**r) for r in json.loads(ev.requirements_breakdown)
            ]
        except Exception:
            logger.warning("Failed to parse requirements_breakdown for evaluation %d", evaluation_id)

    return EvaluationDetail(
        id=ev.id,
        resume_id=ev.resume_id,
        candidate_id=cand.id if cand else 0,
        candidate_name=cand.name if cand else "Unknown",
        candidate_email=cand.email if cand else None,
        job_role_id=ev.job_role_id,
        job_role_title=ev.job_role.title if ev.job_role else "Unknown",
        total_score=ev.total_score,
        project_score=ev.project_score,
        skill_score=ev.skill_score,
        education_score=ev.education_score,
        evaluated_at=ev.evaluated_at,
        skills_matched=skills_matched,
        skill_gaps=skill_gaps,
        excerpts=excerpts,
        resume_text=resume_text,
        resume_sections=resume_sections,
        status=latest_status,
        shortlist_status=latest_status,
        notes=latest_note,
        confidence_tiers=confidence_tiers,
        requirements_breakdown=requirements_breakdown,
        reasoning_summary=ev.reasoning_summary,
        interview_questions=_parse_json_list(ev.interview_questions),
        email_sent_at=ev.email_sent_at,
        email_opened_at=getattr(ev, 'email_opened_at', None),
        github_url=cand.github_url if cand else None,
        linkedin_url=cand.linkedin_url if cand else None,
        portfolio_url=cand.portfolio_url if cand else None,
    )


@router.post("/{evaluation_id}/email", status_code=status.HTTP_202_ACCEPTED)
def send_email_to_candidate(
    evaluation_id: int,
    body: ManualEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Send a custom email to the candidate associated with the evaluation."""
    ev: Optional[Evaluation] = (
        db.query(Evaluation)
        .options(joinedload(Evaluation.resume)
                 .joinedload(Resume.version)
                 .joinedload(ResumeVersion.candidate))
        .filter(Evaluation.id == evaluation_id)
        .first()
    )
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Evaluation {evaluation_id} not found")

    rv = ev.resume.version if ev.resume else None
    cand = rv.candidate if rv else None

    if not cand or not cand.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Candidate email not found")

    from app.services.email import send_manual_email
    try:
        send_manual_email(cand.email, cand.name, body.subject, body.body)
        return {"status": "success", "message": "Email sent"}
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", cand.email, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to send email") from exc


@router.post("/{evaluation_id}/send-rejection", status_code=status.HTTP_202_ACCEPTED)
def send_rejection_email(
    evaluation_id: int,
    body: RejectionEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Send a constructive rejection email with skill gap feedback to the candidate."""
    ev: Optional[Evaluation] = (
        db.query(Evaluation)
        .options(joinedload(Evaluation.resume)
                 .joinedload(Resume.version)
                 .joinedload(ResumeVersion.candidate),
                 joinedload(Evaluation.job_role))
        .filter(Evaluation.id == evaluation_id)
        .first()
    )
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Evaluation {evaluation_id} not found")

    rv = ev.resume.version if ev.resume else None
    cand = rv.candidate if rv else None

    if not cand or not cand.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Candidate email not found")

    # Parse skill gaps from stored skills_matched vs job role skills
    skill_gaps: List[str] = []
    try:
        jrs_rows = db.query(JobRoleSkill).filter(JobRoleSkill.job_role_id == ev.job_role_id).all()
        skill_ids = [j.skill_id for j in jrs_rows]
        required_skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()
        matched_names: set = set()
        if ev.skills_matched:
            matched_names = {s["skill_name"].lower() for s in json.loads(ev.skills_matched)}
        skill_gaps = [s.name for s in required_skills if s.name.lower() not in matched_names]
    except Exception:
        pass

    from app.services.email import CandidateEmailService
    try:
        sent = CandidateEmailService.send_rejection(
            candidate_email=cand.email,
            candidate_name=cand.name,
            job_role_title=ev.job_role.title if ev.job_role else "the role",
            skill_gaps=skill_gaps[:5],
            note=body.note,
            filter_reason=getattr(ev, "eval_status", None),
        )
        if not sent:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                detail="SMTP not configured — rejection email not sent")
        return {"status": "success", "message": "Rejection email sent"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to send rejection email to %s: %s", cand.email, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to send rejection email") from exc


@router.delete("/all", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_all_results(
    job_role_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete all evaluation results for a specific job role."""
    try:
        # Bulk query.delete() bypasses ORM cascade, so explicitly delete
        # child Shortlist rows first to avoid FK constraint violations.
        eval_ids = [
            row[0] for row in
            db.query(Evaluation.id).filter(Evaluation.job_role_id == job_role_id).all()
        ]
        if eval_ids:
            db.query(Shortlist).filter(
                Shortlist.evaluation_id.in_(eval_ids)
            ).delete(synchronize_session=False)
        db.query(Evaluation).filter(
            Evaluation.job_role_id == job_role_id
        ).delete(synchronize_session=False)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("Failed to delete results for job_role_id=%d: %s", job_role_id, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to delete results") from exc


@router.delete("/{evaluation_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_result(
    evaluation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete an individual evaluation result."""
    ev = db.query(Evaluation).filter(Evaluation.id == evaluation_id).first()
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Result not found")
    try:
        # Delete related shortlists first to avoid FK constraint violations
        db.query(Shortlist).filter(
            Shortlist.evaluation_id == evaluation_id
        ).delete(synchronize_session=False)
        db.delete(ev)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to delete result") from exc


class BulkDeleteRequest(BaseModel):
    ids: List[int]


@router.post("/bulk-delete", status_code=status.HTTP_200_OK)
def bulk_delete_results(
    body: BulkDeleteRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    """Delete multiple evaluation results in a single transaction."""
    if not body.ids:
        return {"deleted": 0}
    try:
        db.query(Shortlist).filter(
            Shortlist.evaluation_id.in_(body.ids)
        ).delete(synchronize_session=False)
        deleted = db.query(Evaluation).filter(
            Evaluation.id.in_(body.ids)
        ).delete(synchronize_session=False)
        db.commit()
        return {"deleted": deleted}
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Bulk delete failed",
        ) from exc


@router.patch("/{evaluation_id}/sections", status_code=status.HTTP_200_OK)
def update_resume_sections(
    evaluation_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Persist user-corrected section types back to resume.sections JSON."""
    ev: Optional[Evaluation] = (
        db.query(Evaluation)
        .options(joinedload(Evaluation.resume))
        .filter(Evaluation.id == evaluation_id)
        .first()
    )
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluation not found")
    if ev.resume is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No resume attached")

    sections = body.get("sections", [])
    if not isinstance(sections, list):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="sections must be a list")

    # Validate and sanitise each section dict
    allowed_types = {
        "projects", "work_experience", "experience", "skills_section",
        "skills", "education", "certifications", "summary", "objective",
        "awards", "publications", "volunteer", "languages", "interests", "unknown",
    }
    cleaned: list[dict] = []
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        sec_type = sec.get("type", "unknown")
        if sec_type not in allowed_types:
            sec_type = "unknown"
        cleaned.append({**sec, "type": sec_type})

    try:
        ev.resume.sections = json.dumps(cleaned)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("Failed to save sections for evaluation %d: %s", evaluation_id, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to save sections") from exc

    return {"saved": len(cleaned)}


@router.patch("/candidates/{candidate_id}/stage", status_code=status.HTTP_200_OK)
def update_candidate_stage(
    candidate_id: int,
    body: UpdateCandidateStageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Update the hiring pipeline stage for a candidate."""
    cand = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if cand is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    try:
        cand.stage = body.stage
        db.commit()
        return {"candidate_id": candidate_id, "stage": body.stage}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to update stage") from exc


# ---------------------------------------------------------------------------
# HRIS / ATS CSV export
# ---------------------------------------------------------------------------

@router.get("/export/csv")
def export_results_csv(
    job_role_id: Optional[int] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Export evaluated candidates to CSV for HRIS / ATS import.

    Columns: candidate_name, email, phone, current_title, experience_level,
             years_experience, stage, total_score, project_score, skill_score,
             education_score, recommendation, linkedin_url, github_url,
             portfolio_url, job_role, evaluated_at
    """
    q = (
        db.query(Evaluation)
        .options(
            joinedload(Evaluation.resume).joinedload(Resume.version).joinedload(ResumeVersion.candidate),
        )
        .filter(Evaluation.eval_status.is_(None))
    )
    if job_role_id is not None:
        q = q.filter(Evaluation.job_role_id == job_role_id)

    # Optional shortlist status filter via subquery
    if status_filter:
        sub = (
            sa_select(Shortlist.evaluation_id)
            .where(Shortlist.status == status_filter)
            .distinct()
        )
        q = q.filter(Evaluation.id.in_(sub))

    evals = q.order_by(Evaluation.total_score.desc()).all()

    # Resolve job role names in one query
    role_ids = list({ev.job_role_id for ev in evals if ev.job_role_id})
    role_map: dict[int, str] = {}
    if role_ids:
        for jr in db.query(JobRole).filter(JobRole.id.in_(role_ids)).all():
            role_map[jr.id] = jr.title

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "candidate_name", "email", "phone", "current_title", "experience_level",
        "years_experience", "stage", "total_score", "project_score", "skill_score",
        "education_score", "recommendation", "linkedin_url", "github_url",
        "portfolio_url", "job_role", "evaluated_at",
    ])

    for ev in evals:
        try:
            cand = ev.resume.version.candidate if ev.resume and ev.resume.version else None
        except AttributeError:
            cand = None

        # Latest shortlist recommendation
        recommendation = ""
        if ev.shortlists:
            latest = max(ev.shortlists, key=lambda s: s.changed_at)
            recommendation = latest.status

        writer.writerow([
            cand.name if cand else "",
            cand.email if cand else "",
            getattr(cand, "phone", "") or "" if cand else "",
            getattr(cand, "current_title", "") or "" if cand else "",
            getattr(cand, "experience_level", "") or "" if cand else "",
            getattr(cand, "years_experience", "") if cand else "",
            cand.stage if cand else "",
            round(ev.total_score, 1),
            round(ev.project_score, 1),
            round(ev.skill_score, 1),
            round(ev.education_score, 1),
            recommendation,
            cand.linkedin_url or "" if cand else "",
            cand.github_url or "" if cand else "",
            cand.portfolio_url or "" if cand else "",
            role_map.get(ev.job_role_id, "") if ev.job_role_id else "",
            ev.evaluated_at.strftime("%Y-%m-%d %H:%M") if ev.evaluated_at else "",
        ])

    output.seek(0)
    filename = f"candidates_export_{job_role_id or 'all'}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_admin
from app.models import AuditLog, Candidate, Evaluation, JobRole, Outcome, Shortlist, User
from app.schemas import BulkShortlistRequest, OutcomeOut, OutcomeRequest, ShortlistOut, ShortlistRequest

router = APIRouter(tags=["shortlist"])


@router.post("/shortlist/auto-apply")
def auto_apply_shortlist(
    job_role_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Retroactively shortlist all evaluations that meet the job role's min_fit_score threshold."""
    job_role = db.query(JobRole).filter(JobRole.id == job_role_id).first()
    if job_role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job role not found")
    if job_role.min_fit_score is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No min_fit_score configured for this job role",
        )

    qualifying = (
        db.query(Evaluation)
        .filter(
            Evaluation.job_role_id == job_role_id,
            Evaluation.total_score >= job_role.min_fit_score,
            Evaluation.eval_status.is_(None),
        )
        .all()
    )

    created = 0
    for ev in qualifying:
        existing = db.query(Shortlist).filter(Shortlist.evaluation_id == ev.id).first()
        if existing is None:
            db.add(Shortlist(
                evaluation_id=ev.id,
                status="shortlisted",
                changed_by=current_user.id,
                changed_at=datetime.utcnow(),
            ))
            created += 1

    if created:
        db.commit()

    return {"applied": created, "total_qualifying": len(qualifying)}


@router.post("/shortlist", response_model=ShortlistOut, status_code=status.HTTP_201_CREATED)
def create_shortlist(
    body: ShortlistRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ShortlistOut:
    """Set or update the shortlist status for an evaluation and write an audit log entry."""
    evaluation = db.query(Evaluation).filter(Evaluation.id == body.evaluation_id).first()
    if evaluation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evaluation {body.evaluation_id} not found",
        )

    shortlist = Shortlist(
        evaluation_id=body.evaluation_id,
        status=body.status,
        note=body.note,
        changed_by=current_user.id,
        changed_at=datetime.utcnow(),
    )
    db.add(shortlist)

    # Audit log
    audit = AuditLog(
        user_id=current_user.id,
        action=f"shortlist_status_changed_to_{body.status}",
        target_type="evaluation",
        target_id=body.evaluation_id,
        timestamp=datetime.utcnow(),
    )
    db.add(audit)
    db.commit()
    db.refresh(shortlist)

    return ShortlistOut.model_validate(shortlist)


@router.post("/shortlist/bulk", status_code=status.HTTP_200_OK)
def bulk_shortlist(
    body: BulkShortlistRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Set shortlist status for multiple evaluations in one request."""
    now = datetime.utcnow()
    found = (
        db.query(Evaluation.id)
        .filter(Evaluation.id.in_(body.evaluation_ids))
        .all()
    )
    valid_ids = {row[0] for row in found}
    missing = [eid for eid in body.evaluation_ids if eid not in valid_ids]

    for eid in valid_ids:
        db.add(Shortlist(
            evaluation_id=eid,
            status=body.status,
            note=body.note,
            changed_by=current_user.id,
            changed_at=now,
        ))
        db.add(AuditLog(
            user_id=current_user.id,
            action=f"shortlist_status_changed_to_{body.status}",
            target_type="evaluation",
            target_id=eid,
            timestamp=now,
        ))

    if valid_ids:
        db.commit()

    return {"updated": len(valid_ids), "missing": missing}


@router.post("/outcomes", response_model=OutcomeOut, status_code=status.HTTP_201_CREATED)
def record_outcome(
    body: OutcomeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OutcomeOut:
    """Record the final hiring outcome for a candidate."""
    candidate = db.query(Candidate).filter(Candidate.id == body.candidate_id).first()
    if candidate is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Candidate {body.candidate_id} not found",
        )

    outcome = Outcome(
        candidate_id=body.candidate_id,
        outcome=body.outcome,
        recorded_by=current_user.id,
        recorded_at=datetime.utcnow(),
    )
    db.add(outcome)
    db.commit()
    db.refresh(outcome)

    return OutcomeOut.model_validate(outcome)


@router.delete("/candidates/{candidate_id}/erase", status_code=status.HTTP_204_NO_CONTENT)
def erase_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> None:
    """GDPR erasure: delete all PII and resume files for a candidate.

    - Removes uploaded files from disk.
    - Clears raw_text, sections, excerpts from Resume records.
    - Nullifies candidate name → 'Deleted User', email → None.
    - Retains anonymised scores for analytics.
    - Writes an audit_log entry.
    - Requires admin role.
    """
    from app.models import Evaluation, Resume, ResumeVersion

    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if candidate is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Candidate {candidate_id} not found",
        )

    # Remove files and clear resume text
    resume_versions = (
        db.query(ResumeVersion).filter(ResumeVersion.candidate_id == candidate_id).all()
    )
    for rv in resume_versions:
        # Delete physical file
        if rv.file_path and os.path.exists(rv.file_path):
            try:
                os.remove(rv.file_path)
            except OSError:
                pass

        # Clear parsed content
        resume = db.query(Resume).filter(Resume.id == rv.id).first()
        if resume is not None:
            resume.raw_text = None
            resume.sections = None

            # Clear excerpts in evaluations linked to this resume
            evals = db.query(Evaluation).filter(Evaluation.resume_id == resume.id).all()
            for ev in evals:
                ev.excerpts = None

        # Clear file path + simhash on the version record
        rv.file_path = ""
        rv.filename = "deleted"
        rv.simhash = None

    # Anonymise candidate
    candidate.name = "Deleted User"
    candidate.email = None
    candidate.current_version_id = None

    # Audit log
    audit = AuditLog(
        user_id=current_user.id,
        action="gdpr_erase",
        target_type="candidate",
        target_id=candidate_id,
        timestamp=datetime.utcnow(),
    )
    db.add(audit)
    db.commit()

import json
import logging
import uuid
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.deps import get_current_user, get_db
from app.models import Candidate, Evaluation, JobRole, JobRoleSkill, Resume, ResumeVersion, Shortlist, Skill, User
from app.models import _utcnow
from app.schemas import BulkRerunRequest, EvaluationRequest, EvaluationResponse, ScoringWeights, SendNextStepsRequest
from app.services.reasoning import generate_interview_questions, generate_reasoning_summary
from app.services.scorer import ScoreResult, score_requirements, score_resume
from app.services.segmenter import Section
from app.services.tfidf_filter import compute_relevance as tfidf_compute_relevance

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/evaluate", tags=["evaluate"])


# ---------------------------------------------------------------------------
# Auto-enrichment helper (GitHub + LinkedIn)
# ---------------------------------------------------------------------------

def _extract_project_names(sections: List[Section]) -> List[str]:
    """Return likely project names from the resume's projects section."""
    import re
    names: List[str] = []
    for sec in sections:
        if sec.type not in ("projects", "project"):
            continue
        for line in sec.text.splitlines():
            line = line.strip()
            if not line or len(line) < 4 or len(line) > 80:
                continue
            if line.startswith(("•", "-", "*", "–")):
                continue
            if re.search(r'\d{4}', line):   # date lines
                continue
            names.append(line)
    return names[:20]   # cap to avoid noise


def _github_score_modifier(github_summary: dict, project_names: List[str]) -> float:
    """Return a score modifier (-10 … +10) based on GitHub activity and project cross-check."""
    if github_summary.get("error"):
        return 0.0

    activity = github_summary.get("activity_score", 0)
    relevant = len(github_summary.get("relevant_repos", []))
    repo_names_lower = {
        (r.get("name") or "").lower()
        for r in github_summary.get("relevant_repos", [])
    }
    # Broader: all repos returned by the analysis
    all_repos_lower = repo_names_lower  # relevant_repos already filtered by JD skills

    modifier = 0.0

    # Activity bonus/penalty
    if activity >= 70:
        modifier += 4.0
    elif activity >= 50:
        modifier += 2.0
    elif activity >= 30:
        modifier += 1.0
    elif activity < 15:
        modifier -= 2.0

    # JD-relevant repos bonus
    if relevant >= 3:
        modifier += 3.0
    elif relevant >= 1:
        modifier += 1.5

    # Project cross-check: projects on resume but NOT on GitHub → penalty
    if project_names:
        import re
        unverified = 0
        for proj in project_names:
            proj_words = set(re.sub(r'[^a-z0-9 ]', '', proj.lower()).split())
            found = any(
                proj_words & set(re.sub(r'[^a-z0-9 ]', '', rn).split())
                for rn in all_repos_lower
            )
            if not found:
                unverified += 1
        if unverified >= 3:
            modifier -= 3.0
        elif unverified == len(project_names) and len(project_names) >= 2:
            modifier -= 2.0

    return max(-10.0, min(10.0, modifier))


def _run_auto_enrichment(
    candidate: "Candidate",
    job_role_id: int,
    sections: List[Section],
    db: Session,
) -> float:
    """Run GitHub and LinkedIn enrichment if not already cached. Returns score modifier."""
    modifier = 0.0
    project_names = _extract_project_names(sections)

    # ── GitHub ────────────────────────────────────────────────────────────────
    if candidate.github_url:
        github_summary: Optional[dict] = None
        if not candidate.github_summary:
            try:
                from app.services.github_analyzer import analyze_github_profile
                jd_skills = [
                    s.name for s in (
                        db.query(Skill)
                        .join(JobRoleSkill, Skill.id == JobRoleSkill.skill_id)
                        .filter(JobRoleSkill.job_role_id == job_role_id)
                        .all()
                    )
                ]
                github_summary = analyze_github_profile(
                    github_url=candidate.github_url,
                    jd_skills=jd_skills,
                    timeout=20,
                )
                candidate.github_summary = json.dumps(github_summary)
                sources = json.loads(candidate.enrichment_sources or "[]")
                if "github" not in sources:
                    sources.append("github")
                candidate.enrichment_sources = json.dumps(sources)
                db.commit()
                logger.info(
                    "Auto GitHub enrichment done for candidate %d: activity=%s",
                    candidate.id, github_summary.get("activity_score"),
                )
            except Exception as exc:
                logger.warning("Auto GitHub enrichment failed for candidate %d: %s", candidate.id, exc)
        else:
            try:
                github_summary = json.loads(candidate.github_summary)
            except Exception:
                pass

        if github_summary:
            modifier += _github_score_modifier(github_summary, project_names)

    # ── LinkedIn ──────────────────────────────────────────────────────────────
    if candidate.linkedin_url and not candidate.linkedin_data:
        try:
            from app.services.linkedin_enricher import enrich_from_linkedin
            from app.services.flag_handler import process_consistency_flags
            enrichment = enrich_from_linkedin(
                linkedin_url=candidate.linkedin_url,
                timeout=15,
            )
            sources = json.loads(candidate.enrichment_sources or "[]")
            if "linkedin" not in sources:
                sources.append("linkedin")
            candidate.enrichment_sources = json.dumps(sources)
            if not enrichment.get("error"):
                review_flags, needs_review = process_consistency_flags(
                    enrichment.get("consistency_flags", [])
                )
                candidate.linkedin_data = json.dumps(enrichment)
                candidate.consistency_flags = json.dumps(review_flags)
                if needs_review:
                    candidate.needs_manual_review = True
            db.commit()
            logger.info("Auto LinkedIn enrichment done for candidate %d", candidate.id)
        except Exception as exc:
            logger.warning("Auto LinkedIn enrichment failed for candidate %d: %s", candidate.id, exc)

    return modifier


def _load_sections(resume: Resume) -> List[Section]:
    """Deserialise sections JSON from the Resume model."""
    if not resume.sections:
        return []
    raw = json.loads(resume.sections)
    return [
        Section(
            type=s["type"],
            title=s.get("title", ""),
            start_line=s.get("start_line", 0),
            end_line=s.get("end_line", 0),
            text=s.get("text", ""),
            confidence=s.get("confidence", 1.0),
            weight_multiplier=s.get("weight_multiplier", 0.5),
        )
        for s in raw
    ]


def _save_experience_filtered(
    resume_id: int,
    job_role_id: int,
    reason: str,
    db: Session,
) -> None:
    """Persist a Stage-0-filtered evaluation (experience mismatch) without running any scorer."""
    existing: Optional[Evaluation] = (
        db.query(Evaluation)
        .filter(Evaluation.resume_id == resume_id, Evaluation.job_role_id == job_role_id)
        .first()
    )
    summary = f"Stage 0 (Experience) pre-filter: {reason}. Evaluation skipped."
    if existing is not None:
        if existing.eval_status in ("experience_filtered", "tfidf_filtered", "queued", None):
            existing.total_score = 0.0
            existing.project_score = 0.0
            existing.skill_score = 0.0
            existing.education_score = 0.0
            existing.eval_status = "experience_filtered"
            existing.reasoning_summary = summary
            existing.evaluated_at = _utcnow()
    else:
        db.add(Evaluation(
            resume_id=resume_id,
            job_role_id=job_role_id,
            total_score=0.0,
            project_score=0.0,
            skill_score=0.0,
            education_score=0.0,
            eval_status="experience_filtered",
            reasoning_summary=summary,
            evaluated_at=_utcnow(),
        ))
    db.commit()


def _save_tfidf_filtered(
    resume_id: int,
    job_role_id: int,
    tfidf_score: float,
    matched_keywords: list,
    db: Session,
) -> None:
    """Persist a Stage-1-filtered evaluation without running the LLM scorer."""
    existing: Optional[Evaluation] = (
        db.query(Evaluation)
        .filter(Evaluation.resume_id == resume_id, Evaluation.job_role_id == job_role_id)
        .first()
    )
    summary = (
        f"Stage 1 (TF-IDF) pre-filter: relevance score {tfidf_score:.3f} is below "
        f"the configured threshold. LLM evaluation skipped. "
        f"Keyword matches found: {', '.join(matched_keywords) if matched_keywords else 'none'}."
    )
    if existing is not None:
        # Only overwrite if the previous record was also filtered or queued
        if existing.eval_status in ("tfidf_filtered", "queued", None):
            existing.total_score = round(tfidf_score * 20, 1)  # 0-20 range
            existing.project_score = 0.0
            existing.skill_score = 0.0
            existing.education_score = 0.0
            existing.tfidf_score = tfidf_score
            existing.eval_status = "tfidf_filtered"
            existing.reasoning_summary = summary
            existing.evaluated_at = _utcnow()
    else:
        db.add(Evaluation(
            resume_id=resume_id,
            job_role_id=job_role_id,
            total_score=round(tfidf_score * 20, 1),
            project_score=0.0,
            skill_score=0.0,
            education_score=0.0,
            tfidf_score=tfidf_score,
            eval_status="tfidf_filtered",
            reasoning_summary=summary,
            evaluated_at=_utcnow(),
        ))
    db.commit()


def _queue_evaluation(resume_id: int, job_role_id: int, db: Session) -> None:
    """Create a placeholder Evaluation with eval_status='queued' without scoring."""
    existing: Optional[Evaluation] = (
        db.query(Evaluation)
        .filter(Evaluation.resume_id == resume_id, Evaluation.job_role_id == job_role_id)
        .first()
    )
    if existing is None:
        db.add(Evaluation(
            resume_id=resume_id,
            job_role_id=job_role_id,
            total_score=0.0,
            project_score=0.0,
            skill_score=0.0,
            education_score=0.0,
            evaluated_at=_utcnow(),
            eval_status="queued",
        ))
        db.commit()
    elif existing.eval_status == "queued":
        pass  # already queued, nothing to do
    # if it has a real score, don't downgrade it to queued


def _run_evaluation(
    resume_id: int,
    job_role_id: int,
    weights: Optional[ScoringWeights],
    db: Session,
) -> None:
    """Core evaluation logic — runs synchronously inside a background task."""
    resume = db.query(Resume).filter(Resume.id == resume_id).first()
    job_role = (
        db.query(JobRole)
        .options(joinedload(JobRole.requirements))
        .filter(JobRole.id == job_role_id)
        .first()
    )

    if resume is None or job_role is None:
        return

    # Honour intake pause: queue the application and return without scoring
    if job_role.intake_paused:
        _queue_evaluation(resume_id, job_role_id, db)
        return

    # ── Stage 0: Experience pre-filter ───────────────────────────────────────
    # Only filter when the candidate's data is actually known (not None).
    # Unknown experience is given the benefit of the doubt and passed through.
    _candidate = resume.version.candidate if resume.version else None
    if _candidate is not None:
        # Years-of-experience check
        if (
            job_role.min_experience
            and _candidate.years_experience is not None
            and _candidate.years_experience < job_role.min_experience
        ):
            reason = (
                f"Candidate has {_candidate.years_experience:.1f} yr(s) experience "
                f"but the role requires {job_role.min_experience}+ yr(s)"
            )
            logger.info(
                "resume_id=%d job_role_id=%d Stage-0 filtered (experience): %s",
                resume_id, job_role_id, reason,
            )
            _save_experience_filtered(resume_id, job_role_id, reason, db)
            return
        # Experience-level check (junior / mid / senior / executive / intern)
        if job_role.filter_experience_levels:
            allowed_levels = [
                lvl.strip()
                for lvl in job_role.filter_experience_levels.split(",")
                if lvl.strip()
            ]
            if (
                allowed_levels
                and _candidate.experience_level
                and _candidate.experience_level not in allowed_levels
            ):
                reason = (
                    f"Candidate level '{_candidate.experience_level}' is not in "
                    f"allowed levels: {', '.join(allowed_levels)}"
                )
                logger.info(
                    "resume_id=%d job_role_id=%d Stage-0 filtered (level): %s",
                    resume_id, job_role_id, reason,
                )
                _save_experience_filtered(resume_id, job_role_id, reason, db)
                return
        # Graduation year range check — both bounds are optional (None = unbounded)
        min_grad = getattr(job_role, "min_graduation_year", None)
        max_grad = getattr(job_role, "max_graduation_year", None)
        if _candidate.graduation_year is not None:
            if min_grad and _candidate.graduation_year < min_grad:
                reason = (
                    f"Candidate graduated in {_candidate.graduation_year} "
                    f"but role requires graduation year {min_grad} or later"
                )
                logger.info(
                    "resume_id=%d job_role_id=%d Stage-0 filtered (grad year < min): %s",
                    resume_id, job_role_id, reason,
                )
                _save_experience_filtered(resume_id, job_role_id, reason, db)
                return
            if max_grad and _candidate.graduation_year > max_grad:
                reason = (
                    f"Candidate graduated in {_candidate.graduation_year} "
                    f"but role is open only to candidates who graduated by {max_grad}"
                )
                logger.info(
                    "resume_id=%d job_role_id=%d Stage-0 filtered (grad year > max): %s",
                    resume_id, job_role_id, reason,
                )
                _save_experience_filtered(resume_id, job_role_id, reason, db)
                return

    # Resolve weights (prefer request-level override, then job role, then defaults)
    if weights is not None:
        w = weights
    else:
        w = ScoringWeights(
            projects=job_role.weight_projects,
            skills=job_role.weight_skills,
            education=job_role.weight_education,
        )

    # Load skills for job role
    jrs_rows: List[JobRoleSkill] = (
        db.query(JobRoleSkill)
        .filter(JobRoleSkill.job_role_id == job_role_id)
        .all()
    )
    skill_ids = [jrs.skill_id for jrs in jrs_rows]
    skills: List[Skill] = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()

    # (Removed early exit)
    # if not skills:
    #     return

    sections = _load_sections(resume)
    threshold = job_role.cosine_threshold

    # ── Stage 1: TF-IDF pre-filter ───────────────────────────────────────────
    skill_names = [s.name for s in skills]
    tfidf_score, tfidf_matched = tfidf_compute_relevance(
        resume_text=resume.raw_text or "",
        skill_names=skill_names,
        jd_description=job_role.description,
    )
    tfidf_threshold = float(getattr(job_role, "tfidf_threshold", 0.0) or 0.0)
    if tfidf_threshold > 0.0 and tfidf_score < tfidf_threshold:
        logger.info(
            "resume_id=%d job_role_id=%d Stage-1 filtered: tfidf=%.4f < threshold=%.4f",
            resume_id, job_role_id, tfidf_score, tfidf_threshold,
        )
        _save_tfidf_filtered(resume_id, job_role_id, tfidf_score, tfidf_matched, db)
        return
    # ── Stage 2: LLM / keyword deep evaluation ───────────────────────────────

    # Parse preferred_majors JSON stored on the job role
    preferred_majors: list = []
    if job_role.preferred_majors:
        try:
            preferred_majors = json.loads(job_role.preferred_majors)
        except (json.JSONDecodeError, ValueError):
            pass

    if job_role.requirements:
        result: ScoreResult = score_requirements(
            sections=sections,
            requirements=job_role.requirements,
            cosine_threshold=threshold,
            jd_description=job_role.description,
            min_degree=job_role.min_degree,
            preferred_majors=preferred_majors,
        )
    else:
        result = score_resume(
            sections=sections,
            required_skills=skills,
            weights=w,
            cosine_threshold=threshold,
            resume_id=resume_id,
            jd_description=job_role.description,
            min_degree=job_role.min_degree,
            preferred_majors=preferred_majors,
        )

    skills_matched_json = json.dumps([
        {
            "skill_name": sm.skill_name,
            "score": sm.score,
            "confidence": sm.confidence,
            "best_section": sm.best_section,
            "excerpt": sm.excerpt,
        }
        for sm in result.skills_matched
    ])
    excerpts_json = json.dumps([result.top_excerpt] if result.top_excerpt else [])
    requirements_breakdown_json: Optional[str] = None
    req_breakdown_dicts: list = []
    if result.requirements_breakdown:
        req_breakdown_dicts = [
            {
                "requirement_id": rb.requirement_id,
                "label": rb.label,
                "req_type": rb.req_type,
                "weight": rb.weight,
                "score": rb.score,
                "evidence": rb.evidence,
            }
            for rb in result.requirements_breakdown
        ]
        requirements_breakdown_json = json.dumps(req_breakdown_dicts)

    # ── Auto enrichment (GitHub / LinkedIn) + score modifier ─────────────────
    candidate = resume.version.candidate if resume.version else None
    github_modifier = 0.0
    if candidate is not None:
        try:
            github_modifier = _run_auto_enrichment(candidate, job_role_id, sections, db)
        except Exception as exc:
            logger.warning("Auto enrichment raised unexpectedly for candidate %d: %s",
                           candidate.id if candidate else -1, exc)

    # Apply modifier (clamp 0–100)
    adjusted_total = max(0.0, min(100.0, result.total + github_modifier))
    if github_modifier != 0.0:
        logger.info(
            "resume_id=%d job_role_id=%d GitHub modifier=%.1f  %s%.1f → %.1f",
            resume_id, job_role_id, github_modifier,
            "+" if github_modifier >= 0 else "", github_modifier,
            adjusted_total,
        )

    # Generate reasoning summary (LLM when available, rule-based fallback)
    candidate_name = candidate.name if candidate else ""
    try:
        reasoning_summary = generate_reasoning_summary(
            candidate_name=candidate_name,
            job_title=job_role.title,
            jd_description=job_role.description,
            total_score=adjusted_total,
            project_score=result.project_score,
            skill_score=result.skill_score,
            education_score=result.education_score,
            matched_skills=[sm.skill_name for sm in result.skills_matched],
            skill_gaps=result.skill_gaps,
            jd_alignment_score=result.jd_alignment_score,
            requirements_breakdown=req_breakdown_dicts,
        )
    except Exception:
        reasoning_summary = None

    # NOTE: Interview prep question generation is disabled (commented out).
    # Uncomment the block below to re-enable it.
    # # Generate interview prep questions
    # interview_questions_json: Optional[str] = None
    # try:
    #     iq_skill_gaps = [s.name for s in skills if s.name.lower() not in {sm.skill_name.lower() for sm in result.skills_matched}]
    #     questions = generate_interview_questions(
    #         job_title=job_role.title,
    #         jd_description=job_role.description,
    #         total_score=adjusted_total,
    #         matched_skills=[sm.skill_name for sm in result.skills_matched],
    #         skill_gaps=iq_skill_gaps,
    #         requirements_breakdown=req_breakdown_dicts,
    #     )
    #     interview_questions_json = json.dumps(questions)
    # except Exception as exc:
    #     logger.warning("Interview question generation failed for resume_id=%d: %s", resume_id, exc)
    interview_questions_json: Optional[str] = None

    # Upsert evaluation (insert or update if already exists)
    existing: Optional[Evaluation] = (
        db.query(Evaluation)
        .filter(
            Evaluation.resume_id == resume_id,
            Evaluation.job_role_id == job_role_id,
        )
        .first()
    )

    if existing is not None:
        existing.total_score = adjusted_total
        existing.project_score = result.project_score
        existing.skill_score = result.skill_score
        existing.education_score = result.education_score
        existing.skills_matched = skills_matched_json
        existing.excerpts = excerpts_json
        existing.requirements_breakdown = requirements_breakdown_json
        existing.reasoning_summary = reasoning_summary
        existing.interview_questions = interview_questions_json
        existing.evaluated_at = _utcnow()
        existing.eval_status = None   # clear queue flag — now a real score
        existing.tfidf_score = tfidf_score
    else:
        evaluation = Evaluation(
            resume_id=resume_id,
            job_role_id=job_role_id,
            total_score=adjusted_total,
            project_score=result.project_score,
            skill_score=result.skill_score,
            education_score=result.education_score,
            skills_matched=skills_matched_json,
            excerpts=excerpts_json,
            requirements_breakdown=requirements_breakdown_json,
            reasoning_summary=reasoning_summary,
            interview_questions=interview_questions_json,
            evaluated_at=_utcnow(),
            tfidf_score=tfidf_score,
        )
        db.add(evaluation)

    db.commit()

    # Auto-shortlist when score meets or exceeds the minimum fit threshold
    if job_role.min_fit_score is not None and adjusted_total >= job_role.min_fit_score:
        eval_row = db.query(Evaluation).filter(
            Evaluation.resume_id == resume_id,
            Evaluation.job_role_id == job_role_id,
        ).first()
        if eval_row is not None:
            existing_sl = db.query(Shortlist).filter(Shortlist.evaluation_id == eval_row.id).first()
            if existing_sl is None:
                db.add(Shortlist(evaluation_id=eval_row.id, status='shortlisted'))
                db.commit()

    # Automated email for high-scoring candidates (only when enabled and not already sent)
    eval_row_for_email = db.query(Evaluation).filter(
        Evaluation.resume_id == resume_id,
        Evaluation.job_role_id == job_role_id,
    ).first()
    if (
        job_role.auto_email_enabled
        and result.total >= 85
        and eval_row_for_email is not None
        and eval_row_for_email.email_sent_at is None
    ):
        candidate = resume.version.candidate if resume.version else None
        if candidate and candidate.email:
            from app.services.email import CandidateEmailService
            from app.config import settings as _settings
            try:
                token = uuid.uuid4().hex
                eval_row_for_email.email_tracking_token = token
                pixel_url = f"{_settings.backend_url.rstrip('/')}/track/open/{token}" if _settings.backend_url else None
                _matched = []
                try:
                    import json as _json
                    if eval_row_for_email.skills_matched:
                        _matched = [s["skill_name"] for s in _json.loads(eval_row_for_email.skills_matched)]
                except Exception:
                    pass
                sent_ok = CandidateEmailService.send_next_steps(
                    candidate.email, candidate.name, job_role.title,
                    tracking_pixel_url=pixel_url,
                    score=eval_row_for_email.total_score,
                    matched_skills=_matched,
                )
                if sent_ok:
                    eval_row_for_email.email_sent_at = _utcnow()
                    logger.info("Auto next-steps email sent to %s for job_role_id=%d", candidate.email, job_role_id)
                else:
                    logger.info("Auto email skipped (SMTP not configured) for %s", candidate.email)
                db.commit()
            except Exception as exc:
                logger.warning("Failed to send auto-email to %s: %s", candidate.email, exc)

    # Auto-pause check (6.1): trigger intake pause when shortlist target is reached
    _check_auto_pause(job_role, db)


def _check_auto_pause(job_role: "JobRole", db: Session) -> None:
    """Trigger intake pause when qualified candidate count hits the shortlist_target."""
    if job_role.intake_paused:
        return
    if job_role.shortlist_target is None or job_role.min_fit_score is None:
        return

    qualified = (
        db.query(Evaluation)
        .filter(
            Evaluation.job_role_id == job_role.id,
            Evaluation.total_score >= job_role.min_fit_score,
        )
        .count()
    )

    if qualified >= job_role.shortlist_target:
        job_role.intake_paused = True
        db.commit()
        # Send alert email to the job creator if available
        if job_role.creator and job_role.creator.email:
            from app.services.email import _send_email
            subject = f"Shortlist target reached for {job_role.title}"
            body = (
                f"Your shortlist target of {job_role.shortlist_target} qualified candidates "
                f"has been reached for {job_role.title}. "
                f"New applications will be queued but not auto-processed. "
                f"Review your shortlist and reopen intake when ready."
            )
            try:
                _send_email(job_role.creator.email, subject, body)
            except Exception as exc:
                logger.warning("Failed to send shortlist-target email: %s", exc)


def _background_evaluate(
    resume_ids: List[int],
    job_role_id: int,
    weights: Optional[ScoringWeights],
) -> None:
    """Background task that opens its own DB session to run evaluations."""
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        for resume_id in resume_ids:
            try:
                _run_evaluation(resume_id, job_role_id, weights, db)
            except Exception as exc:
                logger.warning(
                    "Evaluation failed for resume_id=%d job_role_id=%d: %s",
                    resume_id, job_role_id, exc,
                )
                db.rollback()  # reset aborted transaction state before next resume
    finally:
        db.close()


def _background_bulk_rerun(job_role_id: int) -> None:
    """Re-scores all resumes for a given job role."""
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        # Find all evaluations for this job role to get resume ids
        evaluations: List[Evaluation] = (
            db.query(Evaluation)
            .filter(Evaluation.job_role_id == job_role_id)
            .all()
        )
        for ev in evaluations:
            try:
                _run_evaluation(ev.resume_id, job_role_id, None, db)
            except Exception as exc:
                logger.warning(
                    "Bulk rerun failed for resume_id=%d job_role_id=%d: %s",
                    ev.resume_id, job_role_id, exc,
                )
                db.rollback()
    finally:
        db.close()


@router.post("", response_model=EvaluationResponse, status_code=status.HTTP_202_ACCEPTED)
def evaluate(
    body: EvaluationRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EvaluationResponse:
    """Queue evaluation of one or more resumes against a job role."""
    # Validate job role exists
    job_role = db.query(JobRole).filter(JobRole.id == body.job_role_id).first()
    if job_role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"JobRole {body.job_role_id} not found",
        )

    # If no resume IDs provided, select current resume versions filtered by job role criteria
    resume_ids = body.resume_ids
    if not resume_ids:
        from app.models import Candidate, ResumeVersion
        query = (
            db.query(Resume)
            .join(ResumeVersion, Resume.id == ResumeVersion.id)
            .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
            .filter(ResumeVersion.is_current.is_(True), Candidate.deleted_at.is_(None))
        )
        # Filter by min_experience — skip candidates whose years are known to be below minimum
        if job_role.min_experience:
            query = query.filter(
                (Candidate.years_experience >= job_role.min_experience)
                | Candidate.years_experience.is_(None)
            )
        # Filter by allowed experience levels (junior/mid/senior/executive)
        if job_role.filter_experience_levels:
            allowed = [
                lvl.strip()
                for lvl in job_role.filter_experience_levels.split(",")
                if lvl.strip()
            ]
            if allowed:
                query = query.filter(
                    Candidate.experience_level.in_(allowed)
                    | Candidate.experience_level.is_(None)
                )
        resume_ids = [r.id for r in query.all()]

    if not resume_ids:
        return EvaluationResponse(job_id="none", queued_count=0)

    job_id = str(uuid.uuid4())
    background_tasks.add_task(
        _background_evaluate,
        resume_ids=resume_ids,
        job_role_id=body.job_role_id,
        weights=body.weights,
    )

    return EvaluationResponse(job_id=job_id, queued_count=len(resume_ids))


@router.post("/rerun", response_model=EvaluationResponse, status_code=status.HTTP_202_ACCEPTED)
@router.post("/bulk-rerun", response_model=EvaluationResponse, status_code=status.HTTP_202_ACCEPTED)
def bulk_rerun(
    body: BulkRerunRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EvaluationResponse:
    """Re-score all existing evaluations for a job role in the background."""
    job_role = db.query(JobRole).filter(JobRole.id == body.job_role_id).first()
    if job_role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"JobRole {body.job_role_id} not found",
        )

    count = (
        db.query(Evaluation)
        .filter(Evaluation.job_role_id == body.job_role_id)
        .count()
    )

    job_id = str(uuid.uuid4())
    background_tasks.add_task(_background_bulk_rerun, job_role_id=body.job_role_id)

    return EvaluationResponse(job_id=job_id, queued_count=count)


@router.post("/{evaluation_id}/send-next-steps", status_code=status.HTTP_200_OK)
def send_next_steps_email(
    evaluation_id: int,
    body: SendNextStepsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Admin-triggered next-steps email for a candidate.

    Works even when auto_email_enabled is False on the job role.
    Will not re-send unless body.force=True.
    """
    ev = (
        db.query(Evaluation)
        .options(
            joinedload(Evaluation.resume).joinedload(Resume.version).joinedload(ResumeVersion.candidate),
            joinedload(Evaluation.job_role),
        )
        .filter(Evaluation.id == evaluation_id)
        .first()
    )
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Evaluation {evaluation_id} not found")

    rv = ev.resume.version if ev.resume else None
    candidate = rv.candidate if rv else None

    if not candidate or not candidate.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Candidate has no email address on file")

    if ev.email_sent_at is not None and not body.force:
        return {
            "sent": False,
            "message": f"Email already sent at {ev.email_sent_at.isoformat()}. Pass force=true to resend.",
        }

    from app.services.email import CandidateEmailService
    from app.config import settings as _settings
    try:
        token = uuid.uuid4().hex
        ev.email_tracking_token = token
        pixel_url = f"{_settings.backend_url.rstrip('/')}/track/open/{token}" if _settings.backend_url else None
        _matched = []
        try:
            import json as _json
            if ev.skills_matched:
                _matched = [s["skill_name"] for s in _json.loads(ev.skills_matched)]
        except Exception:
            pass
        sent_ok = CandidateEmailService.send_next_steps(
            candidate.email, candidate.name, ev.job_role.title,
            db=db, tracking_pixel_url=pixel_url,
            score=ev.total_score,
            matched_skills=_matched,
        )
        if not sent_ok:
            return {"sent": False, "message": "SMTP is not configured — email not sent"}
        ev.email_sent_at = _utcnow()
        db.commit()
        logger.info("Manual next-steps email sent to %s by user %d", candidate.email, current_user.id)
        return {"sent": True, "message": f"Next-steps email sent to {candidate.email}"}
    except Exception as exc:
        logger.error("Failed to send next-steps email to %s: %s", candidate.email, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"Failed to send email: {exc}") from exc


@router.post("/bulk-send-next-steps", status_code=status.HTTP_200_OK)
def bulk_send_next_steps(
    job_role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Send next-steps email to all shortlisted candidates for a job role
    who haven't received one yet.

    Only processes evaluations whose latest shortlist status is 'shortlisted'
    and whose email_sent_at is NULL.
    """
    from app.models import Shortlist, Candidate
    from app.services.email import CandidateEmailService

    # Find all shortlisted evaluations for this role without a sent email
    shortlisted_eval_ids = (
        db.query(Shortlist.evaluation_id)
        .join(Evaluation, Evaluation.id == Shortlist.evaluation_id)
        .filter(
            Evaluation.job_role_id == job_role_id,
            Shortlist.status == "shortlisted",
            Evaluation.email_sent_at.is_(None),
        )
        .distinct()
        .all()
    )
    eval_ids = [row[0] for row in shortlisted_eval_ids]

    if not eval_ids:
        return {"sent": 0, "skipped": 0, "errors": 0, "message": "No eligible candidates found"}

    evals = (
        db.query(Evaluation)
        .options(
            joinedload(Evaluation.resume).joinedload(Resume.version).joinedload(ResumeVersion.candidate),
            joinedload(Evaluation.job_role),
        )
        .filter(Evaluation.id.in_(eval_ids))
        .all()
    )

    sent = skipped = errors = 0
    for ev in evals:
        rv = ev.resume.version if ev.resume else None
        candidate = rv.candidate if rv else None
        if not candidate or not candidate.email:
            skipped += 1
            continue
        try:
            _matched = []
            try:
                import json as _json
                if ev.skills_matched:
                    _matched = [s["skill_name"] for s in _json.loads(ev.skills_matched)]
            except Exception:
                pass
            sent_ok = CandidateEmailService.send_next_steps(
                candidate.email, candidate.name, ev.job_role.title,
                db=db, score=ev.total_score, matched_skills=_matched,
            )
            if sent_ok:
                ev.email_sent_at = _utcnow()
                sent += 1
            else:
                skipped += 1  # SMTP not configured
        except Exception as exc:
            logger.warning("Bulk email failed for candidate %s: %s", candidate.email, exc)
            errors += 1

    db.commit()
    logger.info(
        "Bulk next-steps emails for job_role_id=%d: sent=%d skipped=%d errors=%d by user=%d",
        job_role_id, sent, skipped, errors, current_user.id,
    )
    return {
        "sent": sent,
        "skipped": skipped,
        "errors": errors,
        "message": f"Sent {sent} email{'s' if sent != 1 else ''}. {skipped} skipped (no email). {errors} failed.",
    }


@router.get("/status")
def evaluation_status(
    job_role_id: int = Query(..., description="Job role to check progress for"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    """Return evaluation progress counts for a job role.

    Useful for polling after triggering a batch evaluation run.
    Returns counts per status bucket so the frontend can show a progress bar.
    """
    rows = (
        db.query(Evaluation.eval_status, func.count(Evaluation.id).label("cnt"))
        .filter(Evaluation.job_role_id == job_role_id)
        .group_by(Evaluation.eval_status)
        .all()
    )
    counts: dict[str | None, int] = {r.eval_status: r.cnt for r in rows}
    total = sum(counts.values())
    # eval_status=None means a fully scored evaluation (normal completion)
    scored = counts.get(None, 0)
    queued = counts.get("queued", 0)
    processing = counts.get("processing", 0)
    filtered = sum(v for k, v in counts.items() if k and k.endswith("_filtered"))
    error_count = counts.get("error", 0)
    return {
        "job_role_id": job_role_id,
        "total": total,
        "scored": scored,
        "queued": queued,
        "processing": processing,
        "filtered": filtered,
        "error": error_count,
        "in_progress": (queued + processing) > 0,
    }

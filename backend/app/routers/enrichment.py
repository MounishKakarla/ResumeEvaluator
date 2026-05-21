"""Enrichment API routes.

POST /enrich/{candidate_id}/github   — run GitHub analysis
POST /enrich/{candidate_id}/linkedin — run LinkedIn enrichment
GET  /enrich/{candidate_id}          — return enrichment data for a candidate
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import Candidate, JobRole, JobRoleSkill, Resume, ResumeVersion, Skill, User

router = APIRouter(prefix="/enrich", tags=["enrichment"])


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class GitHubEnrichRequest(BaseModel):
    github_url: Optional[str] = None    # override URL; uses candidate.github_url if None
    job_role_id: Optional[int] = None   # for JD skill matching


class LinkedInEnrichRequest(BaseModel):
    linkedin_url: Optional[str] = None  # override URL; uses candidate.linkedin_url if None


class ProjectAnalysisRequest(BaseModel):
    job_role_id: int
    github_url: Optional[str] = None      # override candidate URL
    portfolio_url: Optional[str] = None   # override candidate URL
    force_refresh: bool = False           # re-analyse even if cached


class EnrichmentOut(BaseModel):
    candidate_id: int
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_summary: Optional[Dict[str, Any]] = None
    linkedin_data: Optional[Dict[str, Any]] = None
    portfolio_summary: Optional[Dict[str, Any]] = None
    project_analysis: Optional[Dict[str, Any]] = None
    consistency_flags: List[Dict[str, Any]] = []
    needs_manual_review: bool = False
    enrichment_sources: List[str] = []
    error: Optional[str] = None   # non-fatal warning (e.g. LinkedIn blocked scraping)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_resume_sections(candidate: Candidate, db: Session) -> list:
    """Return parsed sections list for the candidate's current resume."""
    if not candidate.current_version_id:
        return []
    rv = db.query(ResumeVersion).filter(ResumeVersion.id == candidate.current_version_id).first()
    if not rv:
        return []
    resume = db.query(Resume).filter(Resume.id == rv.id).first()
    if not resume or not resume.sections:
        return []
    from app.services.segmenter import Section
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


def _get_jd_skills(job_role_id: int, db: Session) -> List[str]:
    """Return skill names for a given job role."""
    jrs_rows = db.query(JobRoleSkill).filter(JobRoleSkill.job_role_id == job_role_id).all()
    skill_ids = [j.skill_id for j in jrs_rows]
    skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()
    return [s.name for s in skills]


def _extract_resume_experience(sections: list) -> list:
    """Rough extraction of experience entries from resume sections text."""
    import re
    entries = []
    for sec in sections:
        if sec.type not in ("experience",):
            continue
        lines = sec.text.splitlines()
        current: dict = {}
        for line in lines:
            line = line.strip()
            if not line:
                continue
            # Detect date range patterns like "Jan 2018 – Mar 2022"
            date_match = re.search(
                r'((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4})'
                r'\s*[–\-—]\s*'
                r'((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|present|current)',
                line,
                re.IGNORECASE,
            )
            if date_match:
                current["start_date_raw"] = date_match.group(1)
                current["end_date_raw"] = date_match.group(2)
            elif len(line) < 80 and not line.startswith(("•", "-", "*")):
                # Likely a company / title line
                if "company" not in current:
                    current["company"] = line
                elif "title" not in current:
                    current["title"] = line

        if current.get("company"):
            entries.append({
                "company": current.get("company"),
                "title": current.get("title"),
                "start_date": None,
                "end_date": None,
            })
    return entries


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/{candidate_id}/github", response_model=EnrichmentOut)
def enrich_github(
    candidate_id: int,
    body: GitHubEnrichRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EnrichmentOut:
    """Run GitHub profile analysis for a candidate and persist the summary."""
    from app.services.github_analyzer import analyze_github_profile

    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")

    github_url = body.github_url or candidate.github_url
    if not github_url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No GitHub URL available for this candidate",
        )

    # Save URL on candidate if supplied in request
    if body.github_url and not candidate.github_url:
        candidate.github_url = body.github_url

    jd_skills = _get_jd_skills(body.job_role_id, db) if body.job_role_id else []

    # Existing skills from candidate profile sections
    sections = _get_resume_sections(candidate, db)
    existing_skills = [s.text for s in sections if s.type == "skills"]

    summary = analyze_github_profile(
        github_url=github_url,
        jd_skills=jd_skills,
        existing_skills=existing_skills,
    )

    if summary.get("error"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"GitHub API error: {summary['error']}",
        )

    candidate.github_summary = json.dumps(summary)
    sources = json.loads(candidate.enrichment_sources or "[]")
    if "github" not in sources:
        sources.append("github")
    candidate.enrichment_sources = json.dumps(sources)
    db.commit()

    return _build_enrichment_out(candidate)


@router.post("/{candidate_id}/linkedin", response_model=EnrichmentOut)
def enrich_linkedin(
    candidate_id: int,
    body: LinkedInEnrichRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EnrichmentOut:
    """Run LinkedIn enrichment for a candidate and persist consistency flags."""
    from app.services.flag_handler import process_consistency_flags
    from app.services.linkedin_enricher import enrich_from_linkedin

    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")

    linkedin_url = body.linkedin_url or candidate.linkedin_url
    if not linkedin_url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No LinkedIn URL available for this candidate",
        )

    if body.linkedin_url and not candidate.linkedin_url:
        candidate.linkedin_url = body.linkedin_url

    sections = _get_resume_sections(candidate, db)
    resume_experience = _extract_resume_experience(sections)

    enrichment = enrich_from_linkedin(
        linkedin_url=linkedin_url,
        resume_experience=resume_experience,
    )

    scrape_error: Optional[str] = enrichment.get("error")

    # Always save the URL even when scraping is blocked
    sources = json.loads(candidate.enrichment_sources or "[]")
    if "linkedin" not in sources:
        sources.append("linkedin")
    candidate.enrichment_sources = json.dumps(sources)

    if scrape_error:
        # LinkedIn blocked scraping — persist URL, return gracefully without 502
        db.commit()
        return _build_enrichment_out(candidate, error=scrape_error)

    review_flags, needs_review = process_consistency_flags(
        enrichment.get("consistency_flags", [])
    )

    candidate.linkedin_data = json.dumps(enrichment)
    candidate.consistency_flags = json.dumps(review_flags)
    candidate.needs_manual_review = needs_review
    db.commit()

    if needs_review:
        from app.services.email import send_manual_review_alert
        try:
            send_manual_review_alert(
                recruiter_email=current_user.email,
                candidate_name=candidate.name,
                flags=review_flags,
            )
        except Exception:
            pass  # email failure must not break the enrichment response

    return _build_enrichment_out(candidate)


@router.get("/{candidate_id}", response_model=EnrichmentOut)
def get_enrichment(
    candidate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EnrichmentOut:
    """Return stored enrichment data for a candidate."""
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    return _build_enrichment_out(candidate)


@router.post("/{candidate_id}/portfolio", response_model=EnrichmentOut)
def enrich_portfolio(
    candidate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EnrichmentOut:
    """Fetch and analyse a candidate's portfolio site. Stores result in candidate.portfolio_summary."""
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")

    url = candidate.portfolio_url
    if not url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Candidate has no portfolio URL on file")

    from app.services.portfolio_analyzer import analyze_portfolio
    summary = analyze_portfolio(url)

    candidate.portfolio_summary = json.dumps(summary)
    sources: list = json.loads(candidate.enrichment_sources) if candidate.enrichment_sources else []
    if "portfolio" not in sources:
        sources.append("portfolio")
    candidate.enrichment_sources = json.dumps(sources)
    db.commit()

    return _build_enrichment_out(candidate, error=summary.get("error"))


@router.post("/{candidate_id}/projects", response_model=EnrichmentOut)
def analyze_projects(
    candidate_id: int,
    body: ProjectAnalysisRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EnrichmentOut:
    """On-demand deep project analysis: fetch GitHub READMEs and/or portfolio, then
    score each project against the job role's required skills and requirements.

    Results are persisted in candidate.project_analysis and returned immediately.
    Pass force_refresh=true to re-analyse even when a cached result exists.
    """
    from app.services.github_analyzer import analyze_github_projects
    from app.services.portfolio_analyzer import analyze_portfolio
    from app.models import JobRoleRequirement

    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")

    job_role = db.query(JobRole).filter(JobRole.id == body.job_role_id).first()
    if job_role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job role not found")

    # Return cached result unless force_refresh requested
    if not body.force_refresh and getattr(candidate, "project_analysis", None):
        cached = json.loads(candidate.project_analysis)
        if cached.get("job_role_id") == body.job_role_id:
            return _build_enrichment_out(candidate)

    jd_skills = _get_jd_skills(body.job_role_id, db)
    requirements = db.query(JobRoleRequirement).filter(
        JobRoleRequirement.job_role_id == body.job_role_id
    ).all()
    req_dicts = [
        {"label": r.label, "description": r.description or "", "weight": r.weight}
        for r in requirements
    ]

    github_url = body.github_url or candidate.github_url
    portfolio_url = body.portfolio_url or candidate.portfolio_url

    combined_projects: List[Dict[str, Any]] = []
    errors: List[str] = []

    # ── GitHub analysis ───────────────────────────────────────────────────────
    if github_url:
        if body.github_url and not candidate.github_url:
            candidate.github_url = body.github_url

        gh_result = analyze_github_projects(
            github_url=github_url,
            jd_skills=jd_skills,
            job_requirements=req_dicts,
        )
        if gh_result.get("error"):
            errors.append(f"GitHub: {gh_result['error']}")
        else:
            combined_projects.extend(gh_result.get("projects", []))

    # ── Portfolio analysis ────────────────────────────────────────────────────
    if portfolio_url:
        if body.portfolio_url and not candidate.portfolio_url:
            candidate.portfolio_url = body.portfolio_url

        port_result = analyze_portfolio(portfolio_url)
        if port_result.get("error"):
            errors.append(f"Portfolio: {port_result['error']}")
        else:
            # Synthesise portfolio projects into the unified schema
            for snippet in port_result.get("project_snippets", []):
                snippet_lower = snippet.lower()
                matched = [s for s in jd_skills if s.lower() in snippet_lower]
                combined_projects.append({
                    "name": snippet[:60],
                    "url": portfolio_url,
                    "source": "portfolio",
                    "description": snippet,
                    "language": "",
                    "matched_skills": matched,
                    "requirement_matches": [],
                    "match_score": round(len(matched) / max(len(jd_skills), 1), 2),
                    "readme_snippet": "",
                })
            # Update portfolio_summary while we're here
            candidate.portfolio_summary = json.dumps(port_result)
            sources = json.loads(candidate.enrichment_sources or "[]")
            if "portfolio" not in sources:
                sources.append("portfolio")
            candidate.enrichment_sources = json.dumps(sources)

    # ── Aggregate ─────────────────────────────────────────────────────────────
    all_matched = set()
    for p in combined_projects:
        all_matched.update(p.get("matched_skills", []))
    unmatched = [s for s in jd_skills if s.lower() not in {x.lower() for x in all_matched}]
    overall_score = int(round(len(all_matched) / max(len(jd_skills), 1) * 100)) if jd_skills else 0

    from datetime import datetime, timezone
    analysis = {
        "job_role_id": body.job_role_id,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "projects": combined_projects,
        "overall_match_score": overall_score,
        "matched_skills": sorted(all_matched),
        "unmatched_skills": unmatched,
        "sources_used": (["github"] if github_url else []) + (["portfolio"] if portfolio_url else []),
        "errors": errors,
    }

    candidate.project_analysis = json.dumps(analysis)
    sources = json.loads(candidate.enrichment_sources or "[]")
    if "projects" not in sources:
        sources.append("projects")
    candidate.enrichment_sources = json.dumps(sources)
    db.commit()

    return _build_enrichment_out(candidate, error="; ".join(errors) if errors else None)


def _build_enrichment_out(candidate: Candidate, error: Optional[str] = None) -> EnrichmentOut:
    return EnrichmentOut(
        candidate_id=candidate.id,
        linkedin_url=candidate.linkedin_url,
        github_url=candidate.github_url,
        portfolio_url=candidate.portfolio_url,
        github_summary=json.loads(candidate.github_summary) if candidate.github_summary else None,
        linkedin_data=json.loads(candidate.linkedin_data) if candidate.linkedin_data else None,
        portfolio_summary=json.loads(candidate.portfolio_summary) if getattr(candidate, 'portfolio_summary', None) else None,
        project_analysis=json.loads(candidate.project_analysis) if getattr(candidate, 'project_analysis', None) else None,
        consistency_flags=json.loads(candidate.consistency_flags) if candidate.consistency_flags else [],
        needs_manual_review=candidate.needs_manual_review,
        enrichment_sources=json.loads(candidate.enrichment_sources) if candidate.enrichment_sources else [],
        error=error,
    )

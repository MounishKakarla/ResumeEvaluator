"""Analytics endpoints.

GET /analytics  — aggregated stats for a job role
"""
from __future__ import annotations

import json
import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import (
    Candidate,
    Evaluation,
    JobRoleSkill,
    Outcome,
    Resume,
    ResumeVersion,
    Shortlist,
    Skill,
    User,
)
from app.schemas import SkillMatchDetail

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["analytics"])


# ---------------------------------------------------------------------------
# Response model (inline — no separate schema file needed)
# ---------------------------------------------------------------------------

from pydantic import BaseModel


class SkillMatchRate(BaseModel):
    skill_name: str
    matched_count: int
    total: int
    match_rate: float   # 0–100


class ScoreBucket(BaseModel):
    range: str
    count: int


class DailyCount(BaseModel):
    date: str   # "YYYY-MM-DD"
    count: int


class SectionAverages(BaseModel):
    projects: float
    skills: float
    education: float


class StageFunnelItem(BaseModel):
    stage: str
    label: str
    count: int


_STAGE_ORDER = ["applied", "screening", "coding", "interview", "offer", "hired", "rejected"]
_STAGE_LABELS = {
    "applied": "Applied", "screening": "Screening", "coding": "Coding Test",
    "interview": "Interview", "offer": "Offer", "hired": "Hired", "rejected": "Rejected",
}


class AnalyticsOut(BaseModel):
    total_evaluated: int
    avg_score: float
    score_distribution: List[ScoreBucket]
    status_counts: Dict[str, int]
    skill_match_rates: List[SkillMatchRate]
    top_skill_gaps: List[str]
    section_averages: SectionAverages
    evaluations_per_day: List[DailyCount]
    needs_review_count: int
    stage_funnel: List[StageFunnelItem] = []
    experience_level_counts: Dict[str, int] = {}
    avg_score_by_level: Dict[str, float] = {}


class CalibrationBucket(BaseModel):
    range: str
    score_min: int
    score_max: int
    total: int
    hired: int
    rejected: int
    hire_rate: float   # 0–100


class ThresholdOption(BaseModel):
    threshold: float
    precision: float   # % of above-threshold candidates that were hired
    recall: float      # % of hired candidates that are above threshold
    f1: float
    candidates_above: int


class CalibrationOut(BaseModel):
    buckets: List[CalibrationBucket]
    total_with_outcomes: int
    total_hired: int
    total_rejected: int
    suggested_threshold: Optional[float]
    threshold_options: List[ThresholdOption]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("", response_model=AnalyticsOut)
def get_analytics(
    job_role_id: Optional[int] = Query(default=None),
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyticsOut:
    """Return aggregated analytics for all (or a specific) job role."""

    # ── Load scored evaluations ───────────────────────────────────────────
    q = db.query(Evaluation).filter(Evaluation.eval_status.is_(None))
    if job_role_id is not None:
        q = q.filter(Evaluation.job_role_id == job_role_id)
    evals = q.all()

    total = len(evals)

    if total == 0:
        empty_dist = [ScoreBucket(range=f"{i*10}-{i*10+10}", count=0) for i in range(10)]
        return AnalyticsOut(
            total_evaluated=0,
            avg_score=0.0,
            score_distribution=empty_dist,
            status_counts={},
            skill_match_rates=[],
            top_skill_gaps=[],
            section_averages=SectionAverages(projects=0.0, skills=0.0, education=0.0),
            evaluations_per_day=[],
            needs_review_count=0,
        )

    # ── Score distribution ────────────────────────────────────────────────
    buckets = [0] * 10
    score_sum = 0.0
    proj_sum = skills_sum = edu_sum = 0.0
    needs_review_count = 0

    for ev in evals:
        score_sum += ev.total_score
        proj_sum += ev.project_score
        skills_sum += ev.skill_score
        edu_sum += ev.education_score
        idx = min(int(ev.total_score // 10), 9)
        buckets[idx] += 1
        # Count needs_manual_review via resume→version→candidate chain
        try:
            if ev.resume and ev.resume.version and ev.resume.version.candidate:
                if ev.resume.version.candidate.needs_manual_review:
                    needs_review_count += 1
        except AttributeError:
            pass

    score_dist = [
        ScoreBucket(range=f"{i*10}-{i*10+10}", count=buckets[i])
        for i in range(10)
    ]

    # ── Status counts (latest shortlist status per evaluation) ────────────
    eval_ids = [ev.id for ev in evals]
    shortlists = (
        db.query(Shortlist)
        .filter(Shortlist.evaluation_id.in_(eval_ids))
        .all()
    )
    latest_status: Dict[int, str] = {}
    for sl in shortlists:
        existing = latest_status.get(sl.evaluation_id)
        if existing is None:
            latest_status[sl.evaluation_id] = sl.status
        # pick latest by changed_at — we loaded all, so re-compute here
    # Re-compute properly with max(changed_at)
    from collections import defaultdict
    sl_by_eval: Dict[int, list] = defaultdict(list)
    for sl in shortlists:
        sl_by_eval[sl.evaluation_id].append(sl)
    latest_status = {}
    for eid, sls in sl_by_eval.items():
        latest_status[eid] = max(sls, key=lambda s: s.changed_at).status

    status_counter: Counter = Counter()
    for ev in evals:
        st = latest_status.get(ev.id, "none")
        status_counter[st] += 1
    status_counts = dict(status_counter)

    # ── Per-skill match rates ─────────────────────────────────────────────
    skill_hit: Counter = Counter()   # skill_name → count matched
    skill_total: Counter = Counter() # skill_name → appearances in required set

    # Get required skills for job_role_id (or all roles)
    if job_role_id is not None:
        jrs_rows = db.query(JobRoleSkill).filter(JobRoleSkill.job_role_id == job_role_id).all()
        skill_ids = [j.skill_id for j in jrs_rows]
        required_skills = [s.name for s in db.query(Skill).filter(Skill.id.in_(skill_ids)).all()]
        for sname in required_skills:
            skill_total[sname] += total   # every candidate is evaluated against each
    else:
        required_skills = []

    for ev in evals:
        if not ev.skills_matched:
            continue
        try:
            matched = json.loads(ev.skills_matched)
            for sm in matched:
                skill_hit[sm.get("skill_name", "")] += 1
        except (json.JSONDecodeError, ValueError):
            pass

    if required_skills:
        skill_match_rates = [
            SkillMatchRate(
                skill_name=sname,
                matched_count=skill_hit[sname],
                total=skill_total[sname],
                match_rate=round(skill_hit[sname] / skill_total[sname] * 100, 1)
                if skill_total[sname] else 0.0,
            )
            for sname in required_skills
        ]
        skill_match_rates.sort(key=lambda x: x.match_rate)
    else:
        # No specific role — report top matched skills across all evals
        skill_match_rates = [
            SkillMatchRate(
                skill_name=sname,
                matched_count=cnt,
                total=total,
                match_rate=round(cnt / total * 100, 1),
            )
            for sname, cnt in skill_hit.most_common(20)
        ]

    top_skill_gaps = [r.skill_name for r in skill_match_rates if r.match_rate < 50][:10]

    # ── Evaluations per day (last N days) ────────────────────────────────
    cutoff = datetime.utcnow() - timedelta(days=days)
    day_counter: Counter = Counter()
    for ev in evals:
        if ev.evaluated_at >= cutoff:
            day_counter[ev.evaluated_at.strftime("%Y-%m-%d")] += 1

    # Fill in missing days with 0
    daily: List[DailyCount] = []
    for i in range(days):
        d = (datetime.utcnow() - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        daily.append(DailyCount(date=d, count=day_counter.get(d, 0)))

    # ── Stage funnel ─────────────────────────────────────────────────────
    stage_counts: Counter = Counter()
    exp_level_counts: Counter = Counter()
    exp_level_scores: dict[str, list[float]] = defaultdict(list)
    for ev in evals:
        try:
            cand = ev.resume.version.candidate if ev.resume and ev.resume.version else None
            if cand:
                stage_counts[cand.stage] += 1
                lvl = getattr(cand, "experience_level", None) or "unknown"
                exp_level_counts[lvl] += 1
                exp_level_scores[lvl].append(ev.total_score)
        except AttributeError:
            pass
    stage_funnel = [
        StageFunnelItem(stage=s, label=_STAGE_LABELS.get(s, s), count=stage_counts.get(s, 0))
        for s in _STAGE_ORDER
    ]
    avg_score_by_level = {
        lvl: round(sum(scores) / len(scores), 1)
        for lvl, scores in exp_level_scores.items()
        if scores
    }

    return AnalyticsOut(
        total_evaluated=total,
        avg_score=round(score_sum / total, 1),
        score_distribution=score_dist,
        status_counts=status_counts,
        skill_match_rates=skill_match_rates,
        top_skill_gaps=top_skill_gaps,
        section_averages=SectionAverages(
            projects=round(proj_sum / total, 1),
            skills=round(skills_sum / total, 1),
            education=round(edu_sum / total, 1),
        ),
        evaluations_per_day=daily,
        needs_review_count=needs_review_count,
        stage_funnel=stage_funnel,
        experience_level_counts=dict(exp_level_counts),
        avg_score_by_level=avg_score_by_level,
    )


@router.get("/calibration", response_model=CalibrationOut)
def get_calibration(
    job_role_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CalibrationOut:
    """Score calibration: hire rates per 10-point score bucket and suggested threshold.

    Joins scored Evaluations to Outcome records via the candidate chain
    (evaluation → resume → resume_version → candidate → outcome).
    Returns per-bucket hire rates and a suggested shortlist threshold.
    """
    _empty_buckets = [
        CalibrationBucket(
            range=f"{i*10}-{(i+1)*10}", score_min=i*10, score_max=(i+1)*10,
            total=0, hired=0, rejected=0, hire_rate=0.0,
        )
        for i in range(10)
    ]

    q = (
        db.query(Evaluation.total_score, Outcome.outcome)
        .join(Resume, Resume.id == Evaluation.resume_id)
        .join(ResumeVersion, ResumeVersion.id == Resume.id)
        .join(Candidate, Candidate.id == ResumeVersion.candidate_id)
        .join(Outcome, Outcome.candidate_id == Candidate.id)
        .filter(Evaluation.eval_status.is_(None))
    )
    if job_role_id is not None:
        q = q.filter(Evaluation.job_role_id == job_role_id)

    rows = q.all()  # List[Row(total_score, outcome)]

    if not rows:
        return CalibrationOut(
            buckets=_empty_buckets,
            total_with_outcomes=0,
            total_hired=0,
            total_rejected=0,
            suggested_threshold=None,
            threshold_options=[],
        )

    bucket_hired = [0] * 10
    bucket_rejected = [0] * 10
    bucket_total = [0] * 10

    for score, outcome in rows:
        idx = min(int(score // 10), 9)
        bucket_total[idx] += 1
        if outcome == "hired":
            bucket_hired[idx] += 1
        elif outcome in ("rejected", "withdrew", "ghosted", "declined"):
            bucket_rejected[idx] += 1

    buckets = [
        CalibrationBucket(
            range=f"{i*10}-{(i+1)*10}",
            score_min=i * 10,
            score_max=(i + 1) * 10,
            total=bucket_total[i],
            hired=bucket_hired[i],
            rejected=bucket_rejected[i],
            hire_rate=round(bucket_hired[i] / bucket_total[i] * 100, 1) if bucket_total[i] > 0 else 0.0,
        )
        for i in range(10)
    ]

    total_hired = sum(bucket_hired)
    total_rejected = sum(bucket_rejected)
    total_with_outcomes = len(rows)

    # Compute precision/recall/F1 for each candidate threshold (10, 20, …, 90)
    threshold_options: List[ThresholdOption] = []
    for t in range(1, 10):
        above_total = sum(bucket_total[j] for j in range(t, 10))
        above_hired = sum(bucket_hired[j] for j in range(t, 10))
        if above_total == 0:
            continue
        precision = above_hired / above_total
        recall = above_hired / total_hired if total_hired > 0 else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
        threshold_options.append(ThresholdOption(
            threshold=float(t * 10),
            precision=round(precision * 100, 1),
            recall=round(recall * 100, 1),
            f1=round(f1 * 100, 1),
            candidates_above=above_total,
        ))

    # Suggested threshold: highest F1 with at least 2 candidates above
    suggested_threshold: Optional[float] = None
    if threshold_options:
        best = max(
            (opt for opt in threshold_options if opt.candidates_above >= 2),
            key=lambda o: o.f1,
            default=None,
        )
        if best:
            suggested_threshold = best.threshold

    return CalibrationOut(
        buckets=buckets,
        total_with_outcomes=total_with_outcomes,
        total_hired=total_hired,
        total_rejected=total_rejected,
        suggested_threshold=suggested_threshold,
        threshold_options=threshold_options,
    )

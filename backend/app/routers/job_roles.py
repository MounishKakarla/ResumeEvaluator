import json
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.deps import get_current_user, get_db
from app.models import Evaluation, JobRole, JobRoleRequirement, JobRoleSkill, Skill, User
from app.schemas import (
    IntakePauseRequest,
    JobRoleCreate,
    JobRoleOut,
    JobRoleRequirementOut,
    RequirementBulkUpdate,
)

router = APIRouter(prefix="/job-roles", tags=["job-roles"])


class JobRoleDetail(JobRoleOut):
    skill_ids: List[int] = []
    skill_names: List[str] = []
    skill_required_flags: List[bool] = []


def _detail(role: JobRole, skill_ids: List[int], skill_names: List[str], skill_required_flags: Optional[List[bool]] = None) -> JobRoleDetail:
    preferred_majors: List[str] = []
    if role.preferred_majors:
        try:
            preferred_majors = json.loads(role.preferred_majors)
        except (json.JSONDecodeError, ValueError):
            pass
    filter_experience_levels: List[str] = []
    if role.filter_experience_levels:
        filter_experience_levels = [l.strip() for l in role.filter_experience_levels.split(",") if l.strip()]
    return JobRoleDetail(
        id=role.id,
        title=role.title,
        min_experience=role.min_experience or 0,
        weight_projects=role.weight_projects,
        weight_skills=role.weight_skills,
        weight_education=role.weight_education,
        cosine_threshold=role.cosine_threshold,
        intake_paused=role.intake_paused,
        shortlist_target=role.shortlist_target,
        min_fit_score=role.min_fit_score,
        auto_email_enabled=role.auto_email_enabled,
        created_at=role.created_at,
        requirements=[JobRoleRequirementOut.model_validate(r) for r in (role.requirements or [])],
        description=role.description,
        min_degree=role.min_degree,
        preferred_majors=preferred_majors,
        filter_experience_levels=filter_experience_levels,
        skill_ids=skill_ids,
        skill_names=skill_names,
        skill_required_flags=skill_required_flags if skill_required_flags is not None else [True] * len(skill_ids),
        tfidf_threshold=getattr(role, "tfidf_threshold", 0.0) or 0.0,
        min_graduation_year=getattr(role, "min_graduation_year", None),
        max_graduation_year=getattr(role, "max_graduation_year", None),
        is_entry_level=getattr(role, "is_entry_level", False) or False,
    )


def _load_role(role_id: int, db: Session) -> Optional[JobRole]:
    return (
        db.query(JobRole)
        .options(
            joinedload(JobRole.job_role_skills).joinedload(JobRoleSkill.skill),
            joinedload(JobRole.requirements),
        )
        .filter(JobRole.id == role_id)
        .first()
    )


@router.get("", response_model=List[JobRoleDetail])
def list_job_roles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[JobRoleDetail]:
    roles = (
        db.query(JobRole)
        .options(
            joinedload(JobRole.job_role_skills).joinedload(JobRoleSkill.skill),
            joinedload(JobRole.requirements),
        )
        .all()
    )
    result = []
    for r in roles:
        skill_ids = [jrs.skill_id for jrs in r.job_role_skills]
        skill_names = [jrs.skill.name for jrs in r.job_role_skills if jrs.skill]
        skill_required_flags = [getattr(jrs, "is_required", True) for jrs in r.job_role_skills]
        result.append(_detail(r, skill_ids, skill_names, skill_required_flags))
    return result


@router.get("/{role_id}", response_model=JobRoleDetail)
def get_job_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobRoleDetail:
    r = _load_role(role_id, db)
    if r is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job role not found")
    skill_ids = [jrs.skill_id for jrs in r.job_role_skills]
    skill_names = [jrs.skill.name for jrs in r.job_role_skills if jrs.skill]
    skill_required_flags = [getattr(jrs, "is_required", True) for jrs in r.job_role_skills]
    return _detail(r, skill_ids, skill_names, skill_required_flags)


@router.patch("/{role_id}/intake", response_model=JobRoleDetail)
def set_intake_pause(
    role_id: int,
    body: IntakePauseRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobRoleDetail:
    """Pause or resume intake for a job role. Resuming scores all queued evaluations."""
    role = _load_role(role_id, db)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job role not found")

    was_paused = role.intake_paused
    role.intake_paused = body.paused
    db.commit()
    db.refresh(role)

    if was_paused and not body.paused:
        queued = (
            db.query(Evaluation)
            .filter(
                Evaluation.job_role_id == role_id,
                Evaluation.eval_status == "queued",
            )
            .all()
        )
        if queued:
            queued_ids = [ev.resume_id for ev in queued]
            from app.routers.evaluate import _background_evaluate
            background_tasks.add_task(
                _background_evaluate,
                resume_ids=queued_ids,
                job_role_id=role_id,
                weights=None,
            )

    skill_ids = [jrs.skill_id for jrs in role.job_role_skills]
    skill_names = [jrs.skill.name for jrs in role.job_role_skills if jrs.skill]
    skill_required_flags = [getattr(jrs, "is_required", True) for jrs in role.job_role_skills]
    return _detail(role, skill_ids, skill_names, skill_required_flags)


@router.post("", response_model=JobRoleDetail, status_code=status.HTTP_201_CREATED)
def create_job_role(
    body: JobRoleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobRoleDetail:
    if body.weight_projects + body.weight_skills + body.weight_education != 100:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Weights must sum to 100",
        )
    role = JobRole(
        title=body.title,
        min_experience=body.min_experience,
        weight_projects=body.weight_projects,
        weight_skills=body.weight_skills,
        weight_education=body.weight_education,
        cosine_threshold=body.cosine_threshold,
        created_by=current_user.id,
        shortlist_target=body.shortlist_target,
        min_fit_score=body.min_fit_score,
        description=body.description,
        min_degree=body.min_degree or None,
        preferred_majors=json.dumps(body.preferred_majors) if body.preferred_majors else None,
        filter_experience_levels=",".join(body.filter_experience_levels) if body.filter_experience_levels else None,
        auto_email_enabled=body.auto_email_enabled,
        tfidf_threshold=body.tfidf_threshold or 0.0,
        min_graduation_year=body.min_graduation_year or None,
        max_graduation_year=body.max_graduation_year or None,
        is_entry_level=body.is_entry_level,
    )
    db.add(role)
    db.flush()

    flags = body.skill_required_flags or []
    skill_names: List[str] = []
    stored_flags: List[bool] = []
    for i, skill_id in enumerate(body.skill_ids):
        skill = db.query(Skill).filter(Skill.id == skill_id).first()
        if skill is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Skill {skill_id} not found",
            )
        is_req = flags[i] if i < len(flags) else True
        db.add(JobRoleSkill(job_role_id=role.id, skill_id=skill_id, is_keyword=False, is_required=is_req))
        skill_names.append(skill.name)
        stored_flags.append(is_req)

    db.commit()
    r = _load_role(role.id, db)
    assert r is not None
    return _detail(r, body.skill_ids, skill_names, stored_flags)


@router.put("/{role_id}", response_model=JobRoleDetail)
def update_job_role(
    role_id: int,
    body: JobRoleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobRoleDetail:
    role = db.query(JobRole).filter(JobRole.id == role_id).first()
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job role not found")

    if body.weight_projects + body.weight_skills + body.weight_education != 100:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Weights must sum to 100",
        )

    role.title = body.title
    role.min_experience = body.min_experience
    role.weight_projects = body.weight_projects
    role.weight_skills = body.weight_skills
    role.weight_education = body.weight_education
    role.cosine_threshold = body.cosine_threshold
    role.shortlist_target = body.shortlist_target
    role.min_fit_score = body.min_fit_score
    role.description = body.description
    role.min_degree = body.min_degree or None
    role.preferred_majors = json.dumps(body.preferred_majors) if body.preferred_majors else None
    role.filter_experience_levels = ",".join(body.filter_experience_levels) if body.filter_experience_levels else None
    role.auto_email_enabled = body.auto_email_enabled
    role.tfidf_threshold = body.tfidf_threshold or 0.0
    role.min_graduation_year = body.min_graduation_year or None
    role.max_graduation_year = body.max_graduation_year or None
    role.is_entry_level = body.is_entry_level

    db.query(JobRoleSkill).filter(JobRoleSkill.job_role_id == role_id).delete()
    flags = body.skill_required_flags or []
    skill_names: List[str] = []
    stored_flags: List[bool] = []
    for i, skill_id in enumerate(body.skill_ids):
        skill = db.query(Skill).filter(Skill.id == skill_id).first()
        if skill is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Skill {skill_id} not found",
            )
        is_req = flags[i] if i < len(flags) else True
        db.add(JobRoleSkill(job_role_id=role_id, skill_id=skill_id, is_keyword=False, is_required=is_req))
        skill_names.append(skill.name)
        stored_flags.append(is_req)

    db.commit()
    r = _load_role(role_id, db)
    assert r is not None
    return _detail(r, body.skill_ids, skill_names, stored_flags)


@router.put("/{role_id}/requirements", response_model=List[JobRoleRequirementOut])
def replace_requirements(
    role_id: int,
    body: RequirementBulkUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[JobRoleRequirementOut]:
    """Bulk-replace all requirements for a job role (weights must sum to 100)."""
    role = db.query(JobRole).filter(JobRole.id == role_id).first()
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job role not found")

    db.query(JobRoleRequirement).filter(JobRoleRequirement.job_role_id == role_id).delete()

    new_reqs: List[JobRoleRequirement] = []
    for req in body.requirements:
        obj = JobRoleRequirement(
            job_role_id=role_id,
            label=req.label,
            weight=req.weight,
            req_type=req.req_type,
            description=req.description,
            min_years=req.min_years,
        )
        db.add(obj)
        new_reqs.append(obj)

    db.commit()
    for obj in new_reqs:
        db.refresh(obj)

    return [JobRoleRequirementOut.model_validate(r) for r in new_reqs]


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    role = db.query(JobRole).filter(JobRole.id == role_id).first()
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job role not found")
    db.delete(role)
    db.commit()

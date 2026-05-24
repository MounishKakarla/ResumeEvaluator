import logging
import math
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import Skill, User
from app.schemas import SkillCreate, SkillOut

logger = logging.getLogger(__name__)


class _JdExtractRequest(BaseModel):
    text: str

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("", response_model=dict)
def list_skills(
    category: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return a paginated list of skills, optionally filtered by category and/or search term."""
    query = db.query(Skill)

    if category:
        query = query.filter(Skill.category == category)

    if search:
        query = query.filter(Skill.name.ilike(f"%{search}%"))

    total = query.count()
    skills = query.offset((page - 1) * limit).limit(limit).all()
    pages = math.ceil(total / limit) if total > 0 else 1

    return {
        "items": [SkillOut.model_validate(s) for s in skills],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": pages,
    }


@router.post("", response_model=SkillOut, status_code=status.HTTP_201_CREATED)
def create_skill(
    body: SkillCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SkillOut:
    """Create a new skill and immediately compute + store its embedding.

    Raises:
        HTTPException 409: If a skill with the same name already exists.
    """
    existing = db.query(Skill).filter(Skill.name == body.name).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Skill '{body.name}' already exists",
        )

    skill = Skill(
        name=body.name,
        category=body.category,
        embedding=None,
    )
    db.add(skill)
    db.commit()
    db.refresh(skill)

    return SkillOut.model_validate(skill)


_KNOWN_TECH_SKILLS: List[tuple] = [
    # Languages
    ("Python", "language"), ("JavaScript", "language"), ("TypeScript", "language"),
    ("Java", "language"), ("C++", "language"), ("C#", "language"), ("Go", "language"),
    ("Rust", "language"), ("Ruby", "language"), ("PHP", "language"), ("Swift", "language"),
    ("Kotlin", "language"), ("Scala", "language"), ("R", "language"), ("MATLAB", "language"),
    ("Bash", "language"), ("Shell Scripting", "language"), ("SQL", "language"),
    # Web Frameworks
    ("React", "framework"), ("Vue", "framework"), ("Angular", "framework"),
    ("Next.js", "framework"), ("FastAPI", "framework"), ("Flask", "framework"),
    ("Django", "framework"), ("Node.js", "framework"), ("Express", "framework"),
    ("Spring Boot", "framework"), ("Laravel", "framework"), ("Rails", "framework"),
    ("Svelte", "framework"), ("Tailwind CSS", "framework"), ("Bootstrap", "framework"),
    # AI/ML
    ("TensorFlow", "framework"), ("PyTorch", "framework"), ("Keras", "framework"),
    ("Scikit-learn", "library"), ("LangChain", "library"), ("Hugging Face", "library"),
    ("OpenAI API", "library"), ("spaCy", "library"), ("NLTK", "library"),
    ("Machine Learning", "skill"), ("Deep Learning", "skill"),
    ("Natural Language Processing", "skill"), ("Computer Vision", "skill"),
    ("Large Language Models", "skill"), ("RAG", "skill"), ("LLMs", "skill"),
    ("Reinforcement Learning", "skill"), ("Data Science", "skill"),
    ("Generative AI", "skill"), ("Prompt Engineering", "skill"),
    ("Transformers", "library"), ("Vector Databases", "skill"),
    # Databases
    ("PostgreSQL", "database"), ("MySQL", "database"), ("MongoDB", "database"),
    ("Redis", "database"), ("SQLite", "database"), ("Cassandra", "database"),
    ("Elasticsearch", "database"), ("DynamoDB", "database"), ("Firebase", "database"),
    # DevOps / Cloud
    ("Docker", "devops"), ("Kubernetes", "devops"), ("CI/CD", "devops"),
    ("GitHub Actions", "devops"), ("Jenkins", "devops"), ("Terraform", "devops"),
    ("Ansible", "devops"), ("AWS", "cloud"), ("Azure", "cloud"), ("GCP", "cloud"),
    ("Linux", "devops"), ("Git", "devops"), ("GitHub", "devops"), ("GitLab", "devops"),
    # Data Engineering
    ("Apache Spark", "data"), ("Apache Kafka", "data"), ("Airflow", "data"),
    ("Pandas", "library"), ("NumPy", "library"), ("Matplotlib", "library"),
    ("Jupyter", "tool"), ("Databricks", "data"),
    # APIs / Protocols
    ("REST API", "skill"), ("GraphQL", "skill"), ("WebSockets", "skill"),
    ("gRPC", "skill"), ("OAuth", "skill"), ("JWT", "skill"),
    # Other tools
    ("Figma", "tool"), ("Postman", "tool"), ("Jira", "tool"), ("Agile", "skill"),
    ("Microservices", "skill"), ("System Design", "skill"), ("Data Structures", "skill"),
    ("Algorithms", "skill"), ("OOP", "skill"), ("Functional Programming", "skill"),
]

# Normalised aliases so "sklearn" → "scikit-learn", "nodejs" → "node.js", etc.
_JD_SKILL_ALIASES: dict[str, str] = {
    "sklearn": "Scikit-learn", "scikit learn": "Scikit-learn",
    "nodejs": "Node.js", "node js": "Node.js", "node": "Node.js",
    "reactjs": "React", "react.js": "React",
    "vuejs": "Vue", "vue.js": "Vue",
    "angularjs": "Angular",
    "postgres": "PostgreSQL", "psql": "PostgreSQL",
    "mongo": "MongoDB",
    "k8s": "Kubernetes",
    "llm": "Large Language Models", "llms": "Large Language Models",
    "rag": "RAG", "retrieval augmented generation": "RAG",
    "nlp": "Natural Language Processing",
    "ml": "Machine Learning",
    "dl": "Deep Learning",
    "ci/cd": "CI/CD", "cicd": "CI/CD", "continuous integration": "CI/CD",
    "genai": "Generative AI", "generative ai": "Generative AI",
    "langchain": "LangChain",
    "huggingface": "Hugging Face",
    "gcp": "GCP", "google cloud": "GCP",
    "fastapi": "FastAPI", "flask": "Flask",
    "nextjs": "Next.js", "next.js": "Next.js",
    "springboot": "Spring Boot",
    "tensorflow": "TensorFlow",
    "pytorch": "PyTorch",
}


_VALID_SKILL_CATEGORIES = {"language", "framework", "library", "database", "devops", "cloud", "data", "tool", "skill"}


def _extract_skills_via_llm(text: str) -> list[dict]:
    """Ask the configured LLM to extract skills from a JD text.

    Returns a list of {"name": str, "category": str} dicts.
    Returns an empty list if LLM is not configured or the call fails.
    """
    try:
        from app.config import settings
        if not settings.llm_api_key:
            return []
    except Exception:
        return []

    try:
        import json as _json
        import re as _re
        from openai import OpenAI

        client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            timeout=float(settings.llm_timeout),
        )

        sample = text[:6000]
        prompt = (
            "Extract all technical skills, tools, frameworks, and technologies from this job description. "
            "Return ONLY valid JSON:\n"
            '{"skills":[{"name":"Python","category":"language","is_required":true},...]}\n\n'
            f"Categories must be one of: {', '.join(sorted(_VALID_SKILL_CATEGORIES))}\n\n"
            "Set is_required=true for skills described as required, must-have, or mandatory.\n"
            "Set is_required=false for skills described as preferred, nice-to-have, bonus, or a plus.\n"
            "Default to is_required=true when signals are ambiguous.\n\n"
            f"Job description:\n{sample}"
        )

        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=800,
        )

        content = (response.choices[0].message.content or "").strip()
        content = _re.sub(r"^```[a-z]*\n?", "", content)
        content = _re.sub(r"\n?```$", "", content).strip()

        json_match = _re.search(r"\{.*\}", content, _re.DOTALL)
        if not json_match:
            return []

        data = _json.loads(json_match.group())
        result = []
        for s in data.get("skills", []):
            if not isinstance(s, dict) or not s.get("name"):
                continue
            cat = s.get("category", "skill")
            if cat not in _VALID_SKILL_CATEGORIES:
                cat = "skill"
            result.append({"name": str(s["name"]).strip(), "category": cat, "is_required": bool(s.get("is_required", True))})

        logger.debug("LLM extracted %d skills from JD", len(result))
        return result

    except Exception as exc:
        logger.debug("LLM skill extraction failed: %s", exc)
        return []


@router.post("/extract-from-jd")
def extract_skills_from_jd(
    body: _JdExtractRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Extract skills mentioned in the JD text.

    Scans the text against a built-in list of known tech skills AND existing
    DB skills.  Missing skills are auto-created so the caller always gets
    usable IDs back.
    """
    import re as _re

    text = body.text
    if not text or not text.strip():
        return {"skill_ids": [], "skill_names": [], "skill_required": []}

    text_lower = text.lower()
    found_canonical: dict[str, str] = {}        # canonical_lower → display_name
    found_is_required: dict[str, bool] = {}     # canonical_lower → is_required flag

    # 1. Match against the built-in known-skills list (all rule-based hits default to required)
    for display_name, category in _KNOWN_TECH_SKILLS:
        dn_lower = display_name.lower()
        # word-boundary search (handles "React" not matching "Reactive")
        pattern = _re.compile(r'(?<![a-z0-9])' + _re.escape(dn_lower) + r'(?![a-z0-9])', _re.I)
        if pattern.search(text_lower):
            found_canonical[dn_lower] = display_name
            found_is_required.setdefault(dn_lower, True)

    # 2. Match aliases → canonical
    for alias, canonical in _JD_SKILL_ALIASES.items():
        pattern = _re.compile(r'(?<![a-z0-9])' + _re.escape(alias) + r'(?![a-z0-9])', _re.I)
        if pattern.search(text_lower):
            found_canonical[canonical.lower()] = canonical
            found_is_required.setdefault(canonical.lower(), True)

    # 2b. LLM-based dynamic skill extraction (merges without overwriting rule-based hits)
    llm_category_extras: dict[str, str] = {}  # name_lower → category for LLM-only skills
    for s in _extract_skills_via_llm(text):
        name_lower = s["name"].lower()
        is_req = bool(s.get("is_required", True))
        # Resolve through alias table first
        canonical = _JD_SKILL_ALIASES.get(name_lower)
        if canonical:
            found_canonical[canonical.lower()] = canonical
            llm_category_extras[canonical.lower()] = s["category"]
            # LLM flag overrides default only if skill was NOT already found by rule-based pass
            found_is_required.setdefault(canonical.lower(), is_req)
        elif name_lower not in found_canonical:
            found_canonical[name_lower] = s["name"]
            llm_category_extras[name_lower] = s["category"]
            found_is_required[name_lower] = is_req
        else:
            # Skill already found by rule-based pass; let LLM refine the required flag
            found_is_required[name_lower] = is_req

    # 3. Also check existing DB skills via keyword scorer
    from app.services.scorer import _keyword_score_in_text
    all_skills = db.query(Skill).all()
    existing_by_lower = {s.name.lower(): s for s in all_skills}
    for skill in all_skills:
        if _keyword_score_in_text(skill.name, text) >= 0.85:
            found_canonical[skill.name.lower()] = skill.name
            found_is_required.setdefault(skill.name.lower(), True)

    if not found_canonical:
        return {"skill_ids": [], "skill_names": [], "skill_required": []}

    # 4. Upsert: look up each found skill, create if missing
    matched_ids: List[int] = []
    matched_names: List[str] = []
    matched_required: List[bool] = []

    # Build category map: known list + LLM hints (known list takes precedence)
    category_map = {name.lower(): cat for name, cat in _KNOWN_TECH_SKILLS}
    for k, v in llm_category_extras.items():
        category_map.setdefault(k, v)

    for dn_lower, display_name in found_canonical.items():
        existing = existing_by_lower.get(dn_lower)
        if not existing:
            # Try case-insensitive DB lookup
            existing = db.query(Skill).filter(Skill.name.ilike(dn_lower)).first()
        if existing:
            matched_ids.append(existing.id)
            matched_names.append(existing.name)
        else:
            # Auto-create
            category = category_map.get(dn_lower, "skill")
            new_skill = Skill(name=display_name, category=category, embedding=None)
            db.add(new_skill)
            db.flush()
            matched_ids.append(new_skill.id)
            matched_names.append(display_name)
        matched_required.append(found_is_required.get(dn_lower, True))

    db.commit()
    return {"skill_ids": matched_ids, "skill_names": matched_names, "skill_required": matched_required}


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_skill(
    skill_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a skill by ID.

    Raises:
        HTTPException 404: If the skill is not found.
    """
    skill = db.query(Skill).filter(Skill.id == skill_id).first()
    if skill is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill {skill_id} not found",
        )

    db.delete(skill)
    db.commit()

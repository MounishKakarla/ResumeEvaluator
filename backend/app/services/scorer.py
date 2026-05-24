"""Resume scoring engine using TF-IDF vectorization and cosine similarity.

Pipeline per resume:
1. Regex + NLP preprocessing — lowercase, preserve tech symbols (+, #, .), strip noise
2. TF-IDF Vectorization — ngram_range=(1,3) captures unigrams, bigrams, trigrams
3. Cosine Similarity — sklearn pairwise cosine between skill queries and section vectors
4. N-gram phrase detection — common tech phrases matched before vectorization
5. Coverage ratio scoring — sum(matched_scores) / total_required_skills (not mean of matched only)
   Default weights: projects/experience (45%), skills coverage (35%), education (20%)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Tuple

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity as sklearn_cosine

from app.schemas import ScoringWeights
from app.services.segmenter import Section


# ---------------------------------------------------------------------------
# N-gram phrase aliases for common tech terms
# ---------------------------------------------------------------------------

SKILL_ALIASES: dict[str, list[str]] = {
    "machine learning": ["ml", "machine learning", "statistical learning"],
    "deep learning": ["dl", "deep learning", "neural network", "neural networks"],
    "natural language processing": ["nlp", "natural language processing", "text mining", "text analysis"],
    "computer vision": ["cv", "computer vision", "image recognition", "object detection"],
    "large language models": ["llm", "llms", "large language models", "generative ai"],
    "javascript": ["js", "javascript", "ecmascript"],
    "typescript": ["ts", "typescript"],
    "node.js": ["node", "nodejs", "node.js"],
    "react": ["react", "reactjs", "react.js"],
    "vue": ["vue", "vuejs", "vue.js"],
    "angular": ["angular", "angularjs"],
    "postgresql": ["postgres", "postgresql", "psql"],
    "mongodb": ["mongo", "mongodb"],
    "kubernetes": ["k8s", "kubernetes"],
    "continuous integration": ["ci", "ci/cd", "continuous integration", "continuous deployment"],
    "restful api": ["rest", "rest api", "restful", "http api"],
    "graphql": ["graphql", "graph ql"],
    "tailwind css": ["tailwind", "tailwind css"],
    "scikit-learn": ["sklearn", "scikit-learn", "scikit learn"],
    "sentence-transformers": ["sentence transformers", "sbert", "sentence embeddings"],
}

# Recency: pattern to find the most-recent end-year in a section (e.g. "2019-2023", "2021–Present")
_RECENCY_YEAR_RE = re.compile(
    r'(?:\d{4})\s*[-–—to]+\s*(present|current|now|\d{4})',
    re.I,
)


def _section_recency_factor(text: str) -> float:
    """Return a 0.55–1.0 multiplier based on how recently the section dates end.

    Sections with no detectable dates are treated as current (factor = 1.0).
    Decay schedule (years since most-recent end year):
      0-2  → 1.00   (current / recent)
      2-5  → 0.85
      5-10 → 0.70
      10+  → 0.55
    """
    this_year = datetime.now().year
    latest = None
    for m in _RECENCY_YEAR_RE.finditer(text):
        raw = m.group(1).strip()
        if re.match(r'^(present|current|now)$', raw, re.I):
            return 1.0  # explicitly current — short-circuit
        try:
            yr = int(raw)
            if 1970 <= yr <= this_year + 1:
                latest = max(latest, yr) if latest else yr
        except ValueError:
            pass
    if latest is None:
        return 1.0  # no dates detected — assume current
    age = this_year - latest
    if age <= 2:
        return 1.00
    if age <= 5:
        return 0.85
    if age <= 10:
        return 0.70
    return 0.55


# ---------------------------------------------------------------------------
# Semantic project complexity analysis
# ---------------------------------------------------------------------------

_PRODUCTION_SIGNALS_RE = re.compile(
    r'\b(deploy(?:ed|ment|ing)?|docker|kubernetes|k8s|aws|gcp|azure|heroku|vercel|netlify|'
    r'ci[/\-]?cd|github\s+actions|jenkins|travis|circleci|stripe|twilio|sendgrid|firebase|'
    r'supabase|payment\s+gateway|oauth|jwt|redis|elasticsearch|kafka|'
    r'microservice|rest\s*api|graphql|production|live\s+(?:site|app|system)|real\s+users|'
    r'open[\s-]?source|npm\s+publish|pypi|load\s+test|monitoring|prometheus|grafana|sentry|'
    r'1[0-9]{3,}\s*(?:users|requests|records)|revenue|paid\s+(?:users|customers))\b',
    re.I,
)

_ACADEMIC_SIGNALS_RE = re.compile(
    r'\b(university\s+project|college\s+project|coursework|class\s+project|course\s+project|'
    r'academic\s+project|assignment|lab\s+(?:project|work)|semester\s+project|'
    r'final[\s-]?year\s+project|capstone|guided\s+by|under\s+(?:the\s+)?(?:guidance|supervision)|'
    r'mini[\s-]?project|toy\s+project|sample\s+app|demo\s+(?:app|project)|'
    r'following\s+(?:the\s+)?tutorial|learning\s+project|practice\s+project)\b',
    re.I,
)

# Architecture & design action-verbs signal deliberate engineering thinking.
# Used only for entry-level/fresher candidates who describe their projects with
# conceptual depth even without production deployment keywords.
_DESIGN_VERB_RE = re.compile(
    r'\b(designed?|architected?|engineer(?:ed|ing)?|built|constructed?|'
    r'optimized?|improv(?:ed|ing)|reduced?|integrated?|automated?|'
    r'streamlined?|formulated?|established?|solved?|leveraged?|'
    r'developed?|created?|implement(?:ed|ing)?)\b',
    re.I,
)


def _project_complexity_score(text: str, is_fresher: bool = False) -> float:
    """Return a 0.70–1.25 multiplier reflecting project sophistication.

    Production-grade signals (deployed, Docker, live users, Stripe, CI/CD) boost
    the score; academic/guided-coursework signals reduce it.
    For entry-level candidates, architecture/design action-verbs add up to +15%
    to reward conceptual depth even when production keywords are absent.
    """
    prod_hits = len(_PRODUCTION_SIGNALS_RE.findall(text))
    acad_hits = len(_ACADEMIC_SIGNALS_RE.findall(text))

    if prod_hits >= 3:
        result = 1.25       # clearly production-grade
    elif prod_hits >= 1 and acad_hits == 0:
        result = 1.10       # production signals, no academic flags
    elif acad_hits >= 2 and prod_hits == 0:
        result = 0.70       # clearly guided coursework
    elif acad_hits >= 1 and prod_hits == 0:
        result = 0.80       # mild academic signal
    else:
        result = 1.0        # neutral

    # Entry-level only: writing design-oriented descriptions (e.g. "Architected a
    # RAG pipeline", "Optimized query latency") signals conceptual depth that
    # freshers typically can't demonstrate via production deployment signals.
    if is_fresher and _DESIGN_VERB_RE.search(text):
        result = min(result * 1.15, 1.25)

    return result


# Per-section base reliability scores for keyword matching.
# Reflects how much to trust a skill found in each section type.
_SECTION_BASE_SCORES: dict[str, float] = {
    "skills": 0.92,          # explicitly listed — highest confidence
    "certifications": 0.85,
    "projects": 0.88,        # demonstrably used in work
    "experience": 0.85,
    "work_experience": 0.85,
    "education": 0.60,       # mentioned in coursework context
    "summary": 0.55,
    "other": 0.45,
    "unknown": 0.40,
}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class SkillMatchDetail:
    skill_name: str
    score: float
    confidence: float
    best_section: str
    excerpt: Optional[str] = None


@dataclass
class RequirementScore:
    requirement_id: int
    label: str
    req_type: str
    weight: float
    score: float          # 0-100
    evidence: Optional[str] = None


@dataclass
class ScoreResult:
    total: int
    project_score: float
    skill_score: float
    education_score: float
    experience_score: float = 0.0   # 0-100: how well candidate yrs match role requirement
    skills_matched: List[SkillMatchDetail] = field(default_factory=list)
    skill_gaps: List[str] = field(default_factory=list)
    top_excerpt: Optional[str] = None
    requirements_breakdown: List[RequirementScore] = field(default_factory=list)
    jd_alignment_score: float = 0.0


# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------

def _preprocess(text: str) -> str:
    """Lowercase and normalise text, preserving tech-significant characters.

    Keeps: letters, digits, whitespace, +, #, -, .
    (Needed for: C++, C#, .NET, TypeScript, scikit-learn, etc.)
    """
    text = text.lower()
    text = re.sub(r"[^\w\s\+\#\-\.]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _expand_skill(skill_name: str) -> str:
    """Expand a skill name with known aliases/ngrams for richer TF-IDF matching."""
    lower = skill_name.lower()
    aliases = SKILL_ALIASES.get(lower, [])
    all_terms = [skill_name] + aliases
    return " ".join(all_terms)


def _keyword_score_in_text(skill_name: str, text: str) -> float:
    """Return 0–1 keyword-presence score for a skill name against a text block.

    Tiers:
      1.0  — exact name or recognised alias appears verbatim
      0.85 — all significant words of a multi-word skill are present
      0.60 — ≥70 % of significant words present
      0.35 — at least one significant word present (weak signal)
      0.0  — nothing found
    """
    if not text:
        return 0.0
    lower_name = skill_name.lower()
    text_lower = text.lower()

    # Direct full-name match
    if lower_name in text_lower:
        return 1.0

    # Alias match (SKILL_ALIASES table)
    for canonical, alias_list in SKILL_ALIASES.items():
        if lower_name == canonical or lower_name in [a.lower() for a in alias_list]:
            if any(a.lower() in text_lower for a in alias_list):
                return 1.0

    # Multi-word skill: check significant-word coverage
    words = [w for w in lower_name.split() if len(w) > 2]
    if len(words) >= 2:
        hits = sum(1 for w in words if w in text_lower)
        if hits == len(words):
            return 0.85
        if hits >= len(words) * 0.7:
            return 0.60
        if hits > 0:
            return 0.35

    return 0.0


# ---------------------------------------------------------------------------
# Excerpt extraction
# ---------------------------------------------------------------------------

def _extract_sentences(text: str) -> List[str]:
    """Split text into candidate sentences/lines."""
    parts = re.split(r"[.!?\n]+", text)
    return [p.strip() for p in parts if len(p.strip()) > 15]


def _find_best_excerpt(skill_name: str, section_text: str) -> Optional[str]:
    """Return the sentence from *section_text* that best mentions *skill_name*."""
    sentences = _extract_sentences(section_text)
    skill_lower = skill_name.lower()
    skill_parts = [p for p in skill_lower.split() if len(p) > 2]

    # Exact skill name mention
    for sentence in sentences:
        if skill_lower in sentence.lower():
            return sentence[:300]

    # Any significant word from the skill name
    for sentence in sentences:
        sent_lower = sentence.lower()
        if skill_parts and any(part in sent_lower for part in skill_parts):
            return sentence[:300]

    return None


# ---------------------------------------------------------------------------
# Education scoring (keyword overlap — no vectorizer needed)
# ---------------------------------------------------------------------------

_EDU_KEYWORDS = [
    "bachelor", "master", "phd", "doctorate",
    "b.s.", "m.s.", "b.e.", "m.e.", "b.tech", "m.tech",
    "computer science", "engineering", "mathematics",
    "university", "college", "institute", "gpa", "cgpa",
]


def _education_keyword_score(edu_text: str) -> float:
    """Return 0–1 based on presence of degree/institution keywords."""
    if not edu_text:
        return 0.0
    edu_lower = edu_text.lower()
    hits = sum(1 for kw in _EDU_KEYWORDS if kw in edu_lower)
    return min(hits / 4.0, 1.0)


# Degree level hierarchy: higher number = higher degree
_DEGREE_LEVELS: dict[str, int] = {
    "bachelor": 1, "b.s.": 1, "b.e.": 1, "b.tech": 1, "b.sc": 1, "undergraduate": 1,
    "master": 2, "m.s.": 2, "m.e.": 2, "m.tech": 2, "mba": 2, "m.sc": 2, "postgraduate": 2,
    "phd": 3, "ph.d": 3, "doctorate": 3, "doctoral": 3, "d.sc": 3,
}


def _education_level_score(edu_text: str, min_degree: Optional[str]) -> float:
    """Return 0–1 multiplier: 1.0 if candidate meets/exceeds min_degree, lower if not."""
    if not min_degree:
        return 1.0
    required_level = _DEGREE_LEVELS.get(min_degree.lower(), 0)
    if required_level == 0:
        return 1.0
    edu_lower = edu_text.lower()
    candidate_level = max(
        (lvl for kw, lvl in _DEGREE_LEVELS.items() if kw in edu_lower),
        default=0,
    )
    if candidate_level >= required_level:
        return 1.0
    if candidate_level == required_level - 1:
        return 0.55  # one level below: partial credit
    return 0.15  # significantly under-qualified


def _major_match_score(edu_text: str, preferred_majors: List[str]) -> float:
    """Return 0–1 multiplier: 1.0 on major match, partial on keyword overlap, 0.8 if no preference."""
    if not preferred_majors:
        return 1.0
    edu_lower = edu_text.lower()
    for major in preferred_majors:
        if major.lower() in edu_lower:
            return 1.0
    # Partial: keyword overlap within major names
    best = 0.0
    for major in preferred_majors:
        parts = [p for p in re.split(r"\W+", major.lower()) if len(p) > 3]
        if parts:
            hits = sum(1 for p in parts if p in edu_lower)
            best = max(best, hits / len(parts))
    # Partial credit for keyword overlap; floor 0.5 so a completely wrong major still shows some penalty
    return max(best * 0.9, 0.5)


def _score_education(
    edu_text: str,
    min_degree: Optional[str] = None,
    preferred_majors: Optional[List[str]] = None,
) -> float:
    """Unified education score combining keyword presence, degree level, and major match."""
    base = _education_keyword_score(edu_text)
    level = _education_level_score(edu_text, min_degree)
    major = _major_match_score(edu_text, preferred_majors or [])
    return base * level * major


def _score_experience_match(candidate_years: float, required_years: int) -> float:
    """Return 0–1 score comparing candidate's total experience to the role's minimum.

    Tiers are intentionally forgiving: experience is a signal, not a hard gate
    (the Stage-0 filter handles hard cutoffs).
      ≥ required          → 1.00
      ≥ 75 % of required  → 0.80
      ≥ 50 % of required  → 0.55
      < 50 %              → 0.20
    """
    if required_years <= 0:
        return 1.0
    ratio = candidate_years / max(required_years, 1)
    if ratio >= 1.0:
        return 1.0
    if ratio >= 0.75:
        return 0.80
    if ratio >= 0.50:
        return 0.55
    return 0.20


def _extract_skill_experience_years(skill_name: str, text: str) -> Optional[float]:
    """Try to extract explicit years of experience for a specific skill from text.

    Looks for patterns like:
    - "3 years of React"  /  "React: 3+ years"
    - "React (2020-2023)"  — date-range approach
    """
    text_lower = text.lower()
    skill_lower = skill_name.lower()
    escaped = re.escape(skill_lower)

    # Pattern A: "X years of <skill>" or "X+ years <skill>"
    m = re.search(rf"(\d+)\+?\s*years?\s+(?:of\s+)?(?:\w+\s+)?{escaped}", text_lower)
    if m:
        return float(m.group(1))
    # Pattern B: "<skill> X years" / "<skill>: X+ years"
    m = re.search(rf"{escaped}[^\n\.]{{0,60}}?(\d+)\+?\s*years?", text_lower)
    if m:
        return float(m.group(1))
    # Pattern C: "<skill> (YYYY-YYYY)" — estimate years from date range
    m = re.search(rf"{escaped}\s*\((20\d\d|19\d\d)\s*[-–]\s*(20\d\d|19\d\d|present|current)\)", text_lower)
    if m:
        start = int(m.group(1))
        end_raw = m.group(2)
        end = 2024 if end_raw in ("present", "current") else int(end_raw)
        return max(float(end - start), 0.0)
    return None


def _compute_jd_alignment(sections: List[Section], jd_description: str) -> float:
    """Return 0–1 cosine similarity between JD description and candidate's project/experience text.

    Rewards candidates whose project and experience sections mirror the JD responsibilities.
    """
    if not jd_description or not jd_description.strip():
        return 0.0
    relevant = [
        s.text for s in sections if s.type in ("projects", "experience", "work_experience")
    ]
    if not relevant:
        relevant = [s.text for s in sections]
    if not relevant:
        return 0.0
    candidate_text = _preprocess(" ".join(relevant))
    jd_text = _preprocess(jd_description)
    try:
        vec = TfidfVectorizer(ngram_range=(1, 3), sublinear_tf=True, min_df=1,
                              token_pattern=r"[a-z0-9][a-z0-9\+\#\-\.]*")
        vec.fit([jd_text, candidate_text])
        jd_v = vec.transform([jd_text])
        cand_v = vec.transform([candidate_text])
        sim = float(sklearn_cosine(jd_v, cand_v)[0, 0])
        # TF-IDF cosine between two free-text docs is normally <0.5; scale up
        return min(sim * 2.5, 1.0)
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# LLM result converter
# ---------------------------------------------------------------------------

def _build_result_from_llm(
    llm_skills: list,
    sections: List[Section],
    weights: ScoringWeights,
    cosine_threshold: float,
    jd_description: Optional[str] = None,
    min_degree: Optional[str] = None,
    preferred_majors: Optional[List[str]] = None,
    skill_name_to_required: Optional[dict] = None,
    candidate_years: Optional[float] = None,
    min_experience_years: int = 0,
    is_fresher: bool = False,
) -> ScoreResult:
    """Convert raw LLM skill dicts into a ScoreResult."""
    _CONF_MAP = {"high": 1.2, "medium": 1.0, "low": 0.75}
    # 55 = "skill clearly used in project/experience" — excludes "implied but not named" (25-54).
    # Raising from 40 prevents indirectly implied skills from inflating the coverage ratio.
    _THRESHOLD_INT = 55

    skills_matched: List[SkillMatchDetail] = []
    skill_gaps: List[str] = []
    project_scores: List[float] = []
    skill_scores: List[float] = []
    all_excerpts: List[Tuple[float, str]] = []

    # Weighted denominator: required skills count 1.5×, nice-to-have 0.7×
    total_weight = sum(
        1.5 if (skill_name_to_required.get(item.get("name", ""), True) if skill_name_to_required else True) else 0.7
        for item in llm_skills
    ) or 1.0

    # Pre-compute max complexity per section type for the LLM path
    _llm_proj_types = {"projects", "experience", "work_experience"}
    _type_complexity: dict = {}
    for _s in sections:
        if _s.type in _llm_proj_types:
            _existing = _type_complexity.get(_s.type, 1.0)
            _type_complexity[_s.type] = max(_existing, _project_complexity_score(_s.text, is_fresher))

    for item in llm_skills:
        name = item.get("name", "")
        raw_score: float = float(item.get("score", 0))
        conf_label: str = item.get("confidence", "low")
        section_type: str = item.get("section", "unknown")
        excerpt: Optional[str] = item.get("excerpt") or None

        normalised = raw_score / 100.0  # keep 0-1 for internal consistency
        is_req = skill_name_to_required.get(name, True) if skill_name_to_required else True
        sw = 1.5 if is_req else 0.7

        if raw_score >= _THRESHOLD_INT:
            conf_value = _CONF_MAP.get(conf_label, 0.75)
            detail = SkillMatchDetail(
                skill_name=name,
                score=round(normalised, 4),
                confidence=round(conf_value, 4),
                best_section=section_type,
                excerpt=excerpt,
            )
            skills_matched.append(detail)
            if excerpt:
                all_excerpts.append((normalised, excerpt))
            if section_type in _llm_proj_types:
                complexity = _type_complexity.get(section_type, 1.0)
                project_scores.append(normalised * sw * complexity)
            # Flat global coverage: every matched skill contributes full credit to
            # the skills dimension regardless of which section it was found in.
            skill_scores.append(sw)
        else:
            skill_gaps.append(name)

    edu_text = " ".join(s.text for s in sections if s.type == "education")
    edu_raw = _score_education(edu_text, min_degree, preferred_majors) if weights.education > 0 else 0.0

    # Coverage ratio with per-skill weighting: missing skills contribute 0 to numerator
    project_raw = sum(project_scores) / total_weight
    skill_raw   = sum(skill_scores)   / total_weight

    # Blend JD alignment into the project dimension (30% weight when present)
    jd_align = _compute_jd_alignment(sections, jd_description or "")
    if jd_description and jd_align > 0:
        project_raw = project_raw * 0.70 + jd_align * 0.30

    _w_sum = weights.projects + weights.skills + weights.education
    if _w_sum <= 0:
        _w_sum = 100
    total_float = (
        project_raw * weights.projects / _w_sum
        + skill_raw * weights.skills / _w_sum
        + edu_raw * weights.education / _w_sum
    ) * 100.0

    # Experience years: 15 % additive blend when candidate years are known
    exp_raw = 1.0
    if candidate_years is not None and min_experience_years > 0:
        exp_raw = _score_experience_match(float(candidate_years), min_experience_years)
        total_float = total_float * 0.85 + exp_raw * 100.0 * 0.15

    total_clamped = int(round(max(0.0, min(100.0, total_float))))

    top_excerpt: Optional[str] = None
    if all_excerpts:
        all_excerpts.sort(key=lambda x: x[0], reverse=True)
        top_excerpt = all_excerpts[0][1]

    return ScoreResult(
        total=total_clamped,
        project_score=round(project_raw * 100, 2),
        skill_score=round(skill_raw * 100, 2),
        education_score=round(edu_raw * 100, 2),
        experience_score=round(exp_raw * 100, 2),
        skills_matched=skills_matched,
        skill_gaps=skill_gaps,
        top_excerpt=top_excerpt,
        jd_alignment_score=round(jd_align * 100, 2),
    )


# ---------------------------------------------------------------------------
# Main scoring function
# ---------------------------------------------------------------------------

def score_resume(
    sections: List[Section],
    required_skills: list,          # list of Skill ORM objects (.name, .embedding attrs)
    weights: ScoringWeights,
    cosine_threshold: float,
    resume_id: int = 0,             # kept for API compatibility, not used by TF-IDF scorer
    jd_description: Optional[str] = None,
    min_degree: Optional[str] = None,
    preferred_majors: Optional[List[str]] = None,
    skill_required_flags: Optional[List[bool]] = None,  # parallel to required_skills; True=required (1.5×), False=nice-to-have (0.7×)
    candidate_years: Optional[float] = None,            # candidate's total years of experience
    min_experience_years: int = 0,                      # job role's minimum required years
    is_fresher: bool = False,                           # when True, skip recency decay (all fresher work is recent)
) -> ScoreResult:
    """Score a resume against required skills using TF-IDF + cosine similarity.

    Steps:
    1. Preprocess all section texts and skill names (regex normalisation).
    2. Expand skill names with n-gram aliases.
    3. Fit TF-IDF vectorizer (ngram_range 1–3) on the combined corpus.
    4. Transform skill queries and section texts into TF-IDF vectors.
    5. Compute pairwise cosine similarity (skill × section matrix).
    6. Apply section weight multiplier and spaCy confidence multiplier.
    7. Aggregate per-dimension scores and compute weighted total.

    Args:
        sections: Detected resume sections from segmenter.
        required_skills: ORM Skill rows (need .name).
        weights: ScoringWeights summing to 100.
        cosine_threshold: Minimum normalised score to count a skill as matched.
        resume_id: Unused; kept for API compatibility.

    Returns:
        ScoreResult with scores, matched skills, gaps, and top excerpt.
    """
    from app.services.confidence import get_confidence
    from app.services.llm_scorer import score_with_llm

    if weights.projects + weights.skills + weights.education != 100:
        raise ValueError(
            f"Scoring weights must sum to 100, got "
            f"{weights.projects + weights.skills + weights.education}"
        )

    if not sections:
        return ScoreResult(total=0, project_score=0.0, skill_score=0.0, education_score=0.0)

    # ------------------------------------------------------------------
    # LLM path (preferred when configured) — falls back to TF-IDF
    # ------------------------------------------------------------------
    llm_results = score_with_llm(sections, required_skills, cosine_threshold)
    if llm_results is not None:
        skill_name_to_required = None
        if skill_required_flags:
            skill_name_to_required = {
                required_skills[i].name: skill_required_flags[i]
                for i in range(min(len(required_skills), len(skill_required_flags)))
            }
        return _build_result_from_llm(
            llm_results, sections, weights, cosine_threshold,
            jd_description=jd_description,
            min_degree=min_degree,
            preferred_majors=preferred_majors,
            skill_name_to_required=skill_name_to_required,
            candidate_years=candidate_years,
            min_experience_years=min_experience_years,
            is_fresher=is_fresher,
        )

    # ------------------------------------------------------------------
    # Keyword-based matching (ATS-style)
    # Each skill is scored independently per section type.
    # project_scores and skill_scores are populated in parallel so
    # a skill present in both a Skills section AND a Projects section
    # contributes to both dimensions.
    # ------------------------------------------------------------------
    skills_matched: List[SkillMatchDetail] = []
    skill_gaps: List[str] = []
    project_scores: List[float] = []
    skill_scores: List[float] = []
    all_excerpts: List[Tuple[float, str]] = []

    _PROJ_TYPES = {"projects", "experience", "work_experience"}
    _SKILL_TYPES = {"skills", "certifications"}

    # Weighted denominator: required=1.5×, nice-to-have=0.7×; when no flags, all weight=1.0
    total_weight = sum(
        1.5 if (skill_required_flags[i] if skill_required_flags and i < len(skill_required_flags) else True) else 0.7
        for i in range(len(required_skills))
    ) or 1.0

    # Pre-compute semantic complexity multiplier per section.
    # Production signals (Docker, deployed, live users) boost; academic/coursework signals reduce.
    # Only applied to project/experience sections — skills lists and education are unaffected.
    _section_complexity = [
        _project_complexity_score(s.text, is_fresher) if s.type in _PROJ_TYPES else 1.0
        for s in sections
    ]

    for i, skill in enumerate(required_skills):
        is_req = skill_required_flags[i] if skill_required_flags and i < len(skill_required_flags) else True
        sw = 1.5 if is_req else 0.7
        best_proj_score = 0.0
        best_proj_section = "unknown"
        best_skill_score_val = 0.0
        best_skill_section = "unknown"
        best_other_score = 0.0
        best_excerpt: Optional[str] = None

        for si, section in enumerate(sections):
            kw = _keyword_score_in_text(skill.name, section.text)
            if kw == 0.0:
                continue
            base = _SECTION_BASE_SCORES.get(section.type, 0.40)
            # Freshers: skip recency decay — all their work is recent by definition.
            # Experienced candidates: decay older project/experience sections.
            recency = 1.0 if is_fresher else (
                _section_recency_factor(section.text) if section.type in _PROJ_TYPES else 1.0
            )
            complexity = _section_complexity[si]
            effective = kw * base * recency * complexity
            # Tenure boost: if the resume explicitly states years for this skill (e.g. "Python 4 yrs"),
            # apply a small confidence multiplier (up to +15% for 10+ years, capped at 1.0).
            tenure = _extract_skill_experience_years(skill.name, section.text)
            if tenure is not None and tenure > 0:
                tenure_boost = min(1.0 + (min(tenure, 10.0) / 10.0) * 0.15, 1.15)
                effective = min(effective * tenure_boost, 1.0)

            if section.type in _PROJ_TYPES:
                if effective > best_proj_score:
                    best_proj_score = effective
                    best_proj_section = section.type
                    best_excerpt = best_excerpt or _find_best_excerpt(skill.name, section.text)
            elif section.type in _SKILL_TYPES:
                if effective > best_skill_score_val:
                    best_skill_score_val = effective
                    best_skill_section = section.type
                    best_excerpt = best_excerpt or _find_best_excerpt(skill.name, section.text)
            else:
                if effective > best_other_score:
                    best_other_score = effective
                    best_excerpt = best_excerpt or _find_best_excerpt(skill.name, section.text)

        any_score = max(best_proj_score, best_skill_score_val, best_other_score)

        _MATCH_THRESHOLD = 0.30
        if any_score >= _MATCH_THRESHOLD:
            # Display section: prefer project evidence (shows actual usage)
            if best_proj_score >= _MATCH_THRESHOLD:
                display_section = best_proj_section
            elif best_skill_score_val >= _MATCH_THRESHOLD:
                display_section = best_skill_section
            else:
                display_section = "unknown"

            conf = 1.2 if any_score >= 0.85 else (1.0 if any_score >= 0.60 else 0.75)
            detail = SkillMatchDetail(
                skill_name=skill.name,
                score=round(any_score, 4),
                confidence=round(conf, 4),
                best_section=display_section,
                excerpt=best_excerpt,
            )
            skills_matched.append(detail)
            if best_excerpt:
                all_excerpts.append((any_score, best_excerpt))

            # Each dimension filled independently — a skill can contribute to both.
            # Multiply by sw (1.5 required / 0.7 nice-to-have) for weighted coverage.
            if best_proj_score >= _MATCH_THRESHOLD:
                project_scores.append(best_proj_score * sw)
            # Flat global coverage: matched anywhere on the resume counts as full credit.
            # 10/20 required skills matched → exactly 50% skills score, no section penalty.
            skill_scores.append(sw)
        else:
            skill_gaps.append(skill.name)

    # ------------------------------------------------------------------
    # Step 7: Aggregate and compute weighted total
    # ------------------------------------------------------------------
    edu_text = " ".join(s.text for s in sections if s.type == "education")
    edu_raw = _score_education(edu_text, min_degree, preferred_majors) if weights.education > 0 else 0.0

    # Weighted coverage ratio: each skill's score is multiplied by its weight (required=1.5, nice-to-have=0.7).
    # total_weight is the sum of all skill weights (matched + unmatched), so missing skills penalise the score.
    # When no skill_required_flags are given, total_weight == len(required_skills) → identical to the plain
    # coverage-ratio fix (Change 1).
    project_raw = sum(project_scores) / total_weight
    skill_raw   = sum(skill_scores)   / total_weight

    # JD alignment: blend into project dimension when description is provided
    jd_align = _compute_jd_alignment(sections, jd_description or "")
    if jd_description and jd_align > 0:
        project_raw = project_raw * 0.70 + jd_align * 0.30

    # Normalize by actual weight sum so education=0 always works correctly,
    # even when stored weights don't sum exactly to 100.
    _w_sum = weights.projects + weights.skills + weights.education
    if _w_sum <= 0:
        _w_sum = 100
    total_float = (
        project_raw * weights.projects / _w_sum
        + skill_raw * weights.skills / _w_sum
        + edu_raw * weights.education / _w_sum
    ) * 100.0

    # Experience years: 15 % additive blend when candidate years are known.
    # If unknown (None), no penalty — benefit of the doubt.
    # Formula: total = main_score × 0.85 + exp_match × 100 × 0.15
    # At full experience (exp_match=1.0), total is unchanged: x×0.85 + 100×0.15 = x×0.85+15.
    # At 50 % experience (exp_match=0.55): total = x×0.85 + 55×0.15 = x×0.85+8.25 (≈7pt penalty vs qualified).
    exp_raw = 1.0
    if candidate_years is not None and min_experience_years > 0:
        exp_raw = _score_experience_match(float(candidate_years), min_experience_years)
        total_float = total_float * 0.85 + exp_raw * 100.0 * 0.15

    total_clamped = int(round(max(0.0, min(100.0, total_float))))

    top_excerpt: Optional[str] = None
    if all_excerpts:
        all_excerpts.sort(key=lambda x: x[0], reverse=True)
        top_excerpt = all_excerpts[0][1]

    return ScoreResult(
        total=total_clamped,
        project_score=round(project_raw * 100, 2),
        skill_score=round(skill_raw * 100, 2),
        education_score=round(edu_raw * 100, 2),
        experience_score=round(exp_raw * 100, 2),
        skills_matched=skills_matched,
        skill_gaps=skill_gaps,
        top_excerpt=top_excerpt,
        jd_alignment_score=round(jd_align * 100, 2),
    )


# ---------------------------------------------------------------------------
# Requirements-based scoring (flexible per-requirement weights)
# ---------------------------------------------------------------------------

def score_requirements(
    sections: List[Section],
    requirements: list,          # list of JobRoleRequirement ORM objects
    cosine_threshold: float = 0.30,
    jd_description: Optional[str] = None,
    min_degree: Optional[str] = None,
    preferred_majors: Optional[List[str]] = None,
) -> ScoreResult:
    """Score a resume against a list of typed requirements with individual weights.

    When requirements exist on a job role they replace the fixed 3-bucket scoring.
    Falls back to zero gracefully when sections or requirements are empty.
    Also populates project_score / skill_score / education_score from weighted
    averages of their corresponding types for backward-compatible display.
    """
    if not sections or not requirements:
        return ScoreResult(total=0, project_score=0.0, skill_score=0.0, education_score=0.0)

    section_text_by_type: dict[str, str] = {}
    all_text = " ".join(s.text for s in sections)
    for s in sections:
        existing = section_text_by_type.get(s.type, "")
        section_text_by_type[s.type] = (existing + " " + s.text).strip()

    section_texts_pp = [_preprocess(s.text) or " " for s in sections]
    req_queries = [_preprocess(_expand_skill(r.label)) for r in requirements]

    vectorizer = TfidfVectorizer(
        ngram_range=(1, 3),
        analyzer="word",
        sublinear_tf=True,
        min_df=1,
        max_df=1.0,
        token_pattern=r"[a-z0-9][a-z0-9\+\#\-\.]*",
    )
    try:
        vectorizer.fit(section_texts_pp + req_queries)
        section_vectors = vectorizer.transform(section_texts_pp)
        req_vectors = vectorizer.transform(req_queries)
        sim_matrix: np.ndarray = sklearn_cosine(req_vectors, section_vectors)
    except Exception:
        sim_matrix = np.zeros((len(requirements), len(sections)))

    breakdown: List[RequirementScore] = []
    total_weighted = 0.0
    skill_scores_w: List[Tuple[float, float]] = []
    project_scores_w: List[Tuple[float, float]] = []
    edu_scores_w: List[Tuple[float, float]] = []

    for req_idx, req in enumerate(requirements):
        req_type: str = req.req_type
        evidence: Optional[str] = None
        raw_score = 0.0

        if req_type in ("skill", "other"):
            best = 0.0
            best_exc: Optional[str] = None
            for s_idx, section in enumerate(sections):
                cos = float(sim_matrix[req_idx, s_idx])
                effective = cos * section.weight_multiplier
                if effective > best:
                    best = effective
                    best_exc = _find_best_excerpt(req.label, section.text)
            raw_score = min(best / 1.2, 1.0)
            evidence = best_exc
            if raw_score >= cosine_threshold:
                skill_scores_w.append((raw_score, req.weight))

        elif req_type == "education":
            edu_text_req = section_text_by_type.get("education", "")
            # Label-specific keyword bonus (e.g. "Bachelor's in CS")
            label_parts = [p for p in req.label.lower().split() if len(p) > 3]
            kw_hits = sum(1 for p in label_parts if p in edu_text_req.lower())
            label_bonus = min(kw_hits / max(len(label_parts), 1), 1.0) * 0.5
            # Apply global degree/major filters from job role
            base = _score_education(edu_text_req, min_degree, preferred_majors)
            raw_score = min(base + label_bonus * (1.0 - base), 1.0)
            if raw_score > 0.1:
                evidence = edu_text_req[:200] if edu_text_req else None
            edu_scores_w.append((raw_score, req.weight))

        elif req_type == "experience":
            exp_text = section_text_by_type.get("experience", all_text)
            label_parts = [p for p in req.label.lower().split() if len(p) > 3]
            kw_hits = sum(1 for p in label_parts if p in exp_text.lower())
            kw_raw = min(kw_hits / max(len(label_parts), 1), 1.0)

            min_yrs: Optional[int] = getattr(req, "min_years", None)
            if min_yrs and min_yrs > 0:
                # Use explicit min_years: extract skill-specific year count from text
                found = _extract_skill_experience_years(req.label, exp_text)
                if found is not None:
                    raw_score = min(found / min_yrs, 1.0)
                else:
                    # No explicit years found — keyword density as fallback, capped lower
                    raw_score = kw_raw * 0.65
            else:
                # Original heuristic: label parsing + calendar-year counting
                raw_score = kw_raw
                year_match = re.search(r"(\d+)\+?\s*years?", req.label, re.IGNORECASE)
                if year_match:
                    required_years = int(year_match.group(1))
                    years_found = re.findall(r"\b(20\d\d|19\d\d)\b", exp_text)
                    if len(years_found) >= required_years:
                        raw_score = max(raw_score, 0.7)

            if raw_score > 0.1:
                evidence = _find_best_excerpt(req.label, exp_text)
            project_scores_w.append((raw_score, req.weight))

        score_pct = round(raw_score * 100, 2)
        breakdown.append(RequirementScore(
            requirement_id=req.id,
            label=req.label,
            req_type=req_type,
            weight=req.weight,
            score=score_pct,
            evidence=evidence,
        ))
        total_weighted += raw_score * (req.weight / 100.0)

    def _wavg(pairs: List[Tuple[float, float]]) -> float:
        if not pairs:
            return 0.0
        return sum(s * w for s, w in pairs) / sum(w for _, w in pairs)

    # JD alignment: blend into total (15%) and project dimension (30%)
    jd_align = _compute_jd_alignment(sections, jd_description or "")
    total_float = total_weighted * 100.0
    if jd_description and jd_align > 0:
        total_float = total_float * 0.85 + jd_align * 100.0 * 0.15
    total_req = int(round(max(0.0, min(100.0, total_float))))

    proj_raw = _wavg(project_scores_w)
    if jd_description and jd_align > 0:
        proj_raw = proj_raw * 0.70 + jd_align * 0.30

    best_evidence = next(
        (b.evidence for b in sorted(breakdown, key=lambda b: b.score, reverse=True) if b.evidence),
        None,
    )

    return ScoreResult(
        total=total_req,
        project_score=round(proj_raw * 100, 2),
        skill_score=round(_wavg(skill_scores_w) * 100, 2),
        education_score=round(_wavg(edu_scores_w) * 100, 2),
        skills_matched=[],
        skill_gaps=[],
        top_excerpt=best_evidence,
        requirements_breakdown=breakdown,
        jd_alignment_score=round(jd_align * 100, 2),
    )

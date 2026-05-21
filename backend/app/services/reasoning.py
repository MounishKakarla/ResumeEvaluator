"""AI reasoning summary generation for candidate evaluations.

Produces a 2–4 sentence plain-English paragraph explaining why a candidate
scored the way they did.  When an LLM is configured it calls the same
OpenAI-compatible endpoint used by the skill scorer.  Otherwise it composes
the paragraph from the structured score data.
"""

from __future__ import annotations

import logging
import re
from typing import Any, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are an expert technical recruiter writing a candidate fit summary for hiring managers.
Write exactly one paragraph (2-4 sentences). Be specific and honest.
Mention actual skills, experience depth, and any notable gaps.
Do not use bullet points, headers, or markdown. Plain prose only.\
"""

_USER_TEMPLATE = """\
Role: {job_title}
{jd_snippet}
Candidate overall score: {total_score}%  (projects/experience: {project_score}%, skills: {skill_score}%, education: {education_score}%){jd_align_line}

Matched skills: {matched_skills}
Missing skills: {skill_gaps}
{req_breakdown}

Write the summary paragraph now.\
"""


# ---------------------------------------------------------------------------
# Rule-based fallback
# ---------------------------------------------------------------------------

def _rule_based_summary(
    candidate_name: str,
    job_title: str,
    total_score: float,
    project_score: float,
    skill_score: float,
    education_score: float,
    matched_skills: List[str],
    skill_gaps: List[str],
    jd_alignment_score: float,
    requirements_breakdown: List[Any],
) -> str:
    name = candidate_name or "The candidate"
    tier = "strong" if total_score >= 75 else "moderate" if total_score >= 50 else "weak"

    sentences: List[str] = []

    # Opening: overall fit verdict
    sentences.append(
        f"{name} is a {tier} fit for the {job_title} role with an overall score of {round(total_score)}%."
    )

    # Skills sentence
    if matched_skills:
        top = matched_skills[:5]
        suffix = f" among others" if len(matched_skills) > 5 else ""
        sentences.append(f"Key strengths include {', '.join(top)}{suffix}.")

    # Gaps sentence
    if skill_gaps:
        top_gaps = skill_gaps[:3]
        suffix = " and other areas" if len(skill_gaps) > 3 else ""
        sentences.append(f"Notable gaps are {', '.join(top_gaps)}{suffix}.")

    # Requirements-mode: highlight lowest and highest scoring requirements
    if requirements_breakdown:
        sorted_reqs = sorted(requirements_breakdown, key=lambda r: r.get("score", 0))
        weakest = sorted_reqs[0]
        strongest = sorted_reqs[-1]
        if weakest.get("score", 100) < 40:
            sentences.append(
                f"The biggest weakness is '{weakest['label']}' (scored {round(weakest['score'])}%)."
            )
        if strongest.get("score", 0) >= 80 and strongest != weakest:
            sentences.append(
                f"The candidate particularly excels in '{strongest['label']}' ({round(strongest['score'])}%)."
            )

    # JD alignment note
    if jd_alignment_score >= 70:
        sentences.append(
            f"Their project experience aligns well with the job description ({round(jd_alignment_score)}% alignment)."
        )
    elif 0 < jd_alignment_score < 35:
        sentences.append(
            f"Their experience shows limited alignment with the specific job description responsibilities ({round(jd_alignment_score)}%)."
        )

    # Education note
    if education_score < 30:
        sentences.append("Education credentials appear limited or could not be verified from the resume.")
    elif education_score >= 80:
        sentences.append("Strong educational background was detected.")

    return " ".join(sentences)


# ---------------------------------------------------------------------------
# LLM-based generation
# ---------------------------------------------------------------------------

def _llm_summary(
    candidate_name: str,
    job_title: str,
    jd_description: Optional[str],
    total_score: float,
    project_score: float,
    skill_score: float,
    education_score: float,
    matched_skills: List[str],
    skill_gaps: List[str],
    jd_alignment_score: float,
    requirements_breakdown: List[Any],
) -> Optional[str]:
    """Call the LLM to generate the summary. Returns None on any failure."""
    from app.config import settings
    if not settings.llm_api_key:
        return None

    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            timeout=settings.llm_timeout,
        )

        # Build JD snippet (first 400 chars if available)
        jd_snippet = ""
        if jd_description and jd_description.strip():
            snippet = jd_description.strip()[:400].replace("\n", " ")
            jd_snippet = f"Job description excerpt: {snippet}…\n"

        # JD alignment line
        jd_align_line = ""
        if jd_alignment_score > 0:
            jd_align_line = f", JD alignment: {round(jd_alignment_score)}%"

        # Requirements breakdown block
        req_block = ""
        if requirements_breakdown:
            lines = [
                f"  - {r['label']} ({r['req_type']}): {round(r['score'])}% (weight {r['weight']}%)"
                for r in requirements_breakdown
            ]
            req_block = "Per-requirement scores:\n" + "\n".join(lines)

        user_msg = _USER_TEMPLATE.format(
            job_title=job_title,
            jd_snippet=jd_snippet,
            total_score=round(total_score),
            project_score=round(project_score),
            skill_score=round(skill_score),
            education_score=round(education_score),
            jd_align_line=jd_align_line,
            matched_skills=", ".join(matched_skills) if matched_skills else "none",
            skill_gaps=", ".join(skill_gaps) if skill_gaps else "none",
            req_breakdown=req_block,
        )

        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.4,
            max_tokens=220,
        )

        text = (response.choices[0].message.content or "").strip()
        # Strip any accidental markdown fences the model might add
        text = re.sub(r"```[\s\S]*?```", "", text).strip()
        return text if text else None

    except Exception as exc:
        logger.warning("Reasoning LLM call failed (%s) — using rule-based summary", exc)
        return None


# ---------------------------------------------------------------------------
# Interview question generation
# ---------------------------------------------------------------------------

_IQ_SYSTEM_PROMPT = """\
You are an expert technical interviewer. Generate exactly 5 targeted interview questions for this candidate.
Rules:
- Mix technical depth questions with behavioral/situational ones
- At least 2 questions must probe skill gaps or weak areas
- Questions must be specific to the role and candidate's background, not generic
- Output ONLY a JSON array of 5 strings — no markdown, no extra text
Example: ["Question 1?", "Question 2?", "Question 3?", "Question 4?", "Question 5?"]
"""

_IQ_USER_TEMPLATE = """\
Role: {job_title}
Candidate score: {total_score}% | Skills matched: {matched_skills} | Gaps: {skill_gaps}
{req_lines}
Generate 5 targeted interview questions now.\
"""


def _rule_based_interview_questions(
    job_title: str,
    matched_skills: List[str],
    skill_gaps: List[str],
    requirements_breakdown: List[Any],
) -> List[str]:
    questions: List[str] = []

    if skill_gaps:
        g = skill_gaps[0]
        questions.append(f"You listed {g} as a gap area. Can you walk me through your exposure to it and how you'd ramp up quickly?")
    if len(skill_gaps) > 1:
        g2 = skill_gaps[1]
        questions.append(f"The role requires strong {g2}. Describe a time you had to learn a new technology under time pressure.")

    if matched_skills:
        s = matched_skills[0]
        questions.append(f"Tell me about a challenging project where you used {s}. What was the hardest technical decision you made?")

    if requirements_breakdown:
        low_reqs = [r for r in requirements_breakdown if r.get("score", 100) < 40]
        if low_reqs:
            label = low_reqs[0]["label"]
            questions.append(f"Your profile shows limited evidence for '{label}'. How would you handle this requirement on day one?")

    questions.append(f"What excites you most about this {job_title} role and how does your background uniquely prepare you for it?")

    # Pad to exactly 5 if rule-based generated fewer
    defaults = [
        "Describe a time you had to debug a critical production issue under pressure. What was your process?",
        "How do you stay current with new technologies relevant to this role?",
        "Tell me about a project where you had to collaborate across teams with competing priorities.",
    ]
    for d in defaults:
        if len(questions) >= 5:
            break
        questions.append(d)

    return questions[:5]


def _llm_interview_questions(
    job_title: str,
    jd_description: Optional[str],
    total_score: float,
    matched_skills: List[str],
    skill_gaps: List[str],
    requirements_breakdown: List[Any],
) -> Optional[List[str]]:
    import json as _json
    from app.config import settings
    if not settings.llm_api_key:
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.llm_api_key, base_url=settings.llm_base_url, timeout=settings.llm_timeout)

        req_lines = ""
        if requirements_breakdown:
            low = [r for r in requirements_breakdown if r.get("score", 100) < 50][:3]
            if low:
                req_lines = "Weakest areas: " + ", ".join(r["label"] for r in low)

        user_msg = _IQ_USER_TEMPLATE.format(
            job_title=job_title,
            total_score=round(total_score),
            matched_skills=", ".join(matched_skills[:6]) if matched_skills else "none",
            skill_gaps=", ".join(skill_gaps[:4]) if skill_gaps else "none",
            req_lines=req_lines,
        )

        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": _IQ_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.6,
            max_tokens=400,
        )
        text = (response.choices[0].message.content or "").strip()
        # Strip markdown fences if present
        text = re.sub(r"```(?:json)?", "", text).strip().rstrip("```").strip()
        parsed = _json.loads(text)
        if isinstance(parsed, list) and len(parsed) >= 3:
            return [str(q) for q in parsed[:5]]
        return None
    except Exception as exc:
        logger.warning("Interview questions LLM call failed (%s) — using rule-based", exc)
        return None


def generate_interview_questions(
    job_title: str,
    jd_description: Optional[str],
    total_score: float,
    matched_skills: List[str],
    skill_gaps: List[str],
    requirements_breakdown: Optional[List[Any]] = None,
) -> List[str]:
    """Return 5 targeted interview prep questions. Never raises."""
    reqs = requirements_breakdown or []
    questions = _llm_interview_questions(
        job_title=job_title,
        jd_description=jd_description,
        total_score=total_score,
        matched_skills=matched_skills,
        skill_gaps=skill_gaps,
        requirements_breakdown=reqs,
    )
    if not questions:
        questions = _rule_based_interview_questions(
            job_title=job_title,
            matched_skills=matched_skills,
            skill_gaps=skill_gaps,
            requirements_breakdown=reqs,
        )
    return questions


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def generate_reasoning_summary(
    candidate_name: str,
    job_title: str,
    jd_description: Optional[str],
    total_score: float,
    project_score: float,
    skill_score: float,
    education_score: float,
    matched_skills: List[str],
    skill_gaps: List[str],
    jd_alignment_score: float = 0.0,
    requirements_breakdown: Optional[List[Any]] = None,
) -> str:
    """Return a 2–4 sentence candidate fit summary.

    Tries the LLM first; falls back to a deterministic rule-based paragraph.
    Never raises — always returns a non-empty string.
    """
    reqs = requirements_breakdown or []

    summary = _llm_summary(
        candidate_name=candidate_name,
        job_title=job_title,
        jd_description=jd_description,
        total_score=total_score,
        project_score=project_score,
        skill_score=skill_score,
        education_score=education_score,
        matched_skills=matched_skills,
        skill_gaps=skill_gaps,
        jd_alignment_score=jd_alignment_score,
        requirements_breakdown=reqs,
    )

    if not summary:
        summary = _rule_based_summary(
            candidate_name=candidate_name,
            job_title=job_title,
            total_score=total_score,
            project_score=project_score,
            skill_score=skill_score,
            education_score=education_score,
            matched_skills=matched_skills,
            skill_gaps=skill_gaps,
            jd_alignment_score=jd_alignment_score,
            requirements_breakdown=reqs,
        )

    return summary

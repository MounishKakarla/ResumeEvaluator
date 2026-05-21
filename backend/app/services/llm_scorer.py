"""LLM-based skill scoring service.

Sends resume sections + required skills to any OpenAI-compatible LLM endpoint
and parses a structured JSON response containing per-skill match scores.

Supported providers (set LLM_BASE_URL + LLM_MODEL in .env):
  - OpenAI          base_url=https://api.openai.com/v1      model=gpt-4o-mini
  - Anthropic       base_url=https://api.anthropic.com/v1   model=claude-3-5-haiku-20241022
  - Groq            base_url=https://api.groq.com/openai/v1 model=llama-3-8b-8192
  - Together AI     base_url=https://api.together.xyz/v1    model=mistralai/Mixtral-8x7B
  - Ollama (local)  base_url=http://localhost:11434/v1       model=llama3

Falls back gracefully to TF-IDF scorer when:
  - LLM_API_KEY is not set
  - The API call fails or times out
  - The response cannot be parsed as valid JSON
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt template
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are an expert technical recruiter evaluating resume content.
You will receive a list of required skills and extracted resume sections.
Respond ONLY with a valid JSON object — no markdown, no explanation.
""".strip()

_USER_TEMPLATE = """\
Required skills:
{skills_list}

Resume sections:
{sections_text}

For each required skill return an object with:
  "name"       : exact skill name as given
  "score"      : integer 0-100

  Score guide (use the HIGHEST applicable tier):
    88-100 = skill explicitly named in a Technical Skills / Skills / Programming Languages /
             Databases / Frameworks section (verbatim or near-verbatim match)
    75-87  = skill clearly used in a project, role, or work experience bullet
    55-74  = skill mentioned in education, certification, or coursework context
    25-54  = skill indirectly implied but never explicitly named
    0-24   = skill not present in the resume at all

  IMPORTANT: Any skill that appears word-for-word (or as a recognised alias) in
  a skills/technical-skills list MUST score 88 or above.

  "confidence" : "high" | "medium" | "low"
                 high   = led/architected/built/deployed, or explicitly in skills section
                 medium = used/applied/maintained in projects or experience
                 low    = mentioned in passing / education context only
  "section"    : "projects" | "skills" | "experience" | "education" | "unknown"
  "excerpt"    : shortest relevant quote (≤ 120 chars) or null

Return exactly:
{{"skills": [ ... ]}}
""".strip()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_sections_text(sections: list) -> str:
    """Render section list to a compact plain-text block for the prompt."""
    parts: list[str] = []
    for s in sections:
        header = f"[{s.type.upper()}]"
        body = (s.text or "").strip()[:1200]   # cap per-section to keep prompt small
        if body:
            parts.append(f"{header}\n{body}")
    return "\n\n".join(parts) or "(no sections detected)"


def _parse_llm_response(raw: str) -> list[dict[str, Any]]:
    """Extract the skills array from the LLM JSON response."""
    # Strip markdown code fences if the model wrapped it
    text = re.sub(r"```(?:json)?", "", raw).strip().strip("`").strip()

    data = json.loads(text)
    if isinstance(data, dict) and "skills" in data:
        return data["skills"]
    if isinstance(data, list):
        return data
    raise ValueError(f"Unexpected response shape: {list(data.keys()) if isinstance(data, dict) else type(data)}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def score_with_llm(
    sections: list,
    required_skills: list,
    cosine_threshold: float,
) -> Optional[list[dict[str, Any]]]:
    """Call the configured LLM to score resume skills.

    Returns a list of skill dicts on success, or None if the LLM is not
    configured / unavailable (caller should fall back to TF-IDF).

    Each dict contains: name, score (0-100), confidence, section, excerpt.
    """
    from app.config import settings

    if not settings.llm_api_key:
        return None   # LLM not configured — use TF-IDF

    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            timeout=settings.llm_timeout,
        )

        skills_list = "\n".join(f"- {sk.name}" for sk in required_skills)
        sections_text = _build_sections_text(sections)

        user_content = _USER_TEMPLATE.format(
            skills_list=skills_list,
            sections_text=sections_text,
        )

        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user",   "content": user_content},
            ],
            temperature=0.0,       # deterministic scoring
            max_tokens=1024,
            response_format={"type": "json_object"},   # works on OpenAI + Groq
        )

        raw = response.choices[0].message.content or ""
        return _parse_llm_response(raw)

    except Exception as exc:
        logger.warning("LLM scorer failed (%s) — falling back to TF-IDF", exc)
        return None

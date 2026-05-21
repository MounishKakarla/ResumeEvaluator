"""TF-IDF pre-filter: Stage 1 of the hybrid scoring pipeline.

Computes cosine similarity between a synthesised job-description document
(required skill names + JD text) and the candidate's resume text using a
TF-IDF vectoriser.  A score near 0 means the two documents share almost no
vocabulary — the resume is likely completely irrelevant to the role (e.g. a
chef applying for a DevOps position).  Resumes that fall below the configured
threshold are saved with eval_status='tfidf_filtered' and skip the expensive
LLM evaluation step entirely.

Typical threshold guidance
--------------------------
  0.00  Disabled (default — every resume goes to LLM)
  0.04  Very aggressive: only obvious mismatches are filtered
  0.08  Recommended starting point
  0.15  Moderate: filters ~50 % of a diverse applicant pool
  0.25  Strict: passes only resumes with strong keyword overlap
"""
from __future__ import annotations

import re
from typing import Optional

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


# ---------------------------------------------------------------------------
# Text preprocessing
# ---------------------------------------------------------------------------

_NOISE_RE = re.compile(r"[^\w\s.#+\-]")
_WS_RE = re.compile(r"\s+")


def _clean(text: str) -> str:
    """Lowercase and normalise whitespace while preserving tech chars (+, #, -)."""
    text = text.lower()
    text = _NOISE_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def compute_relevance(
    resume_text: str,
    skill_names: list[str],
    jd_description: Optional[str] = None,
) -> tuple[float, list[str]]:
    """Return ``(relevance_score, matched_keywords)``.

    Parameters
    ----------
    resume_text:
        Full plain-text content of the resume (from ``Resume.raw_text``).
    skill_names:
        Required skill names for the job role (e.g. ``["Python", "Docker"]``).
    jd_description:
        Optional full job-description text.  When provided it is concatenated
        with the skill list to build a richer JD document.

    Returns
    -------
    relevance_score : float in [0, 1]
        TF-IDF cosine similarity between the JD document and the resume.
        Higher means more vocabulary overlap.
    matched_keywords : list[str]
        Subset of ``skill_names`` whose lowercased form appears literally in
        the resume text.  Useful for the reasoning summary.
    """
    # ── Build JD document ────────────────────────────────────────────────────
    jd_parts: list[str] = []
    if skill_names:
        # Repeat each skill name twice to give it more weight in the TF vector
        jd_parts.append(" ".join(skill_names) * 2)
    if jd_description:
        jd_parts.append(jd_description)

    jd_doc = " ".join(jd_parts).strip()

    if not jd_doc or not resume_text.strip():
        return 0.0, []

    jd_clean = _clean(jd_doc)
    resume_clean = _clean(resume_text)

    # ── TF-IDF on the two-document corpus ────────────────────────────────────
    vectorizer = TfidfVectorizer(
        analyzer="word",
        ngram_range=(1, 2),   # unigrams + bigrams ("machine learning", "ci cd")
        min_df=1,
        sublinear_tf=True,    # log(1+tf) — dampens high-frequency noise
        strip_accents="unicode",
    )
    try:
        matrix = vectorizer.fit_transform([jd_clean, resume_clean])
    except ValueError:
        # Empty vocabulary after stop-word removal
        return 0.0, []

    score = float(cosine_similarity(matrix[0:1], matrix[1:2])[0][0])
    score = round(min(max(score, 0.0), 1.0), 4)

    # ── Literal keyword hit-list (for reasoning summary) ─────────────────────
    resume_lower = resume_text.lower()
    matched = [s for s in skill_names if s.lower() in resume_lower]

    return score, matched

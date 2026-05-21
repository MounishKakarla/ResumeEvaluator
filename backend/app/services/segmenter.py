"""4-pass section detection for resume text.

Pass 1 — Candidate heuristics: short line, no terminal punctuation, title/upper-case, not a bullet.
Pass 2 — Exact match against KNOWN_HEADERS dict.
Pass 3 — Fuzzy Levenshtein distance ≤ 2 against every known header.
Pass 4 — Embedding cosine similarity > 0.75 to section centroid embeddings (lazy, needs embedder).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Header → canonical section-type mapping
# ---------------------------------------------------------------------------

KNOWN_HEADERS: Dict[str, str] = {
    # Experience
    "experience": "experience",
    "work experience": "experience",
    "professional experience": "experience",
    "employment history": "experience",
    "work history": "experience",
    # Skills
    "technical skills": "skills",
    "skills": "skills",
    "technologies": "skills",
    "core competencies": "skills",
    "competencies": "skills",
    "key skills": "skills",
    # Projects
    "projects": "projects",
    "technical projects": "projects",
    "personal projects": "projects",
    "academic projects": "projects",
    "academic project": "projects",
    "course projects": "projects",
    "university projects": "projects",
    "college projects": "projects",
    "capstone project": "projects",
    "capstone projects": "projects",
    "open source": "projects",
    "side projects": "projects",
    "notable projects": "projects",
    "highlighted projects": "projects",
    "key projects": "projects",
    "selected projects": "projects",
    # Education
    "education": "education",
    "academic background": "education",
    "academic qualifications": "education",
    "qualifications": "education",
    # Summary
    "summary": "summary",
    "objective": "summary",
    "profile": "summary",
    "professional summary": "summary",
    "career objective": "summary",
    "about me": "summary",
    # Certifications
    "certifications": "certifications",
    "certificates": "certifications",
    "licenses": "certifications",
    # Awards / Other
    "awards": "other",
    "achievements": "other",
    "honors": "other",
    "publications": "other",
    "languages": "other",
    "interests": "other",
    "hobbies": "other",
    "references": "other",
    "volunteer": "other",
    "volunteering": "other",
}

# Centroid phrases used for the embedding fallback (Pass 4)
SECTION_CENTROID_PHRASES: Dict[str, List[str]] = {
    "experience": ["work experience", "employment history", "professional background"],
    "skills": ["technical skills", "programming languages", "technologies used"],
    "projects": ["personal projects", "what I have built", "software I developed"],
    "education": ["academic background", "university degree", "college education"],
    "summary": ["professional summary", "career objective", "about me"],
    "certifications": ["professional certifications", "licenses and certificates"],
    "other": ["awards and achievements", "publications", "references"],
}

# Per-section scoring weight multipliers
SECTION_WEIGHTS: Dict[str, float] = {
    "projects": 1.0,
    "experience": 0.8,
    "skills": 0.6,
    "education": 0.4,
    "summary": 0.3,
    "certifications": 0.5,
    "other": 0.2,
}


# ---------------------------------------------------------------------------
# Data class
# ---------------------------------------------------------------------------

@dataclass
class Section:
    type: str
    title: str
    start_line: int
    end_line: int
    text: str
    confidence: float           # detection confidence 0–1
    weight_multiplier: float    # scoring weight for this section type


# ---------------------------------------------------------------------------
# Pass 1 — header candidate heuristics
# ---------------------------------------------------------------------------

def _is_header_candidate(line: str) -> bool:
    """Return True if *line* could plausibly be a section header.

    Criteria:
    - Stripped length between 2 and 60 characters.
    - Does not end with sentence-terminal punctuation (. ? !).
    - Not a bullet point (-, *, •, ◦, ▪, ▸, ►).
    - At least title-case, ALL-CAPS, or ends with ':'.
    - Not purely numeric/symbolic.
    """
    stripped = line.strip()
    if len(stripped) < 2 or len(stripped) > 60:
        return False
    if re.match(r"^[\-\*•◦▪▸►]", stripped):
        return False
    if stripped[-1] in ".?!":
        return False
    # Must not be purely digits/symbols
    if not any(c.isalpha() for c in stripped):
        return False
    # Title-case, ALL-CAPS, or ends with ':'
    core = stripped.rstrip(":")
    words = core.split()
    is_title = all(w[0].isupper() for w in words if w and w[0].isalpha())
    is_upper = core.isupper()
    ends_colon = stripped.endswith(":")
    return is_title or is_upper or ends_colon


# ---------------------------------------------------------------------------
# Pass 3 — Levenshtein fuzzy match (implemented inline, no external dep)
# ---------------------------------------------------------------------------

def _levenshtein(a: str, b: str) -> int:
    """Compute Levenshtein edit distance between *a* and *b*."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            curr.append(min(
                prev[j] + 1,                  # deletion
                curr[j - 1] + 1,              # insertion
                prev[j - 1] + (ca != cb),     # substitution
            ))
        prev = curr
    return prev[-1]


def _fuzzy_match(candidate_lower: str) -> Optional[str]:
    """Return the section type whose header is within Levenshtein distance 2 of *candidate_lower*."""
    best_dist = 3  # exclusive upper bound
    best_type: Optional[str] = None
    for header, sec_type in KNOWN_HEADERS.items():
        dist = _levenshtein(candidate_lower, header)
        if dist < best_dist:
            best_dist = dist
            best_type = sec_type
        if best_dist == 0:
            break
    return best_type if best_dist <= 2 else None


# ---------------------------------------------------------------------------
# Pass 4 — embedding centroid classifier (lazy, needs embedder loaded)
# ---------------------------------------------------------------------------

_centroid_cache: Optional[Dict[str, "np.ndarray"]] = None  # type: ignore[name-defined]


def _get_centroids() -> Dict[str, "np.ndarray"]:  # type: ignore[name-defined]
    """Lazily compute and cache section centroid embeddings."""
    global _centroid_cache
    if _centroid_cache is not None:
        return _centroid_cache

    import numpy as np
    from app.services.embedder import embedder

    _centroid_cache = {}
    for sec_type, phrases in SECTION_CENTROID_PHRASES.items():
        vecs = embedder.encode_batch(phrases)
        _centroid_cache[sec_type] = np.mean(vecs, axis=0)
    return _centroid_cache


def _embedding_classify(line: str, threshold: float = 0.75) -> Optional[str]:
    """Return section type if *line*'s embedding is within *threshold* cosine of a centroid."""
    from app.services.embedder import embedder

    line_emb = embedder.encode(line)
    centroids = _get_centroids()

    best_score = threshold
    best_type: Optional[str] = None
    for sec_type, centroid in centroids.items():
        score = embedder.cosine_similarity(line_emb, centroid)
        if score > best_score:
            best_score = score
            best_type = sec_type
    return best_type


# ---------------------------------------------------------------------------
# Main segmentation function
# ---------------------------------------------------------------------------

def detect_sections(text: str) -> List[Section]:
    """Detect sections in a resume text using the 4-pass algorithm.

    Args:
        text: Full resume text with newline-delimited lines.

    Returns:
        Ordered list of Section objects.  Falls back to a single generic section
        if no headers are found.
    """
    lines = text.splitlines()
    # Collected headers: (line_index, section_type, original_title, confidence)
    headers: List[Tuple[int, str, str, float]] = []

    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if not _is_header_candidate(stripped):
            continue

        candidate_lower = stripped.lower().rstrip(":")

        # Pass 2: exact match
        if candidate_lower in KNOWN_HEADERS:
            headers.append((idx, KNOWN_HEADERS[candidate_lower], stripped, 1.0))
            continue

        # Pass 3: fuzzy match (Levenshtein ≤ 2)
        fuzzy_type = _fuzzy_match(candidate_lower)
        if fuzzy_type is not None:
            headers.append((idx, fuzzy_type, stripped, 0.85))
            continue

        # Pass 4: embedding fallback (only when embedder is available)
        try:
            emb_type = _embedding_classify(stripped)
            if emb_type is not None:
                headers.append((idx, emb_type, stripped, 0.70))
        except Exception:
            pass  # embedder not loaded or error — skip Pass 4

    # No headers found → treat whole document as one section
    if not headers:
        return [
            Section(
                type="other",
                title="",
                start_line=0,
                end_line=len(lines) - 1,
                text=text,
                confidence=0.5,
                weight_multiplier=SECTION_WEIGHTS.get("other", 0.2),
            )
        ]

    sections: List[Section] = []
    for i, (start_line, sec_type, title, conf) in enumerate(headers):
        end_line = headers[i + 1][0] - 1 if i + 1 < len(headers) else len(lines) - 1
        section_text = "\n".join(lines[start_line + 1 : end_line + 1]).strip()
        sections.append(
            Section(
                type=sec_type,
                title=title,
                start_line=start_line,
                end_line=end_line,
                text=section_text,
                confidence=conf,
                weight_multiplier=SECTION_WEIGHTS.get(sec_type, 0.2),
            )
        )

    return sections


# Backwards-compatible alias used in older code
segment_text = detect_sections

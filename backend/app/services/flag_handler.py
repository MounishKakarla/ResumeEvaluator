"""Consistency Flag Handler (Prompt 4.2).

Processes raw consistency_flags from LinkedIn/GitHub enrichment and attaches
human-readable recruiter_notes with severity tiers.

Rules:
- Flags are for HUMAN REVIEW only — they do NOT reduce the fit_score.
- Severity tiers:
    low    → minor date difference (< 3 months)
    medium → date gap > 3 months OR missing entry on one source
    high   → conflicting company names or degree claims
- If any flag is "high", the candidate needs_manual_review = True.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple


# ---------------------------------------------------------------------------
# Severity classification
# ---------------------------------------------------------------------------

def _classify_severity(flag: Dict[str, Any]) -> str:
    """Return 'low' | 'medium' | 'high' based on flag contents."""
    flag_type = flag.get("flag_type", "")
    field = flag.get("field", "")
    resume_val = flag.get("resume_value")
    linkedin_val = flag.get("linkedin_value")

    if flag_type == "date_mismatch":
        # Try to compute month diff
        diff = _month_diff(resume_val, linkedin_val)
        if diff is None:
            return "medium"
        if diff < 3:
            return "low"
        return "medium"

    if flag_type == "missing_entry":
        # If something is on resume but not LinkedIn (or vice-versa) — medium
        return "medium"

    if flag_type == "company_mismatch":
        return "high"

    if flag_type == "degree_mismatch":
        return "high"

    return "medium"


def _month_diff(d1: Any, d2: Any) -> None | int:
    """Return absolute month diff between two YYYY-MM strings."""
    if not d1 or not d2:
        return None
    try:
        y1, m1 = int(str(d1)[:4]), int(str(d1)[5:7])
        y2, m2 = int(str(d2)[:4]), int(str(d2)[5:7])
        return abs((y1 * 12 + m1) - (y2 * 12 + m2))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Human-readable note generation
# ---------------------------------------------------------------------------

def _generate_recruiter_note(flag: Dict[str, Any], severity: str) -> str:
    """Return a one-sentence plain-language description for the recruiter."""
    flag_type = flag.get("flag_type", "")
    field = flag.get("field", "")
    resume_val = flag.get("resume_value")
    linkedin_val = flag.get("linkedin_value")

    # Extract entity name from field string like "experience.Acme Corp.end_date"
    parts = field.split(".")
    entity = parts[1] if len(parts) > 1 else field

    if flag_type == "date_mismatch":
        sub_field = parts[-1].replace("_", " ") if len(parts) > 2 else "date"
        return (
            f"LinkedIn shows {sub_field} for {entity} as {linkedin_val or 'present'}, "
            f"but resume lists {resume_val or 'present'}."
        )

    if flag_type == "missing_entry":
        if resume_val and not linkedin_val:
            return f"Resume lists employment at {entity}, but no matching entry found on LinkedIn."
        if linkedin_val and not resume_val:
            return f"LinkedIn shows employment at {entity}, which is not listed on the resume."
        return f"Discrepancy found for {entity} between resume and LinkedIn."

    if flag_type == "company_mismatch":
        return (
            f"Company name differs: resume says '{resume_val}', "
            f"LinkedIn shows '{linkedin_val}'."
        )

    if flag_type == "degree_mismatch":
        return (
            f"Education discrepancy: resume claims '{resume_val}', "
            f"LinkedIn shows '{linkedin_val}'."
        )

    return f"Inconsistency detected in field '{field}': resume={resume_val}, LinkedIn={linkedin_val}."


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def process_consistency_flags(
    raw_flags: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], bool]:
    """Convert raw consistency flags to review_flags and determine needs_manual_review.

    Args:
        raw_flags: List of raw flag dicts from enrichment services.
            Each dict must have: field, resume_value, linkedin_value, flag_type.

    Returns:
        Tuple of:
        - review_flags: List of enriched flag dicts with severity and recruiter_note.
        - needs_manual_review: True if any flag is severity "high".
    """
    review_flags: List[Dict[str, Any]] = []
    needs_manual_review = False

    for raw in raw_flags:
        severity = _classify_severity(raw)
        note = _generate_recruiter_note(raw, severity)

        review_flags.append({
            "severity": severity,
            "field": raw.get("field", ""),
            "flag_type": raw.get("flag_type", ""),
            "resume_value": raw.get("resume_value"),
            "linkedin_value": raw.get("linkedin_value"),
            "recruiter_note": note,
        })

        if severity == "high":
            needs_manual_review = True

    return review_flags, needs_manual_review

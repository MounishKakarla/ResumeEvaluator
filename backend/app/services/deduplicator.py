"""SimHash-based resume deduplication.

Uses 64-bit SimHash fingerprints and Hamming distance to detect near-duplicate resumes.
"""

from __future__ import annotations

import re
import string


def _normalize(text: str) -> str:
    """Lowercase, remove punctuation, collapse whitespace."""
    text = text.lower()
    text = text.translate(str.maketrans("", "", string.punctuation))
    text = re.sub(r"\s+", " ", text).strip()
    return text


def compute_fingerprint(text: str) -> str:
    """Compute a 64-bit SimHash fingerprint for the given text.

    Args:
        text: Raw resume text.

    Returns:
        Hex string representation of the 64-bit SimHash value.
    """
    from simhash import Simhash

    normalized = _normalize(text)
    sh = Simhash(normalized, f=64)
    return format(sh.value, "016x")


def hamming_distance(fp1: str, fp2: str) -> int:
    """Compute the Hamming distance between two SimHash hex fingerprints.

    Args:
        fp1: First fingerprint as a hex string.
        fp2: Second fingerprint as a hex string.

    Returns:
        Number of differing bits (Hamming distance).
    """
    val1 = int(fp1, 16)
    val2 = int(fp2, 16)
    xor = val1 ^ val2
    # Count set bits (popcount)
    count = 0
    while xor:
        count += xor & 1
        xor >>= 1
    return count


def is_duplicate(fp1: str, fp2: str, threshold: int = 3) -> bool:
    """Return True if two fingerprints represent near-duplicate documents.

    Args:
        fp1: First fingerprint hex string.
        fp2: Second fingerprint hex string.
        threshold: Maximum Hamming distance to consider as duplicate (default 3).

    Returns:
        True if Hamming distance ≤ threshold.
    """
    return hamming_distance(fp1, fp2) <= threshold

"""Seniority / confidence multiplier extraction using spaCy dependency parsing.

Given a text excerpt and a skill name, walks the dependency tree from the
skill token to its governing verb and maps it to a confidence tier.
"""

from __future__ import annotations

from typing import Optional

# Confidence tiers: multiplier → list of verb lemmas (lowercase)
CONFIDENCE_TIERS: dict[float, list[str]] = {
    1.2: ["lead", "architect", "design", "found", "create", "establish", "spearhead", "pioneer"],
    1.0: [
        "build", "develop", "deploy", "implement", "write", "engineer",
        "launch", "ship", "migrate", "integrate", "deliver", "construct",
    ],
    0.9: ["use", "apply", "maintain", "extend", "contribute", "optimize", "refactor"],
    0.75: ["experience", "work", "familiar"],
    0.55: ["know", "understand", "aware", "expose", "study"],
    0.5: ["learn", "begin", "start", "introduce"],
}

# Build a flat lookup: lemma → multiplier (use highest multiplier if duplicate)
_LEMMA_TO_CONFIDENCE: dict[str, float] = {}
for _mult, _lemmas in CONFIDENCE_TIERS.items():
    for _lemma in _lemmas:
        if _lemma not in _LEMMA_TO_CONFIDENCE or _mult > _LEMMA_TO_CONFIDENCE[_lemma]:
            _LEMMA_TO_CONFIDENCE[_lemma] = _mult

_NEGATION_DEPS = {"neg"}     # Universal dependency label for negation
_NEGATION_MULTIPLIER = 0.1

_nlp = None  # lazy-loaded spaCy model


def _get_nlp():
    """Return the spaCy model, loading it on first access."""
    global _nlp
    if _nlp is None:
        import spacy
        try:
            _nlp = spacy.load("en_core_web_md")
        except OSError:
            # Fallback to small model if medium not available
            _nlp = spacy.load("en_core_web_sm")
    return _nlp


def _walk_to_root_verb(token) -> Optional[str]:
    """Walk the dependency tree upward from *token* until we reach a VERB token.

    Returns the lemma of the first VERB ancestor (or the token itself if it is a verb),
    or None if no verb is found within 5 hops.
    """
    current = token
    for _ in range(5):
        if current.pos_ == "VERB":
            return current.lemma_.lower()
        if current.head == current:
            break  # reached root without finding a verb
        current = current.head
    return None


def _has_negation(token) -> bool:
    """Return True if any direct child of *token* is a negation modifier."""
    return any(child.dep_ in _NEGATION_DEPS for child in token.children)


def get_confidence(text: str, skill_name: str) -> float:
    """Compute a seniority / confidence multiplier for a skill mention in text.

    Algorithm:
    1. Split text into sentences containing skill_name (case-insensitive).
    2. Run spaCy NLP on each qualifying sentence.
    3. Find the token(s) matching skill_name, walk dependency tree to root verb.
    4. Map verb lemma to confidence tier.
    5. Apply negation penalty (×0.1) if any negation is found.
    6. Return the maximum confidence across all sentences.
    7. Default to 0.75 if no governing verb found.

    Args:
        text: A block of text (e.g. a resume section).
        skill_name: The skill to look for (case-insensitive substring match).

    Returns:
        Confidence multiplier in approximately [0.05, 1.2].
    """
    skill_lower = skill_name.lower()

    # Split into sentences (simple approach: split on '. ')
    sentences = [s.strip() for s in text.replace("\n", " ").split(".") if s.strip()]
    matching = [s for s in sentences if skill_lower in s.lower()]

    if not matching:
        return 0.75  # Default: no mention found in text

    nlp = _get_nlp()
    best_confidence: float = 0.0

    for sentence in matching:
        doc = nlp(sentence)

        for token in doc:
            if skill_lower not in token.text.lower():
                continue

            # Walk to governing verb
            verb_lemma = _walk_to_root_verb(token)
            if verb_lemma is None:
                continue

            # Look up confidence
            conf = _LEMMA_TO_CONFIDENCE.get(verb_lemma, 0.75)

            # Negation check on the verb token
            verb_token = token
            current = token
            for _ in range(5):
                if current.pos_ == "VERB":
                    verb_token = current
                    break
                if current.head == current:
                    break
                current = current.head

            if _has_negation(verb_token):
                conf *= _NEGATION_MULTIPLIER

            if conf > best_confidence:
                best_confidence = conf

    return best_confidence if best_confidence > 0.0 else 0.75

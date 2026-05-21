"""PII scrubbing using Microsoft Presidio.

Detects and replaces personally identifiable information with <TYPE> placeholders.
"""

from __future__ import annotations

from typing import List, Optional

# Entities to detect and anonymize
_ENTITIES: List[str] = [
    "PHONE_NUMBER",
    "EMAIL_ADDRESS",
    "PERSON",
    "LOCATION",
    "DATE_TIME",
]

_analyzer = None
_anonymizer = None


def _get_engines():
    """Lazy-load Presidio engines on first use."""
    global _analyzer, _anonymizer

    if _analyzer is None:
        from presidio_analyzer import AnalyzerEngine
        _analyzer = AnalyzerEngine()

    if _anonymizer is None:
        from presidio_anonymizer import AnonymizerEngine
        _anonymizer = AnonymizerEngine()

    return _analyzer, _anonymizer


def scrub(text: str, language: str = "en") -> str:
    """Detect and replace PII entities in text with <TYPE> placeholders.

    Args:
        text: Raw text that may contain PII.
        language: Language code for the analyzer (default "en").

    Returns:
        Anonymized text with PII replaced by placeholders such as
        <PHONE_NUMBER>, <EMAIL_ADDRESS>, <PERSON>, etc.
    """
    if not text or not text.strip():
        return text

    analyzer, anonymizer = _get_engines()

    # Analyze — returns list of RecognizerResult
    results = analyzer.analyze(
        text=text,
        entities=_ENTITIES,
        language=language,
    )

    if not results:
        return text

    # Build operator config: replace each entity type with <ENTITY_TYPE>
    from presidio_anonymizer.entities import OperatorConfig

    operators = {
        entity: OperatorConfig("replace", {"new_value": f"<{entity}>"})
        for entity in _ENTITIES
    }

    anonymized = anonymizer.anonymize(
        text=text,
        analyzer_results=results,
        operators=operators,
    )

    return anonymized.text

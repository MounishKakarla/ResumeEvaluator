"""Singleton sentence-transformer embedder with in-memory caching.

Usage:
    from app.services.embedder import embedder

    embedder.load("all-MiniLM-L6-v2")   # called once at app startup
    vec = embedder.encode("Python developer")
    sim = embedder.cosine_similarity(vec_a, vec_b)
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np


class Embedder:
    """Lazy-singleton wrapper around SentenceTransformer with per-skill and per-section caches."""

    _instance: Optional["Embedder"] = None
    _model = None

    # ------------------------------------------------------------------
    # Singleton factory
    # ------------------------------------------------------------------

    @classmethod
    def get(cls) -> "Embedder":
        """Return the module-level singleton, creating it if necessary."""
        if cls._instance is None:
            cls._instance = cls.__new__(cls)
            cls._instance._model = None
            cls._instance._skill_cache: Dict[str, np.ndarray] = {}
            cls._instance._section_cache: Dict[Tuple[int, str], np.ndarray] = {}
        return cls._instance

    def __init__(self) -> None:
        # Prevent direct instantiation — use Embedder.get()
        self._model = None
        self._skill_cache: Dict[str, np.ndarray] = {}
        self._section_cache: Dict[Tuple[int, str], np.ndarray] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def load(self, model_name: str = "all-MiniLM-L6-v2") -> None:
        """Load the SentenceTransformer model.  Call once during app startup."""
        from sentence_transformers import SentenceTransformer
        self._model = SentenceTransformer(model_name)

    def is_loaded(self) -> bool:
        """Return True if the underlying model has been loaded."""
        return self._model is not None

    # ------------------------------------------------------------------
    # Encoding
    # ------------------------------------------------------------------

    def encode(self, text: str) -> np.ndarray:
        """Encode a single string into a float32 embedding vector.

        Checks the skill name cache first to avoid re-encoding known skills.

        Raises:
            RuntimeError: If the model has not been loaded yet.
        """
        if text in self._skill_cache:
            return self._skill_cache[text]

        if self._model is None:
            raise RuntimeError(
                "Embedder not loaded — call embedder.load(model_name) at app startup."
            )

        vector: np.ndarray = self._model.encode(text, convert_to_numpy=True)
        return vector

    def encode_batch(self, texts: List[str]) -> np.ndarray:
        """Encode a list of strings, returning a 2-D float32 array (n_texts × dim).

        Raises:
            RuntimeError: If the model has not been loaded yet.
        """
        if self._model is None:
            raise RuntimeError(
                "Embedder not loaded — call embedder.load(model_name) at app startup."
            )
        return self._model.encode(texts, convert_to_numpy=True)

    # ------------------------------------------------------------------
    # Similarity
    # ------------------------------------------------------------------

    @staticmethod
    def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        """Cosine similarity between two 1-D vectors.

        Uses a small epsilon (1e-10) to guard against division by zero.
        """
        a_norm = a / (np.linalg.norm(a) + 1e-10)
        b_norm = b / (np.linalg.norm(b) + 1e-10)
        return float(np.dot(a_norm, b_norm))

    # ------------------------------------------------------------------
    # Cache helpers
    # ------------------------------------------------------------------

    def cache_skill(self, skill_name: str, vector: Optional[np.ndarray] = None) -> np.ndarray:
        """Return (and optionally store) the embedding for a skill name.

        If *vector* is provided it is stored directly; otherwise the skill is encoded on demand.
        """
        if skill_name not in self._skill_cache:
            if vector is not None:
                self._skill_cache[skill_name] = vector
            else:
                self._skill_cache[skill_name] = self.encode(skill_name)
        return self._skill_cache[skill_name]

    def cache_section(self, resume_id: int, section_type: str, vector: np.ndarray) -> None:
        """Cache a section embedding keyed by (resume_id, section_type)."""
        self._section_cache[(resume_id, section_type)] = vector

    def get_cached_section(self, resume_id: int, section_type: str) -> Optional[np.ndarray]:
        """Retrieve a previously cached section embedding, or None if not cached."""
        return self._section_cache.get((resume_id, section_type))

    def clear_caches(self) -> None:
        """Clear all in-memory caches.  Useful in tests or when reloading a model."""
        self._skill_cache.clear()
        self._section_cache.clear()


# Module-level singleton — import and use this directly.
embedder = Embedder.get()

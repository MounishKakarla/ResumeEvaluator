"""Portfolio site analysis.

Fetches a candidate's portfolio URL, extracts technology keywords,
project descriptions, and infers a tech stack via HTML/text parsing.
Returns a structured dict stored in candidate.portfolio_summary (JSON).
"""
from __future__ import annotations

import logging
import re
import time
from typing import Optional
from urllib.parse import urljoin, urlparse

logger = logging.getLogger(__name__)

# Common tech stack keywords to scan for in portfolio pages
_TECH_KEYWORDS = [
    # Languages
    "python", "javascript", "typescript", "java", "go", "rust", "c++", "c#",
    "ruby", "php", "swift", "kotlin", "scala", "elixir", "haskell",
    # Frontend
    "react", "vue", "angular", "svelte", "next.js", "nextjs", "nuxt",
    "tailwind", "sass", "webpack", "vite", "redux", "graphql",
    # Backend
    "node.js", "nodejs", "django", "fastapi", "flask", "spring", "rails",
    "express", "nestjs", "laravel", "gin", "fiber",
    # Data / ML
    "tensorflow", "pytorch", "scikit-learn", "pandas", "numpy", "keras",
    "hugging face", "langchain", "openai", "bert", "llm",
    # Cloud / DevOps
    "aws", "gcp", "azure", "docker", "kubernetes", "terraform", "ci/cd",
    "github actions", "jenkins", "ansible",
    # Databases
    "postgresql", "mysql", "mongodb", "redis", "elasticsearch", "sqlite",
    "cassandra", "dynamodb",
    # Mobile
    "react native", "flutter", "android", "ios", "swiftui",
]


def analyze_portfolio(url: str, timeout: int = 10) -> dict:
    """Fetch a portfolio URL and return a structured analysis dict.

    Returns:
        {
            "url": str,
            "title": str,
            "description": str,         # meta description or first paragraph
            "tech_stack": list[str],    # detected tech keywords
            "project_snippets": list[str], # up to 5 project-like headings/paragraphs
            "error": str | None,
        }
    """
    result: dict = {
        "url": url,
        "title": "",
        "description": "",
        "tech_stack": [],
        "project_snippets": [],
        "error": None,
    }

    try:
        import urllib.request
        import html as html_mod

        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            result["error"] = "Invalid URL scheme — only http/https allowed"
            return result

        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; ResumeEvalBot/1.0; +https://tektalis.com)",
                "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
                "Accept-Language": "en-US,en;q=0.5",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content_type = resp.headers.get("Content-Type", "")
            if "text/html" not in content_type and "text/plain" not in content_type:
                result["error"] = f"Non-HTML content type: {content_type}"
                return result
            raw = resp.read(1_000_000).decode("utf-8", errors="replace")

    except Exception as exc:
        logger.warning("Portfolio fetch failed for %s: %s", url, exc)
        result["error"] = str(exc)[:200]
        return result

    # ── Extract title ────────────────────────────────────────────────────────
    title_m = re.search(r"<title[^>]*>(.*?)</title>", raw, re.IGNORECASE | re.DOTALL)
    if title_m:
        result["title"] = _strip_tags(title_m.group(1))[:120]

    # ── Extract meta description ─────────────────────────────────────────────
    desc_m = re.search(
        r'<meta\s+[^>]*name=["\']description["\'][^>]*content=["\']([^"\']*)["\']',
        raw, re.IGNORECASE,
    ) or re.search(
        r'<meta\s+[^>]*content=["\']([^"\']*)["\'][^>]*name=["\']description["\']',
        raw, re.IGNORECASE,
    )
    if desc_m:
        result["description"] = _strip_tags(desc_m.group(1))[:300]

    # ── Strip scripts/styles for cleaner text ───────────────────────────────
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", raw, flags=re.IGNORECASE | re.DOTALL)
    plain = _strip_tags(text)
    plain_lower = plain.lower()

    # ── Detect tech keywords ─────────────────────────────────────────────────
    found: list[str] = []
    for kw in _TECH_KEYWORDS:
        # Word-boundary match (handles "react" not matching "react native" separately etc.)
        pattern = r"\b" + re.escape(kw) + r"\b"
        if re.search(pattern, plain_lower):
            found.append(kw)
    result["tech_stack"] = found

    # ── Extract project-like headings/paragraphs ────────────────────────────
    headings = re.findall(r"<h[1-4][^>]*>(.*?)</h[1-4]>", raw, re.IGNORECASE | re.DOTALL)
    snippets: list[str] = []
    for h in headings:
        clean = _strip_tags(h).strip()
        if 4 < len(clean) < 200:
            snippets.append(clean)
    result["project_snippets"] = snippets[:8]

    if not result["description"] and plain.strip():
        result["description"] = plain.strip()[:300]

    return result


def _strip_tags(html: str) -> str:
    """Remove HTML tags and decode entities."""
    import html as html_mod
    text = re.sub(r"<[^>]+>", " ", html)
    text = html_mod.unescape(text)
    return re.sub(r"\s+", " ", text).strip()

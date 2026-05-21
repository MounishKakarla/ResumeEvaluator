"""LinkedIn Profile Enrichment (Prompt 3.1).

Fetches publicly visible LinkedIn profile data by scraping the public profile
page (no authentication required or used — only publicly accessible data).

Returns merged profile data and consistency_flags for recruiter review.
"""

from __future__ import annotations

import logging
import random
import re
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

import httpx
from bs4 import BeautifulSoup


# ---------------------------------------------------------------------------
# URL validation
# ---------------------------------------------------------------------------

def _normalize_linkedin_url(url: str) -> Optional[str]:
    """Return a canonical linkedin.com/in/<slug> URL, or None if invalid."""
    url = url.strip()
    if not url.startswith("http"):
        url = "https://" + url
    parsed = urlparse(url)
    if "linkedin.com" not in parsed.netloc:
        return None
    path = parsed.path.strip("/")
    if not path.startswith("in/"):
        return None
    return f"https://www.linkedin.com/{path}"


# ---------------------------------------------------------------------------
# Date normalisation helpers
# ---------------------------------------------------------------------------

_MONTH_MAP = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04",
    "may": "05", "jun": "06", "jul": "07", "aug": "08",
    "sep": "09", "oct": "10", "nov": "11", "dec": "12",
}


def _parse_date_str(raw: str) -> Optional[str]:
    """Convert a human date string like 'Jan 2020' or '2020' to YYYY-MM."""
    raw = raw.strip().lower()
    if raw in ("present", "current", "now"):
        return None  # signals ongoing employment

    year_only = re.match(r"^(\d{4})$", raw)
    if year_only:
        return year_only.group(1) + "-01"

    month_year = re.match(r"([a-z]+)\s+(\d{4})", raw)
    if month_year:
        mon = month_year.group(1)[:3]
        yr = month_year.group(2)
        return f"{yr}-{_MONTH_MAP.get(mon, '01')}"

    return None


def _date_diff_months(d1: Optional[str], d2: Optional[str]) -> Optional[int]:
    """Return absolute difference in months between two YYYY-MM strings, or None."""
    if d1 is None or d2 is None:
        return None
    try:
        y1, m1 = int(d1[:4]), int(d1[5:7])
        y2, m2 = int(d2[:4]), int(d2[5:7])
        return abs((y1 * 12 + m1) - (y2 * 12 + m2))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# HTTP helpers with retry
# ---------------------------------------------------------------------------

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


def _scrape_linkedin_html(url: str, timeout: int = 15, max_retries: int = 2) -> Optional[BeautifulSoup]:
    """Fetch public LinkedIn profile HTML with retry and rate-limit handling."""
    delay = 2.0
    for attempt in range(max_retries + 1):
        try:
            resp = httpx.get(url, headers=_HEADERS, timeout=timeout, follow_redirects=True)
            if resp.status_code == 200:
                return BeautifulSoup(resp.text, "html.parser")
            if resp.status_code == 429:
                retry_after = float(resp.headers.get("Retry-After", delay * 2))
                jitter = random.uniform(0, retry_after * 0.25)
                logger.warning("LinkedIn rate-limited (429), waiting %.1fs before retry", retry_after + jitter)
                if attempt < max_retries:
                    time.sleep(retry_after + jitter)
                    delay = retry_after * 2
                continue
            if resp.status_code not in _RETRYABLE_STATUS:
                logger.debug("LinkedIn returned non-retryable status %d for %s", resp.status_code, url)
                return None
        except Exception as exc:
            logger.debug("LinkedIn fetch error on attempt %d/%d: %s", attempt + 1, max_retries + 1, exc)
        if attempt < max_retries:
            jitter = random.uniform(0, delay * 0.3)
            time.sleep(delay + jitter)
            delay = min(delay * 2, 60)
    return None


def _is_auth_wall(soup: BeautifulSoup, url: str) -> bool:
    """Return True when LinkedIn redirected to the login / authwall page."""
    # URL-based detection
    if "authwall" in url or "/login" in url or "checkpoint" in url:
        return True
    # DOM-based: the authwall page has a specific sign-in form
    if soup.find("form", id=re.compile("login", re.I)):
        return True
    h1 = soup.find("h1")
    if h1 and "sign in" in h1.get_text(strip=True).lower():
        return True
    # Meta redirect to /login
    meta_refresh = soup.find("meta", {"http-equiv": re.compile("refresh", re.I)})
    if meta_refresh:
        content = meta_refresh.get("content", "")
        if "login" in content.lower():
            return True
    return False


# ---------------------------------------------------------------------------
# Multi-selector extraction helpers
# ---------------------------------------------------------------------------

def _first_text(soup: BeautifulSoup, selectors: List[Dict[str, Any]]) -> Optional[str]:
    """Try each selector dict in order; return the first non-empty text."""
    for sel in selectors:
        tag = soup.find(**sel)
        if tag:
            text = tag.get_text(strip=True)
            if text:
                return text
    return None


def _extract_name(soup: BeautifulSoup) -> Optional[str]:
    # Primary: og:title meta
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        name = og["content"].split("|")[0].strip()
        if name and "linkedin" not in name.lower():
            return name
    # Fallback chain: various h1/h2 patterns used across LinkedIn HTML versions
    return _first_text(soup, [
        {"name": "h1"},
        {"name": "h2", "class_": re.compile("name|title", re.I)},
        {"name": "span", "class_": re.compile("actor-name|profile-name", re.I)},
        {"name": "div", "class_": re.compile("top-card-layout__title", re.I)},
    ])


def _extract_headline(soup: BeautifulSoup) -> Optional[str]:
    return _first_text(soup, [
        {"name": "div", "class_": re.compile("top-card-layout__headline", re.I)},
        {"name": "h2", "class_": re.compile("headline|tagline", re.I)},
        {"name": "span", "class_": re.compile("headline|summary-tagline", re.I)},
        {"name": "div", "class_": re.compile("pv-text-details__left-panel", re.I)},
    ])


def _find_section_by_attr_or_header(soup: BeautifulSoup, attr_values: List[str], header_keywords: List[str]) -> Optional[Any]:
    """Try data-section attributes first, then fall back to h2/h3 text search."""
    for val in attr_values:
        sec = soup.find("section", {"data-section": val})
        if sec:
            return sec
    # Fallback: scan all sections for a matching header keyword
    for section in soup.find_all("section"):
        for hdr in section.find_all(["h2", "h3"]):
            hdr_text = hdr.get_text(strip=True).lower()
            if any(kw in hdr_text for kw in header_keywords):
                return section
    # Wider fallback: any div/article with an id/class containing the keyword
    for kw in header_keywords:
        for tag in soup.find_all(["div", "article"], id=re.compile(kw, re.I)):
            return tag
        for tag in soup.find_all(["div", "article"], class_=re.compile(kw, re.I)):
            return tag
    return None


def _extract_experience(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    """Extract experience entries with multiple fallback selector strategies."""
    entries: List[Dict[str, Any]] = []

    exp_section = _find_section_by_attr_or_header(
        soup,
        attr_values=["experience", "workExperience"],
        header_keywords=["experience", "work history"],
    )
    if not exp_section:
        return entries

    for item in exp_section.find_all("li"):
        title_tag = (
            item.find(["h3", "span"], class_=re.compile(r"title|position|role", re.I))
            or item.find("h3")
        )
        company_tag = (
            item.find(["h4", "span"], class_=re.compile(r"company|subtitle|org", re.I))
            or item.find("h4")
        )
        date_tags = item.find_all("span", class_=re.compile(r"date|duration|time|period", re.I))

        title = title_tag.get_text(strip=True) if title_tag else None
        company = company_tag.get_text(strip=True) if company_tag else None

        start_date: Optional[str] = None
        end_date: Optional[str] = None
        if len(date_tags) >= 2:
            start_date = _parse_date_str(date_tags[0].get_text(strip=True))
            end_date = _parse_date_str(date_tags[1].get_text(strip=True))
        elif len(date_tags) == 1:
            raw = date_tags[0].get_text(strip=True)
            parts = re.split(r"\s*[–\-—]\s*", raw)
            if len(parts) == 2:
                start_date = _parse_date_str(parts[0])
                end_date = _parse_date_str(parts[1])

        if title or company:
            entries.append({
                "title": title,
                "company": company,
                "start_date": start_date,
                "end_date": end_date,
            })

    return entries


def _extract_education(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    """Extract education entries with multiple fallback selector strategies."""
    entries: List[Dict[str, Any]] = []

    edu_section = _find_section_by_attr_or_header(
        soup,
        attr_values=["educationsDetails", "education", "educations"],
        header_keywords=["education", "academic"],
    )
    if not edu_section:
        return entries

    for item in edu_section.find_all("li"):
        institution_tag = (
            item.find(["h3", "span"], class_=re.compile(r"school|institution|title|org", re.I))
            or item.find("h3")
        )
        degree_tag = (
            item.find(["h4", "span"], class_=re.compile(r"degree|field|subtitle|program", re.I))
            or item.find("h4")
        )
        date_tags = item.find_all("span", class_=re.compile(r"date|duration|time|period", re.I))

        institution = institution_tag.get_text(strip=True) if institution_tag else None
        degree = degree_tag.get_text(strip=True) if degree_tag else None

        start_date: Optional[str] = None
        end_date: Optional[str] = None
        if len(date_tags) >= 2:
            start_date = _parse_date_str(date_tags[0].get_text(strip=True))
            end_date = _parse_date_str(date_tags[1].get_text(strip=True))

        if institution:
            entries.append({
                "institution": institution,
                "degree": degree,
                "start_date": start_date,
                "end_date": end_date,
            })

    return entries


def _extract_skills(soup: BeautifulSoup) -> List[str]:
    """Extract listed skills with multiple fallback strategies."""
    skills_section = _find_section_by_attr_or_header(
        soup,
        attr_values=["skills", "featuredSkills"],
        header_keywords=["skills", "expertise"],
    )

    skill_candidates: List[str] = []

    if skills_section:
        # Strategy 1: span/li with class containing "skill"
        for tag in skills_section.find_all(["span", "li"], class_=re.compile(r"skill|name|text", re.I)):
            skill_candidates.append(tag.get_text(strip=True))
        # Strategy 2: aria-label attributes (LinkedIn uses these on skill pills)
        for tag in skills_section.find_all(attrs={"aria-label": True}):
            skill_candidates.append(tag["aria-label"])

    # Strategy 3: scan whole page for skill-pill patterns if section was empty
    if not skill_candidates:
        for tag in soup.find_all(["span", "a"], class_=re.compile(r"skill-category|endorsement|pill", re.I)):
            skill_candidates.append(tag.get_text(strip=True))

    seen: set = set()
    skills: List[str] = []
    for name in skill_candidates:
        name = name.strip()
        if name and len(name) < 100 and name.lower() not in seen:
            seen.add(name.lower())
            skills.append(name)
    return skills


# ---------------------------------------------------------------------------
# Cross-validation
# ---------------------------------------------------------------------------

def _cross_validate_experience(
    resume_exp: List[Dict[str, Any]],
    linkedin_exp: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Match resume and LinkedIn experience entries; return (merged_entries, consistency_flags)."""
    merged: List[Dict[str, Any]] = []
    flags: List[Dict[str, Any]] = []

    linkedin_companies_lower = {
        (e.get("company") or "").lower(): e for e in linkedin_exp
    }

    for res_entry in resume_exp:
        company_lower = (res_entry.get("company") or "").lower()
        li_match = linkedin_companies_lower.get(company_lower)

        if li_match:
            entry = dict(res_entry)
            entry["validated"] = True
            entry["linkedin_title"] = li_match.get("title")

            res_end = res_entry.get("end_date")
            li_end = li_match.get("end_date")
            diff = _date_diff_months(res_end, li_end)

            if diff is not None and diff > 3:
                flags.append({
                    "field": f"experience.{res_entry.get('company')}.end_date",
                    "resume_value": res_end,
                    "linkedin_value": li_end,
                    "flag_type": "date_mismatch",
                })
            merged.append(entry)
        else:
            entry = dict(res_entry)
            entry["validated"] = False
            merged.append(entry)
            flags.append({
                "field": f"experience.{res_entry.get('company')}",
                "resume_value": res_entry.get("company"),
                "linkedin_value": None,
                "flag_type": "missing_entry",
            })

    resume_companies_lower = {(e.get("company") or "").lower() for e in resume_exp}
    for li_entry in linkedin_exp:
        if (li_entry.get("company") or "").lower() not in resume_companies_lower:
            flags.append({
                "field": f"experience.{li_entry.get('company')}",
                "resume_value": None,
                "linkedin_value": li_entry.get("company"),
                "flag_type": "missing_entry",
            })

    return merged, flags


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def enrich_from_linkedin(
    linkedin_url: str,
    resume_experience: Optional[List[Dict[str, Any]]] = None,
    resume_education: Optional[List[Dict[str, Any]]] = None,
    timeout: int = 15,
) -> Dict[str, Any]:
    """Fetch public LinkedIn profile and cross-validate against resume data."""
    resume_experience = resume_experience or []
    resume_education = resume_education or []

    canonical_url = _normalize_linkedin_url(linkedin_url)
    if not canonical_url:
        return {
            "name": None, "headline": None, "experience": [],
            "education": [], "linkedin_skills": [], "consistency_flags": [],
            "error": f"Invalid LinkedIn URL: {linkedin_url}",
        }

    soup = _scrape_linkedin_html(canonical_url, timeout=timeout)
    if soup is None:
        return {
            "name": None, "headline": None, "experience": [],
            "education": [], "linkedin_skills": [], "consistency_flags": [],
            "error": "Failed to fetch LinkedIn profile (may be private or rate-limited)",
        }

    # Detect auth-wall / login redirect before parsing
    final_url = canonical_url  # httpx follow_redirects already resolved this
    if _is_auth_wall(soup, final_url):
        return {
            "name": None, "headline": None, "experience": [],
            "education": [], "linkedin_skills": [], "consistency_flags": [],
            "error": "LinkedIn requires login to view this profile (authwall detected)",
        }

    name = _extract_name(soup)
    headline = _extract_headline(soup)
    linkedin_exp = _extract_experience(soup)
    linkedin_edu = _extract_education(soup)
    linkedin_skills = _extract_skills(soup)

    merged_exp, exp_flags = _cross_validate_experience(resume_experience, linkedin_exp)

    # Warn when the profile parsed but yielded no structured data at all
    partial_warn: Optional[str] = None
    if not linkedin_exp and not linkedin_edu and not linkedin_skills and not name:
        partial_warn = (
            "Profile fetched but no structured data extracted — "
            "LinkedIn may have changed its HTML layout"
        )

    return {
        "name": name,
        "headline": headline,
        "experience": merged_exp,
        "education": linkedin_edu,
        "linkedin_skills": linkedin_skills,
        "consistency_flags": exp_flags,
        "error": partial_warn,
    }

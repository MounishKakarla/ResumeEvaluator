"""GitHub Profile Analysis.

Calls the public GitHub REST API (no auth required) to analyze a candidate's
public repositories. Provides two modes:

  analyze_github_profile()  — lightweight activity/skill summary used during auto-enrichment
  analyze_github_projects() — deep per-repo analysis (README fetch + requirement matching)
                               triggered on-demand via POST /enrich/{id}/projects
"""

from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_username(github_url: str) -> Optional[str]:
    """Return the GitHub username from a profile URL or raw username string."""
    github_url = github_url.strip()
    if github_url.startswith("http"):
        path = urlparse(github_url).path.strip("/")
        parts = path.split("/")
        # github.com/<username>  or  github.com/<username>/...
        return parts[0] if parts and parts[0] else None
    # Accept plain username
    if re.match(r'^[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,37}[a-zA-Z0-9])?$', github_url):
        return github_url
    return None


def _months_since(iso_date: str) -> float:
    """Return fractional months elapsed since *iso_date* (ISO 8601 string)."""
    try:
        dt = datetime.fromisoformat(iso_date.rstrip("Z")).replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        delta = now - dt
        return delta.days / 30.44
    except Exception:
        return 999.0


# ---------------------------------------------------------------------------
# Activity score computation
# ---------------------------------------------------------------------------

def _compute_activity_score(repos: List[Dict[str, Any]]) -> int:
    """Compute a 0-100 GitHub activity score from public repo data.

    Formula:
    - Repo count:    min(len(repos), 30) / 30  * 30  (max 30 pts)
    - Recent repos:  repos updated < 12 months  / max(len,1)  * 40  (max 40 pts)
    - Total stars:   min(total_stars, 50) / 50  * 30  (max 30 pts)
    """
    if not repos:
        return 0

    repo_count_pts = min(len(repos), 30) / 30 * 30

    recent = sum(1 for r in repos if _months_since(r.get("updated_at", "")) < 12)
    recent_pts = (recent / max(len(repos), 1)) * 40

    total_stars = sum(r.get("stargazers_count", 0) for r in repos)
    star_pts = min(total_stars, 50) / 50 * 30

    return int(round(repo_count_pts + recent_pts + star_pts))


# ---------------------------------------------------------------------------
# JD skill matching
# ---------------------------------------------------------------------------

def _match_jd_skills(repos: List[Dict[str, Any]], jd_skills: List[str]) -> List[Dict[str, Any]]:
    """Return repos whose name or description fuzzy-mention any JD skill."""
    relevant: List[Dict[str, Any]] = []
    skill_lower = [s.lower() for s in jd_skills]

    for repo in repos:
        repo_text = (
            (repo.get("name") or "") + " " + (repo.get("description") or "")
        ).lower()
        matched_skills = [s for s in skill_lower if s in repo_text or repo_text in s]
        if matched_skills:
            relevant.append({
                "name": repo.get("name"),
                "description": repo.get("description"),
                "language": repo.get("language"),
                "stars": repo.get("stargazers_count", 0),
                "matched_skills": matched_skills,
            })

    return relevant


# ---------------------------------------------------------------------------
# Language aggregation
# ---------------------------------------------------------------------------

def _aggregate_languages(repos: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return ranked list of programming languages by repo count."""
    lang_count: Dict[str, int] = {}
    for repo in repos:
        lang = repo.get("language")
        if lang:
            lang_count[lang] = lang_count.get(lang, 0) + 1

    return sorted(
        [{"language": lang, "repo_count": cnt} for lang, cnt in lang_count.items()],
        key=lambda x: x["repo_count"],
        reverse=True,
    )


# ---------------------------------------------------------------------------
# Package manifest scanning — reads dependency files from a repo
# ---------------------------------------------------------------------------

_MANIFEST_FILES = [
    "requirements.txt",
    "package.json",
    "Pipfile",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "Cargo.toml",
    "composer.json",
    "pyproject.toml",
]

# Common utility/tooling packages that don't represent a meaningful skill signal
_MANIFEST_NOISE = {
    "babel", "eslint", "prettier", "webpack", "jest", "mocha", "chai",
    "nodemon", "dotenv", "cross-env", "rimraf", "husky", "lint-staged",
    "typescript", "ts-node", "@types", "autoprefixer", "postcss",
    "setuptools", "pip", "wheel", "pytest", "black", "flake8", "mypy",
    "coverage", "tox", "virtualenv", "packaging", "six", "certifi",
    "charset-normalizer", "urllib3", "idna", "requests-oauthlib",
}


def _fetch_manifests(
    client: httpx.Client,
    username: str,
    repo_name: str,
) -> List[str]:
    """Fetch package manifests from a repo and return inferred technology names.

    Reads requirements.txt, package.json, go.mod, etc. and extracts dependency
    names as skill evidence. Returns at most 40 package names, noise-filtered.
    """
    found: List[str] = []
    base = "https://api.github.com"

    for filename in _MANIFEST_FILES:
        try:
            resp = client.get(f"{base}/repos/{username}/{repo_name}/contents/{filename}")
            if resp.status_code != 200:
                continue
            content_b64 = resp.json().get("content", "").replace("\n", "")
            content = base64.b64decode(content_b64).decode("utf-8", errors="replace")

            if filename == "package.json":
                try:
                    pkg = json.loads(content)
                    deps = (
                        list(pkg.get("dependencies", {}).keys())
                        + list(pkg.get("devDependencies", {}).keys())
                    )
                    for d in deps:
                        name = d.lstrip("@").split("/")[0]
                        if name and name.lower() not in _MANIFEST_NOISE:
                            found.append(name)
                except (json.JSONDecodeError, AttributeError):
                    pass

            elif filename in ("requirements.txt", "Pipfile"):
                for line in content.splitlines():
                    line = line.strip()
                    if not line or line.startswith(("#", "[", "-r", "git+")):
                        continue
                    pkg_name = re.split(r"[>=<!;#\s]", line)[0].strip()
                    if pkg_name and pkg_name.lower() not in _MANIFEST_NOISE:
                        found.append(pkg_name)

            elif filename == "go.mod":
                for m in re.finditer(r'^\s+(\S+)\s+v[\d.]+', content, re.M):
                    parts = m.group(1).rstrip("/").split("/")
                    name = parts[-1] if parts else ""
                    if name and name.lower() not in _MANIFEST_NOISE:
                        found.append(name)

            elif filename == "pyproject.toml":
                for m in re.finditer(r'"([a-zA-Z0-9_\-]+)\s*[>=<]', content):
                    name = m.group(1)
                    if name and name.lower() not in _MANIFEST_NOISE:
                        found.append(name)

        except Exception:
            continue

        if len(found) >= 40:
            break

    return list(dict.fromkeys(found))[:40]  # deduplicate while preserving order


# ---------------------------------------------------------------------------
# Inferred skills from GitHub
# ---------------------------------------------------------------------------

def _infer_skills(repos: List[Dict[str, Any]], existing_skill_names: List[str]) -> List[Dict[str, Any]]:
    """Produce skill objects inferred from repo languages and names."""
    lang_repos: Dict[str, List[str]] = {}
    for repo in repos:
        lang = repo.get("language")
        if lang:
            lang_repos.setdefault(lang, []).append(repo.get("name", ""))

    inferred: List[Dict[str, Any]] = []
    existing_lower = {s.lower() for s in existing_skill_names}
    for lang, repo_names in lang_repos.items():
        if lang.lower() not in existing_lower:
            inferred.append({
                "name": lang,
                "source": "github",
                "evidence": repo_names[:5],
            })
    return inferred


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def analyze_github_profile(
    github_url: str,
    jd_skills: Optional[List[str]] = None,
    existing_skills: Optional[List[str]] = None,
    timeout: int = 15,
) -> Dict[str, Any]:
    """Analyze a GitHub profile and return a github_summary dict.

    Args:
        github_url: Full GitHub URL or username string.
        jd_skills: Skill names from the active JD (for relevant_repos matching).
        existing_skills: Skills already on the candidate profile (to avoid duplicates).
        timeout: HTTP request timeout in seconds.

    Returns:
        {
            "username": str,
            "languages": [{ language, repo_count }],
            "relevant_repos": [...],
            "activity_score": int (0-100),
            "inferred_skills": [{ name, source, evidence }],
            "public_repos": int,
            "error": str | None,
        }
    """
    jd_skills = jd_skills or []
    existing_skills = existing_skills or []

    username = _extract_username(github_url)
    if not username:
        return {"username": None, "error": f"Could not extract username from: {github_url}"}

    base = "https://api.github.com"
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}

    try:
        with httpx.Client(timeout=timeout, headers=headers) as client:
            # Fetch user profile for public_repos count
            user_resp = client.get(f"{base}/users/{username}")
            if user_resp.status_code == 404:
                return {"username": username, "error": "GitHub user not found"}
            user_resp.raise_for_status()
            user_data = user_resp.json()

            # Fetch all public repos (paginate up to 100)
            repos_resp = client.get(
                f"{base}/users/{username}/repos",
                params={"per_page": 100, "sort": "updated", "type": "owner"},
            )
            repos_resp.raise_for_status()
            repos: List[Dict[str, Any]] = repos_resp.json()

    except httpx.HTTPStatusError as exc:
        return {"username": username, "error": f"GitHub API error: {exc.response.status_code}"}
    except Exception as exc:
        return {"username": username, "error": f"Request failed: {exc}"}

    languages = _aggregate_languages(repos)
    relevant_repos = _match_jd_skills(repos, jd_skills)
    activity_score = _compute_activity_score(repos)
    inferred_skills = _infer_skills(repos, existing_skills)

    # Scan package manifests of the top 4 repos (by recency) to enrich inferred skills.
    # This surfaces dependencies listed in requirements.txt / package.json even if the
    # repo name/description doesn't mention them explicitly.
    manifest_techs: List[str] = []
    existing_lower = {s["name"].lower() for s in inferred_skills}
    top_repos = repos[:4]
    try:
        with httpx.Client(timeout=10, headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}) as manifest_client:
            for repo in top_repos:
                repo_name = repo.get("name", "")
                if not repo_name:
                    continue
                pkgs = _fetch_manifests(manifest_client, username, repo_name)
                for pkg in pkgs:
                    if pkg.lower() not in existing_lower:
                        manifest_techs.append(pkg)
                        existing_lower.add(pkg.lower())
    except Exception:
        pass  # manifest scan is best-effort — never fail the main enrichment

    if manifest_techs:
        inferred_skills.extend([
            {"name": pkg, "source": "manifest", "evidence": []}
            for pkg in manifest_techs[:30]
        ])

    return {
        "username": username,
        "public_repos": user_data.get("public_repos", len(repos)),
        "languages": languages,
        "relevant_repos": relevant_repos,
        "activity_score": activity_score,
        "inferred_skills": inferred_skills,
        "manifest_techs": manifest_techs[:30],
        "error": None,
    }


# ---------------------------------------------------------------------------
# Deep project analysis (on-demand)
# ---------------------------------------------------------------------------

def _fetch_readme(client: httpx.Client, username: str, repo_name: str) -> str:
    """Fetch and decode the README for a repo. Returns empty string on any failure."""
    try:
        resp = client.get(f"https://api.github.com/repos/{username}/{repo_name}/readme")
        if resp.status_code != 200:
            return ""
        content_b64 = resp.json().get("content", "").replace("\n", "")
        raw = base64.b64decode(content_b64).decode("utf-8", errors="replace")
        return raw[:4000]  # cap to avoid excessive context
    except Exception:
        return ""


def _match_requirements(
    combined_text: str,
    jd_skills: List[str],
    job_requirements: Optional[List[Dict[str, Any]]],
) -> tuple[List[str], List[Dict[str, Any]]]:
    """Return (matched_skills, requirement_match_list) for a project's combined text."""
    text_lower = combined_text.lower()

    matched_skills = [s for s in jd_skills if s.lower() in text_lower]

    req_matches: List[Dict[str, Any]] = []
    for req in (job_requirements or []):
        label = req.get("label", "")
        description = req.get("description", "")
        req_text = (label + " " + description).lower()
        # Match if the requirement label keyword appears, or ≥2 meaningful words overlap
        _stop = {"and", "or", "the", "a", "an", "in", "with", "for", "to", "of", "is", "are"}
        req_words = {w for w in re.findall(r"[a-z0-9#+.]+", req_text) if w not in _stop and len(w) > 2}
        text_words = set(re.findall(r"[a-z0-9#+.]+", text_lower))
        overlap = req_words & text_words
        matched = len(overlap) >= 2 or label.lower() in text_lower
        req_matches.append({
            "requirement": label,
            "matched": matched,
            "evidence": ", ".join(list(overlap)[:5]) if overlap else "",
        })

    return matched_skills, req_matches


def analyze_github_projects(
    github_url: str,
    jd_skills: Optional[List[str]] = None,
    job_requirements: Optional[List[Dict[str, Any]]] = None,
    max_repos: int = 8,
    timeout: int = 25,
) -> Dict[str, Any]:
    """Deep per-repo analysis of a candidate's GitHub projects against job requirements.

    For each of the top *max_repos* repos (ranked by JD-skill relevance, then stars):
      - Fetches the repo's README
      - Extracts tech stack from name, description, language, topics, and README
      - Matches against jd_skills and job_requirements
      - Computes a per-project match_score

    Returns a structured dict suitable for storage in candidate.project_analysis.

    Args:
        github_url:       Full GitHub URL or plain username.
        jd_skills:        Skill names from the target job role.
        job_requirements: List of {label, description, weight} dicts from JobRoleRequirement.
        max_repos:        Maximum number of repos to analyse (default 8).
        timeout:          HTTP timeout in seconds.
    """
    jd_skills = jd_skills or []
    job_requirements = job_requirements or []

    username = _extract_username(github_url)
    if not username:
        return {"error": f"Invalid GitHub URL: {github_url}", "projects": []}

    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}

    try:
        with httpx.Client(timeout=timeout, headers=headers) as client:
            repos_resp = client.get(
                f"https://api.github.com/users/{username}/repos",
                params={"per_page": 100, "sort": "updated", "type": "owner"},
            )
            if repos_resp.status_code == 404:
                return {"error": "GitHub user not found", "projects": [], "username": username}
            repos_resp.raise_for_status()
            repos: List[Dict[str, Any]] = repos_resp.json()

    except httpx.HTTPStatusError as exc:
        return {"username": username, "error": f"GitHub API error: {exc.response.status_code}", "projects": []}
    except Exception as exc:
        return {"username": username, "error": f"Request failed: {exc}", "projects": []}

    # Rank repos: JD-skill hits first, then by stars, then by recency
    skill_lower = [s.lower() for s in jd_skills]

    def _rank(r: Dict[str, Any]) -> tuple:
        text = ((r.get("name") or "") + " " + (r.get("description") or "")).lower()
        hits = sum(1 for s in skill_lower if s in text)
        return (hits, r.get("stargazers_count", 0))

    top_repos = sorted(repos, key=_rank, reverse=True)[:max_repos]

    projects: List[Dict[str, Any]] = []
    all_matched_skills: set = set()

    try:
        with httpx.Client(timeout=timeout, headers=headers) as client:
            for repo in top_repos:
                repo_name = repo.get("name", "")
                readme = _fetch_readme(client, username, repo_name)

                combined = " ".join(filter(None, [
                    repo.get("name", ""),
                    repo.get("description", ""),
                    repo.get("language", ""),
                    " ".join(repo.get("topics") or []),
                    readme,
                ]))

                matched_skills, req_matches = _match_requirements(
                    combined, jd_skills, job_requirements
                )
                all_matched_skills.update(matched_skills)

                total_reqs = len(job_requirements) if job_requirements else len(jd_skills)
                matched_count = (
                    sum(1 for r in req_matches if r["matched"]) if job_requirements
                    else len(matched_skills)
                )
                match_score = round(matched_count / max(total_reqs, 1), 2)

                projects.append({
                    "name": repo_name,
                    "url": f"https://github.com/{username}/{repo_name}",
                    "source": "github",
                    "description": repo.get("description") or "",
                    "language": repo.get("language") or "",
                    "stars": repo.get("stargazers_count", 0),
                    "topics": repo.get("topics") or [],
                    "last_updated": repo.get("updated_at", ""),
                    "matched_skills": matched_skills,
                    "requirement_matches": req_matches,
                    "match_score": match_score,
                    "readme_snippet": readme[:500] if readme else "",
                })

    except Exception as exc:
        return {"username": username, "error": f"Repo analysis failed: {exc}", "projects": projects}

    unmatched_skills = [s for s in jd_skills if s.lower() not in {x.lower() for x in all_matched_skills}]
    overall_score = int(round(len(all_matched_skills) / max(len(jd_skills), 1) * 100)) if jd_skills else 0

    return {
        "username": username,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "projects": projects,
        "total_repos_analyzed": len(projects),
        "overall_match_score": overall_score,
        "matched_skills": sorted(all_matched_skills),
        "unmatched_skills": unmatched_skills,
        "error": None,
    }

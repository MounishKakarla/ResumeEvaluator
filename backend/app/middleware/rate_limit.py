"""Simple in-process sliding-window rate limiter middleware.

For production with multiple workers, replace the in-memory store with Redis
(e.g. via `limits` + `redis`). This implementation is safe for single-worker
deployments and development.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock
from typing import Callable, Deque, Dict, Optional, Tuple

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

# (ip, path_prefix) → deque of request timestamps
_window: Dict[Tuple[str, str], Deque[float]] = defaultdict(deque)
_lock = Lock()

# Route-specific limits: (path_prefix, window_seconds, max_requests)
_ROUTE_LIMITS: list[Tuple[str, int, int]] = [
    ("/auth/login",    60,  10),   # 10 login attempts per minute
    ("/auth/register", 60,   5),   # 5 registrations per minute
    ("/upload",        60,  30),   # 30 uploads per minute
]
_DEFAULT_LIMIT = (60, 300)         # 300 requests per minute for everything else


def _client_ip(request: Request) -> str:
    """Return client IP, respecting X-Forwarded-For when behind a trusted proxy."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(ip: str, path: str) -> Optional[JSONResponse]:
    """Return a 429 response if the client has exceeded their rate limit, else None."""
    now = time.monotonic()

    window_secs, max_req = _DEFAULT_LIMIT
    matched_prefix = ""
    for prefix, w, m in _ROUTE_LIMITS:
        if path.startswith(prefix):
            window_secs, max_req = w, m
            matched_prefix = prefix
            break

    key = (ip, matched_prefix or "__default__")

    with _lock:
        dq = _window[key]
        cutoff = now - window_secs
        while dq and dq[0] < cutoff:
            dq.popleft()

        if len(dq) >= max_req:
            retry_after = int(window_secs - (now - dq[0])) + 1
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down."},
                headers={"Retry-After": str(retry_after)},
            )

        dq.append(now)
    return None


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Apply sliding-window rate limiting to all API requests."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Only rate-limit API paths (not health / static files)
        path = request.url.path
        if path in ("/health", "/ready") or path.startswith("/uploads/"):
            return await call_next(request)

        ip = _client_ip(request)
        rejection = _check_rate_limit(ip, path)
        if rejection is not None:
            return rejection

        return await call_next(request)

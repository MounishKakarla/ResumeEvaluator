from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings
from app.schemas import TokenData

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if the plain-text password matches the bcrypt hash."""
    return pwd_context.verify(plain, hashed)


def get_password_hash(password: str) -> str:
    """Return a bcrypt hash of *password*."""
    return pwd_context.hash(password)


# Internal alias used by seed.py and older call sites
hash_password = get_password_hash


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a signed JWT.

    Args:
        data: Payload dict.  Should contain at least ``sub`` (user id as str).
        expires_delta: Custom TTL.  Defaults to ``settings.access_token_expire_minutes``.

    Returns:
        Encoded JWT string.
    """
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta if expires_delta is not None
        else timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def create_refresh_token(data: dict) -> str:
    """Create a long-lived refresh token (type='refresh', 7-day TTL by default)."""
    to_encode = data.copy()
    to_encode["exp"] = datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days)
    to_encode["type"] = "refresh"
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def decode_refresh_token(token: str) -> TokenData:
    """Decode and validate a refresh token.  Raises JWTError if invalid or wrong type."""
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    if payload.get("type") != "refresh":
        raise JWTError("Not a refresh token")
    raw_sub = payload.get("sub")
    if raw_sub is None:
        raise JWTError("Token payload missing 'sub'")
    return TokenData(user_id=int(raw_sub), email=payload.get("email"), role=payload.get("role"))


def decode_token(token: str) -> TokenData:
    """Decode and validate a JWT token.

    Args:
        token: Encoded JWT string.

    Returns:
        Populated TokenData.

    Raises:
        JWTError: If the token is invalid, expired, or missing required claims.
    """
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])

    raw_sub = payload.get("sub")
    if raw_sub is None:
        raise JWTError("Token payload missing 'sub'")

    return TokenData(
        user_id=int(raw_sub),
        email=payload.get("email"),
        role=payload.get("role"),
    )

from typing import Generator

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.auth import decode_token
from app.database import SessionLocal
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yield a SQLAlchemy session; roll back on unhandled exceptions."""
    db: Session = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Decode the Bearer JWT and return the matching active User ORM object.

    Raises:
        HTTPException 401: If the token is invalid/expired, the user no longer exists,
                           or the account has been revoked.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        token_data = decode_token(token)
    except JWTError:
        raise credentials_exception

    if token_data.user_id is None:
        raise credentials_exception

    user: User | None = db.query(User).filter(User.id == token_data.user_id).first()
    if user is None:
        raise credentials_exception

    try:
        is_active = bool(user.is_active)
    except Exception:
        is_active = True  # column not yet migrated — default allow
    if not is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been revoked. Contact your administrator.",
        )

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Raise 403 if the authenticated user does not have the ``admin`` role.

    Returns:
        The current user when they are an admin.
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user

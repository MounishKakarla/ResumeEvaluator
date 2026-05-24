import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy.orm import Session

from app.auth import create_access_token, create_refresh_token, decode_refresh_token, get_password_hash, verify_password
from app.deps import get_current_user, get_db
from app.models import User
from app.routers.audit import record_audit
from app.schemas import ChangePasswordRequest, ForgotPasswordRequest, RefreshRequest, Token, UserLogin

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_token_pair(user: User) -> Token:
    payload = {"sub": str(user.id), "email": user.email, "role": user.role}
    return Token(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
        token_type="bearer",
        role=user.role,
        email=user.email,
    )


@router.post("/login", response_model=Token)
def login(body: UserLogin, db: Session = Depends(get_db)) -> Token:
    """Authenticate a user and return access + refresh tokens."""
    user: User | None = db.query(User).filter(User.email == body.email).first()
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    record_audit(db, user.id, "login", "user", user.id)
    db.commit()
    return _issue_token_pair(user)


@router.post("/change-password", status_code=status.HTTP_200_OK)
def change_password(
    body: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Verify current password, set new hash, and signal the client to log out."""
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    current_user.hashed_password = get_password_hash(body.new_password)
    record_audit(db, current_user.id, "password_changed", "user", current_user.id)
    db.commit()
    return {"message": "Password updated. Please log in again."}


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)) -> dict:
    """Generate a temporary password and email it. Always returns the same message to avoid leaking account existence."""
    user: User | None = db.query(User).filter(User.email == body.email, User.is_active == True).first()  # noqa: E712
    if user is not None:
        alphabet = string.ascii_letters + string.digits + "!@#$%"
        new_password = "".join(secrets.choice(alphabet) for _ in range(12))
        user.hashed_password = get_password_hash(new_password)
        record_audit(db, user.id, "password_reset_requested", "user", user.id)
        db.commit()
        name = user.email.split("@")[0].replace(".", " ").title()
        try:
            from app.services.email import send_password_reset_email
            send_password_reset_email(user.email, name, new_password)
        except Exception:
            pass
    return {"message": "If that email address is registered, a temporary password has been sent."}


@router.post("/refresh", response_model=Token)
def refresh(body: RefreshRequest, db: Session = Depends(get_db)) -> Token:
    """Exchange a valid refresh token for a new access + refresh token pair."""
    try:
        token_data = decode_refresh_token(body.refresh_token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(User).filter(User.id == token_data.user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return _issue_token_pair(user)

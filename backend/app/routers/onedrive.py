"""OneDrive ingestion config router.

POST /admin/onedrive/config  — Store OneDrive folder ID + poll interval
GET  /admin/onedrive/config  — Retrieve current OneDrive config
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_admin
from app.models import SystemSetting, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/onedrive", tags=["onedrive"])

_KEY_FOLDER_ID = "onedrive_folder_id"
_KEY_FOLDER_NAME = "onedrive_folder_name"
_KEY_POLL_INTERVAL = "onedrive_poll_interval_minutes"
_KEY_ENABLED = "onedrive_enabled"


class OneDriveConfig(BaseModel):
    folder_id: Optional[str] = None       # Microsoft Graph item ID
    folder_name: Optional[str] = None     # Display name / path for UI
    poll_interval_minutes: int = Field(default=5, ge=1, le=60)
    enabled: bool = False


@router.post("/config", status_code=status.HTTP_200_OK)
def set_onedrive_config(
    config: OneDriveConfig,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(require_admin),
) -> dict:
    """Save OneDrive folder picker config to SystemSettings.
    
    The background Graph polling worker will read this config on its next cycle
    and poll /me/drive/items/{folder_id}/children for new PDF/DOCX files.
    """
    _set_setting(db, _KEY_FOLDER_ID, config.folder_id or "")
    _set_setting(db, _KEY_FOLDER_NAME, config.folder_name or "")
    _set_setting(db, _KEY_POLL_INTERVAL, str(config.poll_interval_minutes))
    _set_setting(db, _KEY_ENABLED, "true" if config.enabled else "false")
    db.commit()
    logger.info(
        "OneDrive config updated by user %d: folder=%s interval=%dm",
        current_user.id,
        config.folder_id,
        config.poll_interval_minutes,
    )
    return {
        "message": "OneDrive configuration saved",
        "folder_id": config.folder_id,
        "folder_name": config.folder_name,
        "poll_interval_minutes": config.poll_interval_minutes,
        "enabled": config.enabled,
    }


@router.get("/config", response_model=OneDriveConfig)
def get_onedrive_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(require_admin),
) -> OneDriveConfig:
    """Return current OneDrive polling configuration."""
    interval_raw = _get_setting(db, _KEY_POLL_INTERVAL)
    return OneDriveConfig(
        folder_id=_get_setting(db, _KEY_FOLDER_ID) or None,
        folder_name=_get_setting(db, _KEY_FOLDER_NAME) or None,
        poll_interval_minutes=int(interval_raw) if interval_raw and interval_raw.isdigit() else 5,
        enabled=_get_setting(db, _KEY_ENABLED) == "true",
    )


def _get_setting(db: Session, key: str) -> Optional[str]:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    return row.value if row else None


def _set_setting(db: Session, key: str, value: str) -> None:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(SystemSetting(key=key, value=value))

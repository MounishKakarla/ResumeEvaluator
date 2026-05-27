"""SharePoint connector stub router.

POST /admin/sharepoint/connect  — Store SharePoint site URL and list config
GET  /admin/sharepoint/config   — Retrieve current SharePoint config
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_admin
from app.models import SystemSetting, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/sharepoint", tags=["sharepoint"])

_KEY_SITE_URL = "sharepoint_site_url"
_KEY_LIST_NAME = "sharepoint_list_name"
_KEY_STATUS_COLUMN = "sharepoint_status_column"
_KEY_ENABLED = "sharepoint_enabled"


class SharePointConfig(BaseModel):
    site_url: Optional[str] = None
    list_name: Optional[str] = None
    status_column: Optional[str] = "Status"
    enabled: bool = False


@router.post("/connect", status_code=status.HTTP_200_OK)
def connect_sharepoint(
    config: SharePointConfig,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(require_admin),
) -> dict:
    """Store SharePoint connection config in SystemSettings.
    
    Full live write-back requires Azure AD app credentials with Sites.ReadWrite.All.
    This endpoint stores the config; live sync is activated when Graph credentials
    are confirmed and provided.
    """
    _set_setting(db, _KEY_SITE_URL, config.site_url or "")
    _set_setting(db, _KEY_LIST_NAME, config.list_name or "")
    _set_setting(db, _KEY_STATUS_COLUMN, config.status_column or "Status")
    _set_setting(db, _KEY_ENABLED, "true" if config.enabled else "false")
    db.commit()
    logger.info(
        "SharePoint config updated by user %d: site=%s list=%s",
        current_user.id,
        config.site_url,
        config.list_name,
    )
    return {
        "message": "SharePoint configuration saved",
        "note": "Live write-back will activate once Azure AD app credentials are configured.",
        "site_url": config.site_url,
        "list_name": config.list_name,
        "enabled": config.enabled,
    }


@router.get("/config", response_model=SharePointConfig)
def get_sharepoint_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: None = Depends(require_admin),
) -> SharePointConfig:
    """Retrieve current SharePoint connector configuration."""
    return SharePointConfig(
        site_url=_get_setting(db, _KEY_SITE_URL),
        list_name=_get_setting(db, _KEY_LIST_NAME),
        status_column=_get_setting(db, _KEY_STATUS_COLUMN) or "Status",
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

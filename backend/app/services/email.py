import smtplib
import logging
from email.message import EmailMessage
from html import escape
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Graph API email sending (replaces Basic Auth SMTP on Microsoft 365)
# ---------------------------------------------------------------------------

def _get_graph_send_config() -> Optional[dict]:
    """Return Graph credentials from DB, or None if not fully configured."""
    try:
        from app.database import SessionLocal
        from app.models import SystemSetting
        db = SessionLocal()
        try:
            rows = {r.key: r.value for r in db.query(SystemSetting).all()}
            client_id = rows.get("graph_client_id") or ""
            tenant_id = rows.get("graph_tenant_id") or ""
            client_secret = rows.get("graph_client_secret") or ""
            mailbox = rows.get("graph_mailbox") or ""
            if not client_id or not tenant_id or not client_secret or not mailbox:
                return None
            return {
                "client_id": client_id,
                "tenant_id": tenant_id,
                "client_secret": client_secret,
                "mailbox": mailbox,
            }
        finally:
            db.close()
    except Exception as exc:
        logger.debug("Could not read Graph send config: %s", exc)
        return None


def _send_via_graph(
    to_email: str,
    subject: str,
    body_html: str,
    body_text: str,
    cfg: dict,
) -> None:
    """Send email via Microsoft Graph API (POST /users/{mailbox}/sendMail).

    Requires Mail.Send application permission granted in Azure AD.
    """
    try:
        import msal
    except ImportError:
        raise RuntimeError("msal package not installed. Run: pip install msal")
    import requests

    msal_app = msal.ConfidentialClientApplication(
        cfg["client_id"],
        authority=f"https://login.microsoftonline.com/{cfg['tenant_id']}",
        client_credential=cfg["client_secret"],
    )
    result = msal_app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    if "access_token" not in result:
        error = result.get("error_description") or result.get("error") or "Unknown"
        raise RuntimeError(f"Graph token acquisition failed: {error}")

    payload = {
        "message": {
            "subject": subject,
            "body": {
                "contentType": "HTML",
                "content": body_html if body_html else body_text,
            },
            "toRecipients": [{"emailAddress": {"address": to_email}}],
        },
        "saveToSentItems": "false",
    }
    resp = requests.post(
        f"https://graph.microsoft.com/v1.0/users/{cfg['mailbox']}/sendMail",
        headers={
            "Authorization": f"Bearer {result['access_token']}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()

# ---------------------------------------------------------------------------
# HTML Email Templates
# ---------------------------------------------------------------------------

_HEADER = """<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0"
  style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);">"""

_FOOTER = """
  <tr>
    <td style="background-color:#f4f6f9;padding:20px 40px;text-align:center;border-top:1px solid #e8eaf0;">
      <p style="margin:0 0 6px 0;font-size:12px;color:#aaa;">© 2026 TekTalentScan by Tektalis. All rights reserved.</p>
      <p style="margin:0;font-size:11px;color:#bbb;">This is an automated email. Please do not reply to this message.</p>
    </td>
  </tr>
</table>
</td></tr></table>
</body></html>"""

_BRAND_HEADER = """
  <tr>
    <td style="background-color:#534AB7;padding:28px 40px;text-align:center;">
      <p style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;letter-spacing:1px;">TekTalentScan</p>
      <p style="margin:6px 0 0 0;color:#c7c4f0;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;">__SUBTITLE__</p>
    </td>
  </tr>"""

_CTA_BUTTON = """
  <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px auto;">
    <tr>
      <td align="center" style="border-radius:5px;background-color:#534AB7;">
        <a href="__URL__" style="display:inline-block;padding:13px 32px;font-size:14px;font-weight:bold;
           color:#ffffff;text-decoration:none;border-radius:5px;letter-spacing:0.4px;">__LABEL__</a>
      </td>
    </tr>
  </table>"""

_WARN_BOX = """
  <table width="100%" cellpadding="0" cellspacing="0"
    style="background-color:#fff8e1;border-left:4px solid #f9a825;border-radius:4px;margin-bottom:24px;">
    <tr>
      <td style="padding:14px 18px;font-size:13px;color:#5d4037;line-height:1.6;">
        ⚠️ &nbsp;<strong>Important:</strong> This is a temporary password. Please update it immediately
        after logging in via <em>Account → Change Password</em>. Do not share your credentials with anyone.
      </td>
    </tr>
  </table>"""


def _creds_table(rows: list[tuple[str, str, bool]]) -> str:
    """Render a credentials box. rows = [(label, value, monospace?), ...]"""
    inner = ""
    for i, (label, value, mono) in enumerate(rows):
        if i > 0:
            inner += '<tr><td colspan="2" style="border-top:1px solid #e8eaf0;padding:0;font-size:0;">&nbsp;</td></tr>'
        val_style = (
            "font-family:'Courier New',monospace;font-size:15px;font-weight:bold;"
            "color:#534AB7;background:#EEEDFE;padding:4px 10px;border-radius:4px;letter-spacing:1px;"
        ) if mono else "font-size:14px;color:#1a1a1a;font-weight:bold;"
        inner += f"""
        <tr>
          <td style="padding:8px 0;font-size:14px;color:#555;width:140px;">{label}</td>
          <td style="padding:8px 0;"><span style="{val_style}">{value}</span></td>
        </tr>"""
    return f"""
  <table width="100%" cellpadding="0" cellspacing="0"
    style="background-color:#f8f9fc;border:1px solid #e0e4ed;border-radius:6px;margin:24px 0;">
    <tr><td style="padding:20px 24px;">
      <p style="margin:0 0 14px 0;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.8px;">
        Login Credentials
      </p>
      <table cellpadding="0" cellspacing="0" width="100%">{inner}</table>
    </td></tr>
  </table>"""


# ---------------------------------------------------------------------------
# Welcome email (new user account)
# ---------------------------------------------------------------------------

def _build_welcome_html(name: str, email: str, role: str, password: str) -> str:
    creds = _creds_table([
        ("Email", escape(email), False),
        ("Role", escape(role.capitalize()), False),
        ("Temporary Password", escape(password), True),
    ])
    steps = """
  <table width="100%" cellpadding="0" cellspacing="0"
    style="background-color:#f8f9fc;border:1px solid #e0e4ed;border-radius:6px;margin-bottom:24px;">
    <tr><td style="padding:20px 24px;">
      <p style="margin:0 0 14px 0;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.8px;">
        Getting Started
      </p>
      <table cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;font-size:13px;color:#555;">✅ &nbsp;Log in using your email and temporary password</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#555;">✅ &nbsp;Change your password immediately after first login</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#555;">✅ &nbsp;Review job roles and start evaluating candidates</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#555;">✅ &nbsp;Reach out to your admin for any assistance</td></tr>
      </table>
    </td></tr>
  </table>"""
    cta = _CTA_BUTTON.replace("__URL__", escape(settings.app_url)).replace("__LABEL__", "Login to TekTalentScan →")
    header = _BRAND_HEADER.replace("__SUBTITLE__", "Talent Management Portal")
    return (
        _HEADER
        + header
        + """
  <tr>
    <td style="background-color:#e8f5e9;padding:14px 40px;text-align:center;border-bottom:1px solid #c8e6c9;">
      <p style="margin:0;color:#2e7d32;font-size:13px;">
        🎉 &nbsp;<strong>Account Created Successfully!</strong> Welcome to TekTalentScan.
      </p>
    </td>
  </tr>
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 6px 0;font-size:15px;color:#333;">Hello,</p>
    <p style="margin:0 0 24px 0;font-size:18px;font-weight:bold;color:#1a1a1a;">"""
        + escape(name)
        + """</p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      Your TekTalentScan recruiter account has been created. Below are your login credentials.
    </p>"""
        + creds
        + _WARN_BOX
        + cta
        + steps
        + """
    <p style="font-size:14px;color:#444;margin-top:28px;">
      Regards,<br><strong style="color:#534AB7;">TekTalentScan Team</strong>
    </p>
  </td></tr>"""
        + _FOOTER
    )


# ---------------------------------------------------------------------------
# Password reset email (admin-initiated)
# ---------------------------------------------------------------------------

def _build_password_reset_html(name: str, email: str, password: str) -> str:
    creds = _creds_table([
        ("Email", escape(email), False),
        ("Temporary Password", escape(password), True),
    ])
    cta = _CTA_BUTTON.replace("__URL__", escape(settings.app_url)).replace("__LABEL__", "Login to Your Account →")
    header = _BRAND_HEADER.replace("__SUBTITLE__", "Talent Management Portal")
    return (
        _HEADER
        + header
        + """
  <tr>
    <td style="background-color:#e3f2fd;padding:14px 40px;text-align:center;border-bottom:1px solid #bbdefb;">
      <p style="margin:0;color:#1565c0;font-size:13px;">
        🔐 &nbsp;<strong>Security Alert:</strong> Your password has been reset by an administrator.
      </p>
    </td>
  </tr>
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 6px 0;font-size:15px;color:#333;">Hello,</p>
    <p style="margin:0 0 24px 0;font-size:18px;font-weight:bold;color:#1a1a1a;">"""
        + escape(name)
        + """</p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      Your account password has been reset. Below are your updated temporary login credentials.
      Please log in and <strong>change your password immediately</strong>.
    </p>"""
        + creds
        + _WARN_BOX
        + cta
        + """
    <p style="font-size:13px;color:#888;line-height:1.6;">
      If you did not expect this reset or believe it was done in error,
      please contact your HR or IT administrator immediately.
    </p>
    <p style="font-size:14px;color:#444;margin-top:28px;">
      Regards,<br><strong style="color:#534AB7;">TekTalentScan Team</strong>
    </p>
  </td></tr>"""
        + _FOOTER
    )


# ---------------------------------------------------------------------------
# Shortlist / next-steps email (candidate)
# ---------------------------------------------------------------------------

def _build_shortlist_html(candidate_name: str, job_title: str) -> str:
    header = _BRAND_HEADER.replace("__SUBTITLE__", "Recruitment Team")

    def stage(num: str, icon: str, title: str, desc: str, active: bool) -> str:
        bg = "#534AB7" if active else "#f4f6f9"
        border = "#534AB7" if active else "#e0e4ed"
        return f"""
        <tr>
          <td style="padding:12px 0;">
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background-color:{bg};border:1px solid {border};border-radius:8px;padding:0;">
              <tr>
                <td style="padding:16px 20px;">
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="vertical-align:top;padding-right:16px;">
                        <div style="width:36px;height:36px;border-radius:50%;background-color:{'#EEEDFE' if not active else 'rgba(255,255,255,0.2)'};
                          display:inline-flex;align-items:center;justify-content:center;
                          font-size:18px;text-align:center;line-height:36px;">{icon}</div>
                      </td>
                      <td style="vertical-align:top;">
                        <p style="margin:0 0 4px 0;font-size:13px;color:{'#AFA9EC' if active else '#aaa'};">
                          Stage {num}
                        </p>
                        <p style="margin:0 0 4px 0;font-size:15px;font-weight:bold;color:{'#ffffff' if active else '#1a1a1a'};">
                          {title}
                        </p>
                        <p style="margin:0;font-size:13px;color:{'rgba(255,255,255,0.75)' if active else '#666'};line-height:1.5;">
                          {desc}
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>"""

    stages = (
        stage("1", "💻", "Coding Assessment",
              "An online coding challenge to evaluate your problem-solving and technical skills. "
              "Duration: ~60–90 minutes. Link will be shared separately.", True)
        + stage("2", "🖥️", "Technical Interview",
                "A live interview with our engineering team covering data structures, system design, "
                "and role-specific technical topics.", False)
        + stage("3", "🤝", "HR Interview",
                "A final conversation with our HR team to discuss your background, expectations, "
                "cultural fit, and compensation.", False)
    )

    cta = _CTA_BUTTON.replace("__URL__", escape(settings.app_url)).replace("__LABEL__", "View Application Status →")

    return (
        _HEADER
        + header
        + """
  <tr>
    <td style="background-color:#e8f5e9;padding:14px 40px;text-align:center;border-bottom:1px solid #c8e6c9;">
      <p style="margin:0;color:#2e7d32;font-size:13px;">
        🎯 &nbsp;<strong>Congratulations!</strong> You've been shortlisted for the next round.
      </p>
    </td>
  </tr>
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 6px 0;font-size:15px;color:#333;">Hello,</p>
    <p style="margin:0 0 24px 0;font-size:18px;font-weight:bold;color:#1a1a1a;">"""
        + escape(candidate_name)
        + """</p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      We are pleased to inform you that your application for the
      <strong>"""
        + escape(job_title)
        + """</strong> position has been shortlisted.
      Your profile stood out among many strong candidates, and we'd love to move forward with you.
    </p>
    <p style="font-size:14px;color:#555;line-height:1.7;margin-bottom:6px;">
      Here's a overview of our hiring process:
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">"""
        + stages
        + """
    </table>

    <table width="100%" cellpadding="0" cellspacing="0"
      style="background-color:#f8f9fc;border:1px solid #e0e4ed;border-radius:6px;margin:24px 0;">
      <tr><td style="padding:16px 20px;font-size:13px;color:#555;line-height:1.7;">
        📅 &nbsp;Our recruitment team will reach out to you <strong>within 2–3 business days</strong>
        with further details on the next step. Please keep an eye on your inbox and ensure your
        contact information is up to date.
      </td></tr>
    </table>"""
        + cta
        + """
    <p style="font-size:13px;color:#888;line-height:1.6;">
      If you have any questions, please reply to this email or contact your recruiter directly.
    </p>
    <p style="font-size:14px;color:#444;margin-top:28px;">
      Best regards,<br><strong style="color:#534AB7;">TekTalentScan Recruitment Team</strong>
    </p>
  </td></tr>"""
        + _FOOTER
    )


# ---------------------------------------------------------------------------
# Core SMTP sender
# ---------------------------------------------------------------------------

def _send_email(
    to_email: str,
    subject: str,
    body: str,
    html_body: str | None = None,
    tracking_pixel_url: str | None = None,
) -> bool:
    """Send email. Returns True if sent, False if no transport configured. Raises RuntimeError on failure.

    Tries Microsoft Graph API first (works with M365 which has Basic Auth disabled),
    then falls back to SMTP.
    """
    # Inject 1×1 tracking pixel into HTML body if a URL was provided
    if html_body and tracking_pixel_url:
        pixel = f'<img src="{tracking_pixel_url}" width="1" height="1" alt="" style="display:none;" />'
        html_body = html_body.replace("</body>", f"{pixel}</body>")

    # Try Microsoft Graph API first — required for M365 tenants that have disabled Basic Auth
    graph_cfg = _get_graph_send_config()
    if graph_cfg:
        try:
            _send_via_graph(to_email, subject, html_body or body, body, graph_cfg)
            logger.info("Email sent via Graph API to %s: %s", to_email, subject)
            return True
        except Exception as exc:
            logger.warning("Graph API send failed (%s), falling back to SMTP", exc)

    # Fall back to SMTP
    if not settings.smtp_server:
        logger.warning("No email transport configured. Would have sent '%s' to %s", subject, to_email)
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from_email or "no-reply@tektalis.com"
    msg["To"] = to_email
    msg.set_content(body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    try:
        if settings.smtp_port == 465:
            with smtplib.SMTP_SSL(settings.smtp_server, settings.smtp_port) as server:
                if settings.smtp_username and settings.smtp_password:
                    server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(settings.smtp_server, settings.smtp_port) as server:
                server.ehlo()
                if settings.smtp_port == 587:
                    server.starttls()
                if settings.smtp_username and settings.smtp_password:
                    server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(msg)
        logger.info("Email sent via SMTP to %s: %s", to_email, subject)
        return True
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to_email, e)
        raise RuntimeError(f"SMTP send failed for {to_email!r}: {e}") from e


# ---------------------------------------------------------------------------
# Public email functions
# ---------------------------------------------------------------------------

def send_welcome_email(to_email: str, name: str, role: str, password: str) -> None:
    """Send HTML welcome email with login credentials to a newly created user."""
    subject = "Welcome to TekTalentScan — Your Account Details"
    plain = (
        f"Hello {name},\n\n"
        f"Your TekTalentScan account has been created.\n\n"
        f"Email: {to_email}\nRole: {role}\nTemporary Password: {password}\n\n"
        "Please log in and change your password immediately.\n\n"
        f"Login: {settings.app_url}\n\nTekTalentScan Team"
    )
    _send_email(to_email, subject, plain, _build_welcome_html(name, to_email, role, password))


def send_password_reset_email(to_email: str, name: str, password: str) -> None:
    """Send HTML password-reset email with temporary credentials."""
    subject = "TekTalentScan — Your Password Has Been Reset"
    plain = (
        f"Hello {name},\n\n"
        f"Your password has been reset by an administrator.\n\n"
        f"Email: {to_email}\nTemporary Password: {password}\n\n"
        "Please log in and change your password immediately.\n\n"
        f"Login: {settings.app_url}\n\nTekTalentScan Team"
    )
    _send_email(to_email, subject, plain, _build_password_reset_html(name, to_email, password))


def send_automated_email(candidate_email: str, candidate_name: str, job_role_title: str) -> None:
    """Send shortlist / next-steps HTML email to a high-scoring candidate."""
    subject = f"Your Application for {job_role_title} — Next Steps"
    plain = (
        f"Hi {candidate_name},\n\n"
        f"Congratulations! Your application for {job_role_title} has been shortlisted.\n\n"
        "Our hiring process consists of three stages:\n"
        "  1. Coding Assessment\n"
        "  2. Technical Interview\n"
        "  3. HR Interview\n\n"
        "Our recruitment team will be in touch within 2–3 business days with further details.\n\n"
        "Best regards,\nTekTalentScan Recruitment Team"
    )
    _send_email(candidate_email, subject, plain, _build_shortlist_html(candidate_name, job_role_title))


def send_manual_email(candidate_email: str, _candidate_name: str, subject: str, body: str) -> None:
    """Send a custom plain-text email written by the recruiter."""
    _send_email(candidate_email, subject, body)


def _build_rejection_html(
    candidate_name: str,
    job_title: str,
    skill_gaps: list,
    note: str | None,
) -> str:
    header = _BRAND_HEADER.replace("__SUBTITLE__", "Application Update")
    gap_rows = ""
    if skill_gaps:
        items = "".join(
            f'<tr><td style="padding:5px 0;font-size:13px;color:#555;">• &nbsp;{escape(g)}</td></tr>'
            for g in skill_gaps
        )
        gap_rows = f"""
  <table width="100%" cellpadding="0" cellspacing="0"
    style="background-color:#f8f9fc;border:1px solid #e0e4ed;border-radius:6px;margin:20px 0;">
    <tr><td style="padding:16px 20px;">
      <p style="margin:0 0 10px 0;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.8px;">
        Areas to Strengthen
      </p>
      <table cellpadding="0" cellspacing="0">{items}</table>
    </td></tr>
  </table>"""
    note_block = (
        f'<p style="font-size:13px;color:#555;line-height:1.7;margin-top:16px;">{escape(note)}</p>'
        if note else ""
    )
    return (
        _HEADER
        + header
        + """
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 6px 0;font-size:15px;color:#333;">Hello,</p>
    <p style="margin:0 0 24px 0;font-size:18px;font-weight:bold;color:#1a1a1a;">"""
        + escape(candidate_name)
        + """</p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      Thank you for your interest in the <strong>"""
        + escape(job_title)
        + """</strong> position and for the time you invested in our process.
    </p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      After careful consideration, we have decided to move forward with other candidates
      whose profiles more closely match our current requirements.
    </p>"""
        + gap_rows
        + note_block
        + """
    <p style="font-size:14px;color:#555;line-height:1.7;margin-top:16px;">
      We truly appreciate your time and encourage you to apply for future opportunities that match your skills.
    </p>
    <p style="font-size:14px;color:#444;margin-top:28px;">
      Best regards,<br><strong style="color:#534AB7;">TekTalentScan Recruitment Team</strong>
    </p>
  </td></tr>"""
        + _FOOTER
    )


class CandidateEmailService:
    """Stateless service for all candidate-facing emails.

    All methods are class methods so callers don't need to instantiate.
    Each method returns True if the email was dispatched (SMTP configured),
    False if SMTP is not configured (dry-run / dev mode).
    """

    @classmethod
    def _resolve_template(cls, db, key: str, candidate_name: str, job_role_title: str) -> tuple[str, str] | None:
        """Return (subject, body_text) from DB override with placeholders filled, or None if no override."""
        if db is None:
            return None
        try:
            from app.models import EmailTemplate
            tpl = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
            if tpl:
                def _fill(s: str) -> str:
                    return s.replace("{candidate_name}", candidate_name).replace("{job_title}", job_role_title)
                return _fill(tpl.subject), _fill(tpl.body_text)
        except Exception:
            pass
        return None

    @classmethod
    def send_next_steps(
        cls,
        candidate_email: str,
        candidate_name: str,
        job_role_title: str,
        db=None,
        tracking_pixel_url: str | None = None,
    ) -> bool:
        """Send the shortlist / hiring-process next-steps email to a candidate."""
        subject = f"Your Application for {job_role_title} — Next Steps"
        plain = (
            f"Hi {candidate_name},\n\n"
            f"Congratulations! Your application for {job_role_title} has been shortlisted.\n\n"
            "Our hiring process consists of three stages:\n"
            "  1. Coding Assessment (~60–90 min online challenge)\n"
            "  2. Technical Interview (live session with the engineering team)\n"
            "  3. HR Interview (background, expectations, compensation)\n\n"
            "Our team will be in touch within 2–3 business days with further details.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        )
        override = cls._resolve_template(db, "next_steps", candidate_name, job_role_title)
        if override:
            subject, plain = override
        return _send_email(
            candidate_email, subject, plain,
            _build_shortlist_html(candidate_name, job_role_title),
            tracking_pixel_url=tracking_pixel_url,
        )

    @classmethod
    def send_coding_invite(cls, candidate_email: str, candidate_name: str, job_role_title: str, assessment_link: str) -> bool:
        """Send Stage 1: Coding Assessment invitation with a direct link."""
        subject = f"Coding Assessment Invite — {job_role_title}"
        plain = (
            f"Hi {candidate_name},\n\n"
            f"You have been invited to complete a coding assessment for the {job_role_title} role.\n\n"
            f"Assessment link: {assessment_link}\n\n"
            "Please complete it within 72 hours of receiving this email.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        )
        html = (
            _HEADER
            + _BRAND_HEADER.replace("__SUBTITLE__", "Stage 1 — Coding Assessment")
            + f"""
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 6px 0;font-size:15px;color:#333;">Hello,</p>
    <p style="margin:0 0 24px 0;font-size:18px;font-weight:bold;color:#1a1a1a;">{escape(candidate_name)}</p>
    <p style="font-size:14px;color:#555;line-height:1.7;">
      You have been selected to complete a coding assessment for the
      <strong>{escape(job_role_title)}</strong> position. The challenge takes approximately
      60–90 minutes and evaluates your problem-solving and technical skills.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
      style="background-color:#f8f9fc;border:1px solid #e0e4ed;border-radius:6px;margin:24px 0;">
      <tr><td style="padding:16px 20px;font-size:13px;color:#555;line-height:1.7;">
        ⏱ &nbsp;<strong>Please complete the assessment within 72 hours.</strong>
      </td></tr>
    </table>
    {_CTA_BUTTON.replace("__URL__", escape(assessment_link)).replace("__LABEL__", "Start Coding Assessment →")}
    <p style="font-size:14px;color:#444;margin-top:28px;">
      Best regards,<br><strong style="color:#534AB7;">TekTalentScan Recruitment Team</strong>
    </p>
  </td></tr>"""
            + _FOOTER
        )
        return _send_email(candidate_email, subject, plain, html)

    @classmethod
    def send_interview_invite(cls, candidate_email: str, candidate_name: str, job_role_title: str, interview_details: str) -> bool:
        """Send Stage 2: Technical Interview invitation."""
        subject = f"Technical Interview Invitation — {job_role_title}"
        plain = (
            f"Hi {candidate_name},\n\n"
            f"We are pleased to invite you to a technical interview for the {job_role_title} role.\n\n"
            f"{interview_details}\n\n"
            "Please confirm your availability by replying to this email.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        )
        return _send_email(candidate_email, subject, plain)

    @classmethod
    def send_rejection(
        cls,
        candidate_email: str,
        candidate_name: str,
        job_role_title: str,
        skill_gaps: list | None = None,
        note: str | None = None,
        db=None,
    ) -> bool:
        """Send a constructive rejection email with optional skill gap feedback."""
        subject = f"Your Application for {job_role_title} — Update"
        gap_section = ""
        if skill_gaps:
            gap_list = "\n".join(f"  • {g}" for g in skill_gaps)
            gap_section = (
                "\n\nTo help you grow, here are areas where strengthening your skills "
                f"could improve future applications for similar roles:\n{gap_list}\n"
            )
        note_section = f"\n{note}\n" if note else ""
        plain = (
            f"Hi {candidate_name},\n\n"
            f"Thank you for your interest in the {job_role_title} position and for taking the time "
            "to go through our process.\n\n"
            "After careful consideration, we have decided to move forward with other candidates "
            "whose profiles more closely match our current requirements."
            + gap_section
            + note_section
            + "\n\nWe appreciate your time and encourage you to apply for future opportunities.\n\n"
            "Best regards,\nTekTalentScan Recruitment Team"
        )
        html = _build_rejection_html(candidate_name, job_role_title, skill_gaps or [], note)
        override = cls._resolve_template(db, "rejection", candidate_name, job_role_title)
        if override:
            subject, plain = override
        return _send_email(candidate_email, subject, plain, html)


def send_manual_review_alert(recruiter_email: str, candidate_name: str, flags: list) -> None:
    """Notify the recruiter that a candidate profile needs manual review."""
    high = [f for f in flags if f.get("severity") == "high"]
    medium = [f for f in flags if f.get("severity") == "medium"]
    flag_lines = "\n".join(
        f"  [{f.get('severity', '?').upper()}] {f.get('recruiter_note', '')}"
        for f in flags
    )
    subject = f"Manual Review Required: {candidate_name}"
    body = (
        f"A candidate profile requires your attention.\n\n"
        f"Candidate: {candidate_name}\n"
        f"Flags found: {len(flags)} ({len(high)} high, {len(medium)} medium)\n\n"
        f"Flags:\n{flag_lines}\n\n"
        "Please review the candidate's profile in the TekTalentScan dashboard."
    )
    _send_email(recruiter_email, subject, body)

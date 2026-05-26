# auth/otp.py
import os
import random
import time
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
load_dotenv()

router = APIRouter()

# ── In-memory OTP store ───────────────────────────────────
# { email: { otp, expires_at, zoho_account_id, company_name } }
_otp_store: dict = {}
OTP_EXPIRY_SECONDS = 600  # 10 minutes

# ── SMTP config (Outlook) ────────────────────────────────
SMTP_HOST     = "smtp.office365.com"
SMTP_PORT     = 587
SMTP_USER     = os.getenv("SMTP_USER", "")      # your Outlook email
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")  # your Outlook password


def _send_otp_email(to_email: str, otp: str, company_name: str) -> bool:
    """Sends OTP email via Outlook SMTP. Returns True if sent."""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "Your TrustBridge Access Code"
        msg["From"]    = SMTP_USER
        msg["To"]      = to_email

        html = f"""
        <div style="font-family:'DM Sans',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#FDFCFA;border:1px solid #D8DDE2;border-radius:8px;">
          <div style="margin-bottom:24px;">
            <span style="font-family:sans-serif;font-size:18px;font-weight:800;letter-spacing:0.05em;color:#141C24;">TrustBridge</span>
            <span style="display:inline-block;width:7px;height:7px;background:#B87333;border-radius:50%;margin-left:6px;vertical-align:middle;"></span>
          </div>
          <p style="font-size:14px;color:#3A4A58;margin-bottom:8px;">Hi {company_name},</p>
          <p style="font-size:14px;color:#3A4A58;margin-bottom:24px;">
            Your one-time access code for the RFP Assessment tool is:
          </p>
          <div style="text-align:center;padding:20px;background:#F5F4F1;border-radius:6px;margin-bottom:24px;">
            <span style="font-family:'IBM Plex Mono',monospace;font-size:36px;font-weight:500;letter-spacing:0.15em;color:#141C24;">{otp}</span>
          </div>
          <p style="font-size:12px;color:#7A8A96;">
            This code expires in 5 minutes. If you didn't request this, ignore this email.
          </p>
        </div>
        """

        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_USER, to_email, msg.as_string())

        print(f"  ✓ OTP email sent to {to_email}")
        return True

    except Exception as e:
        print(f"  ✗ OTP email failed: {e}")
        return False


# ── POST /auth/send-otp ───────────────────────────────────
@router.post("/send-otp")
async def send_otp(payload: dict):
    """
    Called after /auth/lookup succeeds.
    Generates OTP, stores it, sends email.
    """
    email           = (payload.get("email") or "").strip().lower()
    zoho_account_id = payload.get("zoho_account_id", "")
    company_name    = payload.get("company_name", "Supplier")

    if not email:
        return JSONResponse({"ok": False, "error": "Email required"}, status_code=400)

    # Generate 6-digit OTP
    otp = str(random.randint(100000, 999999))

    # Store with expiry
    _otp_store[email] = {
        "otp":             otp,
        "expires_at":      time.time() + OTP_EXPIRY_SECONDS,
        "zoho_account_id": zoho_account_id,
        "company_name":    company_name,
        "attempts":        0,
    }

    # Dev mode — print OTP to terminal if no SMTP configured
    if not SMTP_USER or not SMTP_PASSWORD:
        print(f"\n  🔑 DEV MODE OTP for {email}: {otp}\n")
        return JSONResponse({
            "ok":       True,
            "dev_mode": True,
            "message":  "Dev mode — OTP printed to terminal",
        })

    # Send email
    sent = _send_otp_email(email, otp, company_name)
    if not sent:
        return JSONResponse(
            {"ok": False, "error": "Failed to send OTP email. Try again."},
            status_code=500
        )

    # Mask email for response
    parts  = email.split("@")
    masked = parts[0][:2] + "***@" + parts[1]

    return JSONResponse({
        "ok":           True,
        "masked_email": masked,
        "expires_in":   OTP_EXPIRY_SECONDS,
    })


# ── POST /auth/verify-otp ─────────────────────────────────
@router.post("/verify-otp")
async def verify_otp(payload: dict):
    """
    Verifies OTP. Returns session data if correct.
    """
    email    = (payload.get("email") or "").strip().lower()
    otp_input = str(payload.get("otp") or "").strip()

    if not email or not otp_input:
        return JSONResponse(
            {"ok": False, "error": "Email and OTP required"},
            status_code=400
        )

    record = _otp_store.get(email)

    if not record:
        return JSONResponse(
            {"ok": False, "error": "No OTP found. Please request a new one."},
            status_code=400
        )

    # Check expiry
    if time.time() > record["expires_at"]:
        del _otp_store[email]
        return JSONResponse(
            {"ok": False, "error": "OTP expired. Please request a new one."},
            status_code=400
        )

    # Rate limit — max 5 attempts
    record["attempts"] += 1
    if record["attempts"] > 5:
        del _otp_store[email]
        return JSONResponse(
            {"ok": False, "error": "Too many attempts. Please request a new code."},
            status_code=429
        )

    # Check OTP
    if otp_input != record["otp"]:
        remaining = 5 - record["attempts"]
        return JSONResponse(
            {"ok": False, "error": f"Incorrect code. {remaining} attempt(s) remaining."},
            status_code=400
        )

    # Success — clear OTP and return session
    session_data = {
        "zoho_account_id": record["zoho_account_id"],
        "company_name":    record["company_name"],
    }
    del _otp_store[email]

    print(f"  ✓ OTP verified for {email} → {session_data['company_name']}")

    return JSONResponse({
        "ok":              True,
        "zoho_account_id": session_data["zoho_account_id"],
        "company_name":    session_data["company_name"],
        "email":           email,
    })

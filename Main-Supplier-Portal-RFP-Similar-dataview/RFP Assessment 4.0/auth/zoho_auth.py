# auth/router.py
import os
import time
import requests
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
load_dotenv()

router = APIRouter()

ZOHO_CLIENT_ID     = os.getenv("ZOHO_CLIENT_ID", "")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET", "")
ZOHO_REFRESH_TOKEN = os.getenv("ZOHO_REFRESH_TOKEN", "")
ZOHO_API_BASE      = os.getenv("ZOHO_API_BASE", "https://www.zohoapis.com/crm/v2")
ZOHO_ACCOUNTS_URL  = os.getenv("ZOHO_ACCOUNTS_URL", "https://accounts.zoho.com/oauth/v2/token")

_token_cache = {"token": "", "expires_at": 0}

def get_zoho_token() -> str:
    now = time.time()
    if _token_cache["token"] and _token_cache["expires_at"] > now + 60:
        return _token_cache["token"]
    resp = requests.post(ZOHO_ACCOUNTS_URL, data={
        "refresh_token": ZOHO_REFRESH_TOKEN,
        "client_id":     ZOHO_CLIENT_ID,
        "client_secret": ZOHO_CLIENT_SECRET,
        "grant_type":    "refresh_token",
    }, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    if "access_token" not in data:
        raise ValueError(f"Zoho token refresh failed: {data}")
    _token_cache["token"]      = data["access_token"]
    _token_cache["expires_at"] = now + data.get("expires_in", 3600)
    return _token_cache["token"]

def zoho_headers():
    return {"Authorization": f"Zoho-oauthtoken {get_zoho_token()}",
            "Content-Type": "application/json"}

@router.post("/lookup")
async def auth_lookup(payload: dict):
    email = (payload.get("email") or "").strip().lower()
    if not email:
        return JSONResponse({"ok": False, "error": "Email is required"}, status_code=400)

    if not ZOHO_REFRESH_TOKEN:
        # Dev mode fallback
        return JSONResponse({
            "ok": True,
            "company_name":    "Dev Mode Company",
            "zoho_account_id": "DEV-" + email.split("@")[0].upper(),
            "contact_name":    email,
            "_dev_mode":       True,
        })

    try:
        url    = f"{ZOHO_API_BASE}/Contacts/search"
        resp   = requests.get(url, headers=zoho_headers(),
                              params={"email": email}, timeout=10)
        if resp.status_code == 204:
            return JSONResponse({"ok": False, "error": f"No contact found for: {email}"}, status_code=404)
        resp.raise_for_status()
        contacts = resp.json().get("data", [])
        if not contacts:
            return JSONResponse({"ok": False, "error": f"No contact found for: {email}"}, status_code=404)

        contact = contacts[0]
        account = contact.get("Account_Name", {})
        zoho_account_id = str(account.get("id", "")) if isinstance(account, dict) else ""
        company_name    = account.get("name", "") if isinstance(account, dict) else str(account)
        if not zoho_account_id:
            zoho_account_id = str(contact.get("id", ""))
            company_name    = contact.get("Company", "") or contact.get("Full_Name", "")
        full_name = contact.get("Full_Name", "") or \
                    f"{contact.get('First_Name','')} {contact.get('Last_Name','')}".strip()

        print(f"  ✓ Auth lookup: {email} → {company_name} ({zoho_account_id})")
        return JSONResponse({"ok": True, "company_name": company_name,
                             "zoho_account_id": zoho_account_id, "contact_name": full_name})

    except Exception as e:
        print(f"  ✗ Auth lookup error: {e}")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
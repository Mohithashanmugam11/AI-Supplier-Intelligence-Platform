import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

ZOHO_CLIENT_ID = os.getenv("ZOHO_CLIENT_ID", "")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET", "")
ZOHO_REFRESH_TOKEN = os.getenv("ZOHO_REFRESH_TOKEN", "")
ZOHO_API_BASE = os.getenv("ZOHO_API_BASE", "https://www.zohoapis.com/crm/v2")
ZOHO_ACCOUNTS_URL = os.getenv("ZOHO_ACCOUNTS_URL", "https://accounts.zoho.com/oauth/v2/token")
ZOHO_SUPPLIER_PAST_PROJECTS_MODULE = os.getenv("ZOHO_SUPPLIER_PAST_PROJECTS_MODULE", "Supplier_Past_Projects")

_token_cache = {"token": "", "expires_at": 0}


def get_zoho_token() -> str:
    now = time.time()
    if _token_cache["token"] and _token_cache["expires_at"] > now + 60:
        return _token_cache["token"]

    resp = requests.post(
        ZOHO_ACCOUNTS_URL,
        data={
            "refresh_token": ZOHO_REFRESH_TOKEN,
            "client_id": ZOHO_CLIENT_ID,
            "client_secret": ZOHO_CLIENT_SECRET,
            "grant_type": "refresh_token",
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if "access_token" not in data:
        raise ValueError(f"Zoho token refresh failed: {data}")

    _token_cache["token"] = data["access_token"]
    _token_cache["expires_at"] = now + data.get("expires_in", 3600)
    return _token_cache["token"]


def zoho_headers():
    return {
        "Authorization": f"Zoho-oauthtoken {get_zoho_token()}",
        "Content-Type": "application/json",
    }


def fetch_supplier_past_projects(zoho_account_id: str) -> list[dict]:
    """
    Fetch supplier past projects for this supplier lookup id.

    Current model: standalone Supplier_Past_Projects records.
    Legacy fallback: subform rows under Past_Projects on parent records.
    """
    if not zoho_account_id:
        return []

    search_url = f"{ZOHO_API_BASE}/{ZOHO_SUPPLIER_PAST_PROJECTS_MODULE}/search"

    try:
        all_records: list[dict] = []
        for page in range(1, 11):
            resp = requests.get(
                search_url,
                headers=zoho_headers(),
                params={
                    "criteria": f"(Supplier_Name:equals:{zoho_account_id})",
                    "per_page": 200,
                    "page": page,
                },
                timeout=10,
            )

            if resp.status_code == 204:
                break

            resp.raise_for_status()
            page_records = resp.json().get("data", []) or []
            if not page_records:
                break

            all_records.extend(page_records)
            if len(page_records) < 200:
                break

        if not all_records:
            print(f"  [zoho_projects] No past projects found for {zoho_account_id}")
            return []

        # New model: standalone records with these direct fields.
        has_standalone_shape = any(
            any(k in rec for k in ("Pinecone_Vector_ID", "Part_Family", "Process_Primary"))
            for rec in all_records
        )
        if has_standalone_shape:
            print(
                f"  [zoho_projects] Fetched {len(all_records)} standalone past project record(s) for {zoho_account_id}"
            )
            return all_records

        # Legacy fallback: rows inside subform on fetched records.
        rows: list[dict] = []
        for rec in all_records:
            sub_rows = rec.get("Past_Projects") or []
            if isinstance(sub_rows, list):
                rows.extend(sub_rows)

        if rows:
            print(
                f"  [zoho_projects] Fetched {len(rows)} legacy subform past project row(s) for {zoho_account_id}"
            )
            return rows

        print(
            f"  [zoho_projects] Fetched {len(all_records)} record(s) (fallback shape) for {zoho_account_id}"
        )
        return all_records

    except Exception as e:
        print(f"  [zoho_projects] Fetch failed for {zoho_account_id}: {e}")
        return []

# zoho_crm.py
# ─────────────────────────────────────────────────────────────────────────────
# Zoho CRM integration for Supplier Past Projects module.
#
# Responsibilities:
#   1. Exchange refresh token for an access token (cached for 50 min)
#   2. Find an existing Supplier_Past_Projects record by supplier name
#   3. If found  → PATCH the record to append a new Past_Projects subform row
#   4. If not found → POST a new record with the supplier name + subform row
#
# Usage (from server_push_patch.py):
#   from zoho_crm import push_project_to_zoho
#   zoho_ok, zoho_id = push_project_to_zoho(
#       company_name    = part.company_name,
#       project_name    = part.project_name,
#       project_date    = part.project_date,
#       part_family     = part.part_family,
#       material        = part.material,
#       process_primary = part.process,
#       process_secondary = part.process_secondary,
#       complexity_class  = part.complexity_class,
#       tolerance_class   = part.tolerance_class,
#       outcome           = part.outcome,
#       ncr_description   = part.ncr_description,
#       what_worked       = part.what_worked,
#       what_didnt        = part.what_didnt,
#       customer_industry = part.customer_industry,
#       pinecone_vector_id= part.part_id,
#       image_path        = image_path,
#   )
# ─────────────────────────────────────────────────────────────────────────────

import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

# ── Config from .env ──────────────────────────────────────────────────────────
ZOHO_CLIENT_ID     = os.getenv("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET")
ZOHO_REFRESH_TOKEN = os.getenv("ZOHO_REFRESH_TOKEN")

# Change to https://www.zohoapis.eu/  if your org is EU-based
ZOHO_BASE_URL   = "https://www.zohoapis.com"
ZOHO_TOKEN_URL  = "https://accounts.zoho.com/oauth/v2/token"
MODULE_API_NAME = "Supplier_Past_Projects"   # from Image 8

# ── Token cache ───────────────────────────────────────────────────────────────
_token_cache = {"token": None, "expires_at": 0}


def _get_access_token() -> str:
    """Return a valid Zoho OAuth access token, refreshing if needed."""
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"]:
        return _token_cache["token"]

    resp = requests.post(
        ZOHO_TOKEN_URL,
        data={
            "refresh_token": ZOHO_REFRESH_TOKEN,
            "client_id":     ZOHO_CLIENT_ID,
            "client_secret": ZOHO_CLIENT_SECRET,
            "grant_type":    "refresh_token",
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()

    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"Zoho token refresh failed: {data}")

    _token_cache["token"]      = token
    _token_cache["expires_at"] = now + 3000   # tokens live 3600s; refresh at 3000
    return token


def _headers() -> dict:
    return {
        "Authorization": f"Zoho-oauthtoken {_get_access_token()}",
        "Content-Type":  "application/json",
    }


# ── Search for existing supplier record ───────────────────────────────────────
def _find_supplier_record(company_name: str) -> dict | None:
    """
    Search Supplier_Past_Projects for a record whose Supplier_Name lookup
    matches company_name.  Returns the full record dict or None.

    Zoho COQL lets us search by lookup name with:
      Supplier_Name.name = '<value>'
    We fall back to a linear scan if COQL is unavailable.
    """
    if not company_name:
        return None

    url = f"{ZOHO_BASE_URL}/crm/v2/coql"
    query = (
        f"SELECT id, Name, Supplier_Name, Past_Projects "
        f"FROM {MODULE_API_NAME} "
        f"WHERE Supplier_Name.name = '{company_name}' "
        f"LIMIT 1"
    )

    try:
        resp = requests.post(url, headers=_headers(), json={"select_query": query}, timeout=10)
        if resp.status_code == 200:
            rows = resp.json().get("data", [])
            if rows:
                # COQL doesn't return subform rows — fetch full record
                record_id = rows[0]["id"]
                return _get_full_record(record_id)
    except Exception as e:
        print(f"[zoho_crm] COQL search failed ({e}), falling back to list scan")

    # ── Fallback: scan all records (fine for small datasets) ─────────────────
    try:
        resp = requests.get(
            f"{ZOHO_BASE_URL}/crm/v2/{MODULE_API_NAME}",
            headers=_headers(),
            params={"fields": "id,Name,Supplier_Name", "per_page": 200},
            timeout=10,
        )
        if resp.status_code == 200:
            for rec in resp.json().get("data", []):
                supplier_field = rec.get("Supplier_Name") or {}
                name_in_crm    = (
                    supplier_field.get("name", "") if isinstance(supplier_field, dict)
                    else str(supplier_field)
                )
                if name_in_crm.strip().lower() == company_name.strip().lower():
                    return _get_full_record(rec["id"])
    except Exception as e:
        print(f"[zoho_crm] Fallback scan failed: {e}")

    return None


def _get_full_record(record_id: str) -> dict | None:
    """Fetch the complete record including the Past_Projects subform."""
    resp = requests.get(
        f"{ZOHO_BASE_URL}/crm/v2/{MODULE_API_NAME}/{record_id}",
        headers=_headers(),
        timeout=10,
    )
    if resp.status_code == 200:
        rows = resp.json().get("data", [])
        return rows[0] if rows else None
    return None


# ── Build a single Past_Projects subform row ──────────────────────────────────
def _build_subform_row(
    project_name:     str,
    project_date:     str,
    part_family:      str,
    material:         str,
    process_primary:  str,
    process_secondary:str,
    complexity_class: str,
    tolerance_class:  str,
    outcome:          str,
    ncr_description:  str,
    what_worked:      str,
    what_didnt:       str,
    customer_industry:str,
    pinecone_vector_id:str,
    image_path:       str,
) -> dict:
    """
    Maps our internal fields → Zoho Past_Projects subform API names
    (from Images 9 & 10).
    """
    row = {}

    # Single-line / pick-list fields (only include non-empty values)
    if project_name:      row["Project_Name"]      = project_name
    if project_date:      row["Project_Date"]       = project_date
    if material:          row["Material"]            = material
    if process_primary:   row["Process_Primary"]    = process_primary
    if process_secondary: row["Process_Secondary"]  = process_secondary
    if pinecone_vector_id:row["Pinecone_Vector_ID"] = pinecone_vector_id
    if image_path:        row["Image_URLs"]          = image_path

    # Pick-list fields — Zoho rejects unknown values so only send if populated
    if part_family:       row["Part_Family"]        = part_family
    if complexity_class:  row["Complexity_Class"]   = complexity_class
    if tolerance_class:   row["Tolerance_Class"]    = tolerance_class
    if outcome:           row["Outcome"]             = outcome
    if customer_industry: row["Customer_Industry"]  = customer_industry

    # Multi-line text fields
    if ncr_description:   row["NCR_Description"]    = ncr_description
    if what_worked:       row["What_Worked"]         = what_worked
    if what_didnt:        row["What_didn_t_work"]    = what_didnt   # Zoho API name uses straight apostrophe

    return row


# ── Create a brand-new Supplier_Past_Projects record ─────────────────────────
def _create_supplier_record(company_name: str, subform_row: dict) -> str:
    """
    POST a new record.  Supplier_Name is a Lookup — we set it by name.
    Returns the new record id or raises on failure.
    """
    payload = {
        "data": [
            {
                "Name":          company_name,        # Supplier_Past_Projects Name field
                "Supplier_Name": {"name": company_name},   # Lookup by name
                "Past_Projects": [subform_row],
            }
        ]
    }

    resp = requests.post(
        f"{ZOHO_BASE_URL}/crm/v2/{MODULE_API_NAME}",
        headers=_headers(),
        json=payload,
        timeout=15,
    )

    body = resp.json()
    if resp.status_code in (200, 201):
        details = body.get("data", [{}])[0]
        if details.get("status") == "success":
            new_id = details.get("details", {}).get("id", "")
            print(f"[zoho_crm] Created new record for '{company_name}' → id={new_id}")
            return new_id
        else:
            raise RuntimeError(f"Zoho create failed: {details}")
    else:
        raise RuntimeError(f"Zoho POST {resp.status_code}: {body}")


# ── Append a subform row to an existing record ────────────────────────────────
def _append_subform_row(record_id: str, existing_rows: list, new_row: dict) -> None:
    """
    PUT the full Past_Projects subform back including the new row.
    Zoho replaces the entire subform on PUT, so we must include existing rows.
    """
    # Keep existing rows exactly as-is (Zoho needs their ids to not duplicate)
    all_rows = list(existing_rows) + [new_row]

    payload = {
        "data": [
            {
                "id":            record_id,
                "Past_Projects": all_rows,
            }
        ]
    }

    resp = requests.put(
        f"{ZOHO_BASE_URL}/crm/v2/{MODULE_API_NAME}",
        headers=_headers(),
        json=payload,
        timeout=15,
    )

    body = resp.json()
    if resp.status_code == 200:
        details = body.get("data", [{}])[0]
        if details.get("status") == "success":
            print(f"[zoho_crm] Appended subform row to record {record_id}")
            return
        else:
            raise RuntimeError(f"Zoho update failed: {details}")
    else:
        raise RuntimeError(f"Zoho PUT {resp.status_code}: {body}")


# ── Public entry point ────────────────────────────────────────────────────────
def push_project_to_zoho(
    company_name:      str,
    project_name:      str  = "",
    project_date:      str  = "",
    part_family:       str  = "",
    material:          str  = "",
    process_primary:   str  = "",
    process_secondary: str  = "",
    complexity_class:  str  = "",
    tolerance_class:   str  = "",
    outcome:           str  = "",
    ncr_description:   str  = "",
    what_worked:       str  = "",
    what_didnt:        str  = "",
    customer_industry: str  = "",
    pinecone_vector_id:str  = "",
    image_path:        str  = "",
) -> tuple[bool, str]:
    """
    Upsert a project into Zoho CRM.

    Returns (success: bool, zoho_record_id: str).
    Never raises — all errors are caught and logged so the caller's
    Pinecone upsert is never blocked by a Zoho failure.
    """
    if not company_name:
        print("[zoho_crm] No company_name — skipping Zoho push")
        return False, ""

    try:
        subform_row = _build_subform_row(
            project_name      = project_name,
            project_date      = project_date,
            part_family       = part_family,
            material          = material,
            process_primary   = process_primary,
            process_secondary = process_secondary,
            complexity_class  = complexity_class,
            tolerance_class   = tolerance_class,
            outcome           = outcome,
            ncr_description   = ncr_description,
            what_worked       = what_worked,
            what_didnt        = what_didnt,
            customer_industry = customer_industry,
            pinecone_vector_id= pinecone_vector_id,
            image_path        = image_path,
        )

        existing = _find_supplier_record(company_name)

        if existing:
            record_id     = existing["id"]
            existing_rows = existing.get("Past_Projects") or []
            _append_subform_row(record_id, existing_rows, subform_row)
            return True, record_id
        else:
            record_id = _create_supplier_record(company_name, subform_row)
            return True, record_id

    except Exception as e:
        print(f"[zoho_crm] push_project_to_zoho failed: {e}")
        return False, ""
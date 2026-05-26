"""
Unified backend entrypoint for merged modules.

Run:
  uvicorn unified.backend.app:app --reload --port 8000
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import threading
import asyncio
from pathlib import Path
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import requests
import re
import time

from unified.backend.machines_support import (
    decode_machine_notes,
    encode_machine_notes,
    join_free_text_list,
    normalize_free_text_list,
    normalize_text,
    resolve_material_alias,
    token_match,
    resolve_equipment_match,
)


ROOT = Path(__file__).resolve().parents[2]
PAST_PROJECTS_DIR = ROOT / "Past projects v2"
RFP_ASSESSMENT_DIR = ROOT / "RFP Assessment 4.0"


def _load_module_from_file(module_name: str, file_path: Path):
    spec = importlib.util.spec_from_file_location(module_name, str(file_path))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {file_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _prepend_sys_path(path: Path):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)


_prepend_sys_path(PAST_PROJECTS_DIR)
_prepend_sys_path(RFP_ASSESSMENT_DIR)

# Legacy server with ingestion/corpus/auth endpoints.
legacy_server_mod = _load_module_from_file(
    "tb_legacy_server",
    PAST_PROJECTS_DIR / "server.py",
)
legacy_app = legacy_server_mod.app

# RFP Assessment routers.
from rfp.router import router as rfp_router, recent_rfps as rfp_recent_route  # type: ignore
from assessment.router import router as assessment_router, recent_assessments as assessment_recent_route, corpus_health as assessment_corpus_route, ZOHO_BRFP_MODULE  # type: ignore
from assessment.visual_extractor import file_to_images_b64  # type: ignore


app = FastAPI(title="TrustBridge Unified API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/auth/lookup")
async def unified_auth_lookup(payload: dict):
    """Expose legacy supplier auth on the unified API surface."""
    return await legacy_server_mod.auth_lookup(payload)  # type: ignore[attr-defined]


@app.post("/auth/send-otp")
async def unified_auth_send_otp(payload: dict):
    """Expose legacy OTP delivery on the unified API surface."""
    return await legacy_server_mod.auth_send_otp(payload)  # type: ignore[attr-defined]


@app.post("/auth/verify-otp")
async def unified_auth_verify_otp(payload: dict):
    """Expose legacy OTP verification on the unified API surface."""
    return await legacy_server_mod.auth_verify_otp(payload)  # type: ignore[attr-defined]


app.include_router(legacy_app.router)
app.include_router(rfp_router, prefix="/api/rfp", tags=["RFP"])
app.include_router(assessment_router, prefix="/api/assessment", tags=["Assessment"])

# module-level caches
_MATERIAL_CATALOG_CACHE: dict[int, dict] = {}


def _warmup_clip_model() -> None:
    """
    Initialize CLIP once at startup so first user request does not pay cold-start latency.
    Safe-fail: logs warning and continues if CLIP deps/model are unavailable.
    """
    try:
        clip_mod = importlib.import_module("clip_embedder")

        # Preferred explicit loader (used in Past projects v2 clip_embedder).
        if hasattr(clip_mod, "_load") and callable(getattr(clip_mod, "_load")):
            ok = bool(clip_mod._load())  # type: ignore[attr-defined]
            if ok:
                print("[unified] CLIP warmup complete at startup.")
                return

        # Fallback path if implementation does not expose _load.
        if hasattr(clip_mod, "compute_clip_text_embedding"):
            _ = clip_mod.compute_clip_text_embedding("startup warmup")  # type: ignore[attr-defined]
            print("[unified] CLIP warmup attempted via text embedding.")
        else:
            print("[unified] CLIP warmup skipped: clip_embedder has no loader/text embedding.")
    except Exception as e:
        print(f"[unified] CLIP warmup skipped due to error: {e}")


@app.on_event("startup")
async def _startup_warmups():
    if os.getenv("CLIP_WARMUP", "true").strip().lower() in {"1", "true", "yes", "on"}:
        # Run warmup in background so API startup is not blocked.
        threading.Thread(target=_warmup_clip_model, daemon=True).start()

# Serve part images with compatible path contracts used across modules.
_ingestion_path = os.getenv("INGESTION_PATH", "").strip()
_image_candidates = []
if _ingestion_path:
    _image_candidates.append(Path(_ingestion_path) / "stored_parts")
_image_candidates.extend(
    [
        ROOT / "stored_parts",
        PAST_PROJECTS_DIR / "stored_parts",
        ROOT / "Past projects new version" / "stored_parts",
    ]
)
_images_dir = next((p for p in _image_candidates if p.is_dir()), None)
if _images_dir:
    app.mount("/images", StaticFiles(directory=str(_images_dir)), name="part_images")
    # Legacy CSV/metadata may reference /parts/*; expose same directory there too.
    app.mount("/parts", StaticFiles(directory=str(_images_dir)), name="part_images_legacy")
    print(f"[unified] Serving part images from {_images_dir}")
else:
    print("[unified] Images dir not found. Checked:")
    for p in _image_candidates:
        print(f"  - {p}")


@app.get("/unified/health")
def unified_health():
    return JSONResponse(
        {
            "status": "ok",
            "service": "trustbridge-unified",
            "modules": ["past-projects-v2", "rfp-assessment-4.0"],
            "cwd": os.getcwd(),
        }
    )


@app.get("/health")
def health():
    return unified_health()


def _zoho_api_base() -> str:
    return getattr(legacy_server_mod, "ZOHO_API_BASE", "https://www.zohoapis.com/crm/v2")


def _zoho_headers() -> dict:
    return legacy_server_mod.zoho_headers()  # type: ignore[attr-defined]


def _to_lookup_id(value) -> str:
    if isinstance(value, dict):
        return str(value.get("id") or "").strip()
    return str(value or "").strip()


def _to_lookup_name(value) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or value.get("Name") or "").strip()
    return str(value or "").strip()


def _paged_zoho_fetch(module_api: str, limit: int = 200) -> list[dict]:
    rows: list[dict] = []
    page = 1
    per_page = min(max(int(limit or 200), 1), 200)
    while True:
        resp = requests.get(
            f"{_zoho_api_base()}/{module_api}",
            headers=_zoho_headers(),
            params={"page": page, "per_page": per_page},
            timeout=20,
        )
        if resp.status_code == 204:
            break
        resp.raise_for_status()
        batch = resp.json().get("data", []) or []
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < per_page or len(rows) >= limit:
            break
        page += 1
    return rows[:limit]


def _pick_lookup_label(value) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or value.get("Name") or value.get("id") or "").strip()
    return str(value or "").strip()


def _parse_zoho_datetime(raw) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    candidates = [text]
    if text.endswith("Z"):
        candidates.append(text.replace("Z", "+00:00"))
    for candidate in candidates:
        try:
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            continue
    return None


def _normalize_brfp_status(value) -> str:
    return str(value or "").strip().lower().replace("-", "_").replace(" ", "_")


def _is_brfp_active_status(value) -> bool:
    status = _normalize_brfp_status(value)
    if not status:
        return True
    blocked = {
        "closed",
        "cancelled",
        "canceled",
        "expired",
        "lost",
        "archived",
        "quote_submitted",
        "won",
        "no_bid",
        "declined",
    }
    return status not in blocked


def _list_zoho_module_attachments(module_api: str, record_id: str) -> list[dict]:
    if not record_id:
        return []
    try:
        resp = requests.get(
            f"{_zoho_api_base()}/{module_api}/{record_id}/Attachments",
            headers=_zoho_headers(),
            timeout=15,
        )
        if resp.status_code == 204:
            return []
        if resp.status_code != 200:
            return []
        return resp.json().get("data", []) or []
    except Exception:
        return []


def _extract_brfp_parts(parts_value) -> list[dict]:
    rows = parts_value if isinstance(parts_value, list) else []
    parts = []
    for idx, part in enumerate(rows):
        if not isinstance(part, dict):
            continue
        file_upload = part.get("File_Upload")
        parts.append(
            {
                "id": str(part.get("Part_Name") or f"P-{idx + 1:03d}").strip() or f"P-{idx + 1:03d}",
                "description": str(part.get("Part_Name") or part.get("Description") or f"Part {idx + 1}").strip() or f"Part {idx + 1}",
                "material": str(part.get("Material") or "").strip(),
                "process": str(part.get("Process") or "").strip(),
                "other": str(part.get("Other") or "").strip(),
                "qty": part.get("Quantity") or 1,
                "finish": str(part.get("Finish") or "").strip(),
                "file_upload": file_upload,
            }
        )
    return parts


def _map_brfp_row_for_supplier_portal(row: dict) -> dict | None:
    record_id = str(row.get("id") or "").strip()
    if not record_id:
        return None
    parts = _extract_brfp_parts(row.get("Parts"))
    processes = [p["process"] for p in parts if p.get("process")]
    materials = [p["material"] for p in parts if p.get("material")]
    certs_multi = row.get("Cert_Requirements_Multi") if isinstance(row.get("Cert_Requirements_Multi"), list) else []
    certs_text = str(row.get("Certification_Requests") or "").strip()
    certs = []
    for value in certs_multi:
        text = str(value or "").strip()
        if text and text not in certs:
            certs.append(text)
    for value in re.split(r"[\n,;]+", certs_text):
        text = str(value or "").strip()
        if text and text not in certs:
            certs.append(text)
    created_dt = _parse_zoho_datetime(row.get("Created_Time")) or _parse_zoho_datetime(row.get("Modified_Time"))
    created_iso = created_dt.isoformat() if created_dt else ""
    summary = (
        str(row.get("Project_Description_New") or "").strip()
        or str(row.get("Project_Description") or "").strip()
        or str(row.get("Additional_Information") or "").strip()
        or str(row.get("Other_Requests_or_Requirements") or "").strip()
        or str(row.get("Name") or row.get("RFQ_No") or "TrustBridge RFP").strip()
    )
    return {
        "id": f"CRM-RFP-{record_id}",
        "rfp_id": str(row.get("RFQ_No") or row.get("Name") or f"BRFP-{record_id[-6:]}").strip() or f"BRFP-{record_id[-6:]}",
        "record_id": record_id,
        "zoho_id": record_id,
        "crm_source": True,
        "buyer": str(row.get("Client_Company_Name") or row.get("Account_Name") or row.get("Name1") or "TrustBridge Buyer").strip(),
        "project": str(row.get("Name") or row.get("Project_Description") or row.get("Project_Description_New") or row.get("RFQ_No") or "TrustBridge RFP").strip(),
        "summary": summary,
        "status": _normalize_brfp_status(row.get("CRFQ_Status")) or "new",
        "created_at": created_iso,
        "delivery": str(row.get("Target_Delivery") or "").strip(),
        "location": str(row.get("Client_Geography") or "").strip(),
        "geo_preference": str(row.get("Geographic_Preferences") or row.get("Geographic_Constraints") or row.get("Client_Geography") or "").strip(),
        "geo_constraint_multi": row.get("Geo_Constraint_Multi") if isinstance(row.get("Geo_Constraint_Multi"), list) else [],
        "certs_required": certs,
        "certification_preferences": str(row.get("Certification_Preferences") or "").strip(),
        "parts_count": len(parts) or 1,
        "parts": parts,
        "processes": list(dict.fromkeys(processes)),
        "materials": list(dict.fromkeys(materials)),
        "referring_supplier": _pick_lookup_label(row.get("Referring_Supplier")),
        "from_referral": bool(row.get("From_Referral")),
        "supplier_email": str(row.get("Supplier_email") or "").strip().lower(),
        "attachments_count": 0,
    }


def _fetch_recent_brfps_for_supplier_portal(supplier_email: str = "", limit: int = 50, days: int = 30) -> list[dict]:
    rows = _paged_zoho_fetch(ZOHO_BRFP_MODULE, limit=min(max(limit * 4, limit), 200))
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(days, 1))
    semail = str(supplier_email or "").strip().lower()
    items: list[dict] = []
    for row in rows:
        created_dt = _parse_zoho_datetime(row.get("Created_Time")) or _parse_zoho_datetime(row.get("Modified_Time"))
        if created_dt and created_dt < cutoff:
            continue
        if not _is_brfp_active_status(row.get("CRFQ_Status")):
            continue
        if semail:
            supplier_email = str(row.get("Supplier_email") or "").strip().lower()
            if supplier_email and supplier_email == semail:
                continue
        mapped = _map_brfp_row_for_supplier_portal(row)
        if mapped:
            items.append(mapped)
        if len(items) >= limit:
            break
    return items[:limit]


def _fetch_single_zoho_record(module_api: str, record_id: str) -> dict | None:
    rid = str(record_id or "").strip()
    if not rid:
        return None
    try:
        resp = requests.get(
            f"{_zoho_api_base()}/{module_api}/{rid}",
            headers=_zoho_headers(),
            timeout=20,
        )
        if resp.status_code != 200:
            return None
        rows = resp.json().get("data", []) or []
        return rows[0] if rows else None
    except Exception:
        return None


def _normalize_machine_date(raw: str = "") -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    if re.fullmatch(r"\d{4}", text):
        return f"{text}-01-01"
    return text


def _normalize_numeric_serial(raw: str = "") -> tuple[str, str]:
    text = str(raw or "").strip()
    if not text:
        return "", ""
    digits = re.sub(r"\D+", "", text)
    if digits and digits == text:
        return digits, ""
    return "", text


def _fetch_material_catalog(limit: int = 500) -> list[dict]:
    # Lightweight in-process cache to avoid re-fetching full material catalog
    # on every machine save/edit.
    global _MATERIAL_CATALOG_CACHE
    now = time.time()
    cache_key = int(min(max(limit or 500, 1), 1000))
    cached = _MATERIAL_CATALOG_CACHE.get(cache_key)
    if cached and (now - float(cached.get("ts") or 0)) < 300:
        return list(cached.get("data") or [])

    rows = _paged_zoho_fetch("Materials", limit=limit)
    materials = []
    for rec in rows:
        name = (
            str(rec.get("Name") or "").strip()
            or str(rec.get("Material_Name") or "").strip()
            or str(rec.get("Brand_Name") or "").strip()
            or str(rec.get("Title") or "").strip()
        )
        if not name:
            continue
        materials.append(
            {
                "id": str(rec.get("id") or "").strip(),
                "name": name,
                "display_name": name,
                "generic_name": str(rec.get("Generic_Name") or "").strip(),
                "material_class": str(rec.get("Material_Class") or "").strip(),
                "material_family": str(rec.get("Material_Family") or "").strip(),
            }
        )
    materials.sort(key=lambda item: item["name"].lower())
    _MATERIAL_CATALOG_CACHE[cache_key] = {"ts": now, "data": materials}
    return materials


def _resolve_material_to_crm_record(material_text: str, material_catalog: list[dict]) -> dict:
    spoken = str(material_text or "").strip()
    if not spoken:
        return {"status": "UNRESOLVED", "input": spoken}

    normalized_spoken = normalize_text(spoken)
    resolution = resolve_material_alias(spoken)

    def _score_catalog_item(item: dict, terms: list[str]) -> int:
        score = 0
        name = str(item.get("name") or "").strip()
        generic_name = str(item.get("generic_name") or "").strip()
        fields = [
            normalize_text(name),
            normalize_text(generic_name),
            normalize_text(item.get("material_class")),
            normalize_text(item.get("material_family")),
        ]
        for term in terms:
            norm_term = normalize_text(term)
            if not norm_term:
                continue
            for field in fields:
                if not field:
                    continue
                if field == norm_term:
                    score += 20
                elif norm_term in field or field in norm_term:
                    score += 12
                elif token_match(norm_term, field, 0.66):
                    score += 7
        return score

    candidate_terms = [spoken]
    if resolution.get("status") == "MATCHED" and resolution.get("brand_name"):
        candidate_terms.insert(0, str(resolution.get("brand_name") or "").strip())
        if resolution.get("generic"):
            candidate_terms.append(str(resolution.get("generic") or "").strip())

    best = None
    best_score = -1
    for item in material_catalog:
        score = _score_catalog_item(item, candidate_terms)
        if score > best_score:
            best = item
            best_score = score

    if best and best_score >= 12:
        return {
            "status": "MATCHED",
            "input": spoken,
            "material_id": str(best.get("id") or "").strip(),
            "material_name": str(best.get("name") or "").strip(),
            "score": best_score,
            "resolution": resolution,
        }

    for item in material_catalog:
        item_name = normalize_text(item.get("name"))
        if item_name and (normalized_spoken == item_name or token_match(normalized_spoken, item_name, 0.8)):
            return {
                "status": "MATCHED",
                "input": spoken,
                "material_id": str(item.get("id") or "").strip(),
                "material_name": str(item.get("name") or "").strip(),
                "score": 10,
                "resolution": resolution,
            }

    return {"status": "UNRESOLVED", "input": spoken, "resolution": resolution}


def _auto_resolve_machine_materials(selected_material_ids: list[str], typed_materials: list[str], material_catalog: list[dict]) -> dict:
    resolved_ids = []
    seen_ids = set()
    for material_id in selected_material_ids or []:
        clean_id = str(material_id or "").strip()
        if clean_id and clean_id not in seen_ids:
            seen_ids.add(clean_id)
            resolved_ids.append(clean_id)

    auto_resolved = []
    unresolved = []
    for material_text in typed_materials or []:
        result = _resolve_material_to_crm_record(material_text, material_catalog)
        if result.get("status") == "MATCHED" and result.get("material_id"):
            material_id = str(result["material_id"]).strip()
            if material_id not in seen_ids:
                seen_ids.add(material_id)
                resolved_ids.append(material_id)
            auto_resolved.append(result)
        else:
            unresolved.append(str(material_text or "").strip())

    return {
        "material_ids": resolved_ids,
        "auto_resolved": auto_resolved,
        "unresolved": [item for item in unresolved if item],
    }


def _fetch_machine_material_links(machine_ids: list[str], limit: int = 1000) -> dict[str, list[dict]]:
    if not machine_ids:
        return {}
    wanted = {str(mid).strip() for mid in machine_ids if str(mid).strip()}
    if not wanted:
        return {}
    material_catalog = {item["id"]: item for item in _fetch_material_catalog(limit=500)}
    rows = _paged_zoho_fetch("Machines_X_Materials", limit=limit)
    by_machine: dict[str, list[dict]] = {mid: [] for mid in wanted}
    for rec in rows:
        machine_lookup = rec.get("Related_Machines") or rec.get("Machine_Lookup") or rec.get("Machine") or {}
        machine_id = _to_lookup_id(machine_lookup)
        if machine_id not in wanted:
            continue
        material_lookup = rec.get("Multi_Select_Material_Lookup") or rec.get("Material_Lookup") or rec.get("Material") or {}
        material_id = _to_lookup_id(material_lookup)
        material_name = _to_lookup_name(material_lookup)
        if material_id and not material_name:
            material_name = material_catalog.get(material_id, {}).get("name", "")
        by_machine.setdefault(machine_id, []).append(
            {
                "junction_id": str(rec.get("id") or "").strip(),
                "material_id": material_id,
                "material_name": material_name,
            }
        )
    return by_machine


def _map_machine_record(rec: dict, links: list[dict] | None = None) -> dict:
    parsed_notes = decode_machine_notes(rec.get("Machine_Notes"))
    equipment_lookup = rec.get("Equipment_Lookup") or {}
    material_links = links or []
    material_names = [str(link.get("material_name") or "").strip() for link in material_links if str(link.get("material_name") or "").strip()]
    serial_number = str(rec.get("Serial_Number") or "").strip() or parsed_notes.get("serial_text", "")
    install_date = str(rec.get("Year_of_Purchase_Install_Date") or "").strip()
    return {
        "id": str(rec.get("id") or "").strip(),
        "name": str(rec.get("Name") or "").strip(),
        "account_lookup_id": _to_lookup_id(rec.get("Account_Lookup")),
        "matched_equipment_id": _to_lookup_id(equipment_lookup),
        "matched_equipment_name": _to_lookup_name(equipment_lookup),
        "matched_equipment_link": str((equipment_lookup or {}).get("Equipment_Link") or "").strip() if isinstance(equipment_lookup, dict) else "",
        "equipment_text": str(rec.get("Extracted_Equipment") or "").strip(),
        "other_equipment": str(rec.get("Other_Equipment") or "").strip(),
        "manufacturer": parsed_notes.get("manufacturer", ""),
        "serial_number": serial_number,
        "status": str(rec.get("Status") or "").strip(),
        "year_of_purchase_install_date": install_date,
        "year_label": install_date[:4] if len(install_date) >= 4 else "",
        "machine_notes": parsed_notes.get("notes", ""),
        "use_cases": str(rec.get("Use_Cases") or "").strip(),
        "other_materials": str(rec.get("Other_Materials") or "").strip(),
        "extracted_materials": str(rec.get("Extracted_Materials") or "").strip(),
        "material_ids": [str(link.get("material_id") or "").strip() for link in material_links if str(link.get("material_id") or "").strip()],
        "materials": material_names,
        "material_links": material_links,
        "email": str(rec.get("Email") or "").strip(),
        "auto_resolved_materials": [],
    }


def _save_machine_material_links(machine_id: str, material_ids: list[str]) -> dict:
    clean_machine_id = str(machine_id or "").strip()
    desired = []
    seen = set()
    for material_id in material_ids or []:
        value = str(material_id or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        desired.append(value)

    current_links = _fetch_machine_material_links([clean_machine_id]).get(clean_machine_id, [])
    existing_by_material: dict[str, dict] = {}
    duplicate_link_ids: list[str] = []
    for link in current_links:
        material_id = str(link.get("material_id") or "").strip()
        if not material_id:
            continue
        if material_id in existing_by_material:
            if link.get("junction_id"):
                duplicate_link_ids.append(str(link["junction_id"]))
            continue
        existing_by_material[material_id] = link

    to_create = [material_id for material_id in desired if material_id not in existing_by_material]
    to_delete = duplicate_link_ids + [
        str(link.get("junction_id") or "").strip()
        for material_id, link in existing_by_material.items()
        if material_id not in desired and str(link.get("junction_id") or "").strip()
    ]

    created = 0
    for material_id in to_create:
        resp = requests.post(
            f"{_zoho_api_base()}/Machines_X_Materials",
            headers=_zoho_headers(),
            json={"data": [{"Related_Machines": clean_machine_id, "Multi_Select_Material_Lookup": material_id}]},
            timeout=20,
        )
        resp.raise_for_status()
        body = resp.json()
        row = (body.get("data") or [{}])[0]
        if row.get("status") == "success":
            created += 1

    deleted = 0
    if to_delete:
        resp = requests.delete(
            f"{_zoho_api_base()}/Machines_X_Materials",
            headers=_zoho_headers(),
            params={"ids": ",".join(to_delete)},
            timeout=20,
        )
        if resp.status_code not in (200, 202):
            resp.raise_for_status()
        deleted = len(to_delete)

    return {"created": created, "deleted": deleted}


@app.get("/api/machines")
async def get_machines(supplier_id: str = "", supplier_email: str = "", limit: int = 300):
    try:
        sid = str(supplier_id or "").strip()
        semail = str(supplier_email or "").strip().lower()
        if not sid and not semail:
            return JSONResponse({"ok": False, "error": "supplier_id or supplier_email is required", "machines": []}, status_code=400)

        rows = _paged_zoho_fetch("Machines", limit=min(max(limit, 1), 500))
        filtered = []
        for rec in rows:
            account_id = _to_lookup_id(rec.get("Account_Lookup"))
            email = str(rec.get("Email") or "").strip().lower()
            secondary_email = str(rec.get("Secondary_Email") or "").strip().lower()
            if sid and account_id == sid:
                filtered.append(rec)
                continue
            if semail and semail in {email, secondary_email}:
                filtered.append(rec)

        machine_ids = [str(rec.get("id") or "").strip() for rec in filtered if str(rec.get("id") or "").strip()]
        links_by_machine = _fetch_machine_material_links(machine_ids)
        machines = [_map_machine_record(rec, links_by_machine.get(str(rec.get("id") or "").strip(), [])) for rec in filtered]
        return JSONResponse({"ok": True, "machines": machines, "count": len(machines), "rows": len(filtered)})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e), "machines": []}, status_code=500)


@app.get("/api/machines/materials")
async def get_machine_materials(limit: int = 500):
    try:
        materials = _fetch_material_catalog(limit=min(max(limit, 1), 1000))
        return JSONResponse({"ok": True, "materials": materials, "count": len(materials)})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e), "materials": []}, status_code=500)


@app.post("/api/machines/resolve-equipment")
async def resolve_machine_equipment(payload: dict):
    try:
        raw_text = " ".join(
            [
                str(payload.get("manufacturer") or "").strip(),
                str(payload.get("equipment_text") or payload.get("name") or "").strip(),
            ]
        ).strip()
        result = resolve_equipment_match(raw_text, limit=5)
        return JSONResponse({"ok": True, **result, "query": raw_text})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e), "status": "UNRESOLVED"}, status_code=500)


@app.post("/api/machines/save")
async def save_machine(payload: dict):
    try:
        t0 = time.time()
        supplier_id = str(payload.get("supplier_id") or "").strip()
        supplier_email = str(payload.get("supplier_email") or "").strip().lower()
        if not supplier_id:
            return JSONResponse({"ok": False, "error": "supplier_id is required"}, status_code=400)

        machine_id = str(payload.get("id") or "").strip()
        name = str(payload.get("name") or "").strip()
        equipment_text = str(payload.get("equipment_text") or "").strip()
        manufacturer = str(payload.get("manufacturer") or "").strip()
        status = str(payload.get("status") or "").strip()
        use_cases = str(payload.get("use_cases") or "").strip()
        other_equipment = str(payload.get("other_equipment") or "").strip()
        typed_other_materials = normalize_free_text_list(payload.get("other_materials"))
        material_catalog = _fetch_material_catalog(limit=500)
        resolved_materials = _auto_resolve_machine_materials(
            [str(item).strip() for item in (payload.get("material_ids") or []) if str(item).strip()],
            typed_other_materials,
            material_catalog,
        )
        material_ids = resolved_materials["material_ids"]
        other_materials = join_free_text_list(resolved_materials["unresolved"])
        catalog_by_id = {item["id"]: item["name"] for item in material_catalog}
        material_names = [catalog_by_id[mid] for mid in material_ids if mid in catalog_by_id]

        numeric_serial, serial_text = _normalize_numeric_serial(str(payload.get("serial_number") or ""))
        matched_equipment_id = str(payload.get("matched_equipment_id") or "").strip()

        machine_record = {
            "Name": name or equipment_text or "Machine",
            "Account_Lookup": {"id": supplier_id},
            "Extracted_Equipment": equipment_text,
            "Extracted_Materials": ", ".join(material_names),
            "Machine_Notes": encode_machine_notes(str(payload.get("machine_notes") or ""), manufacturer=manufacturer, serial_text=serial_text),
            "Use_Cases": use_cases,
            "Status": status,
            "Other_Equipment": other_equipment,
            "Other_Materials": other_materials,
            "Year_of_Purchase_Install_Date": _normalize_machine_date(str(payload.get("year_of_purchase_install_date") or "")),
        }
        if supplier_email:
            machine_record["Email"] = supplier_email
        if matched_equipment_id:
            machine_record["Equipment_Lookup"] = matched_equipment_id
        elif machine_id:
            machine_record["Equipment_Lookup"] = None
        if numeric_serial:
            machine_record["Serial_Number"] = numeric_serial

        cleaned_record = {
            k: v
            for k, v in machine_record.items()
            if v not in ("", {}, []) and (v is not None or k == "Equipment_Lookup")
        }
        if machine_id:
            resp = requests.put(
                f"{_zoho_api_base()}/Machines/{machine_id}",
                headers=_zoho_headers(),
                json={"data": [cleaned_record]},
                timeout=20,
            )
        else:
            resp = requests.post(
                f"{_zoho_api_base()}/Machines",
                headers=_zoho_headers(),
                json={"data": [cleaned_record]},
                timeout=20,
            )
        resp.raise_for_status()
        body = resp.json()
        row = (body.get("data") or [{}])[0]
        if row.get("status") != "success":
            raise ValueError(f"Zoho machine save failed: {row}")
        record_id = machine_id or str((row.get("details") or {}).get("id") or "").strip()
        if not record_id:
            raise ValueError("Zoho did not return a machine id")

        original_material_ids = [
            str(item).strip()
            for item in (payload.get("material_ids_original") or [])
            if str(item).strip()
        ]
        desired_sorted = sorted(set(material_ids))
        original_sorted = sorted(set(original_material_ids))
        if machine_id and original_sorted == desired_sorted:
            material_sync = {"created": 0, "deleted": 0, "skipped": True}
        else:
            material_sync = _save_machine_material_links(record_id, material_ids)

        machine = {
            "id": record_id,
            "name": cleaned_record.get("Name", ""),
            "account_lookup_id": supplier_id,
            "matched_equipment_id": matched_equipment_id,
            "matched_equipment_name": str(payload.get("matched_equipment_name") or "").strip(),
            "matched_equipment_link": "",
            "equipment_text": equipment_text,
            "other_equipment": other_equipment,
            "manufacturer": manufacturer,
            "serial_number": numeric_serial or serial_text,
            "status": status,
            "year_of_purchase_install_date": _normalize_machine_date(str(payload.get("year_of_purchase_install_date") or "")),
            "year_label": _normalize_machine_date(str(payload.get("year_of_purchase_install_date") or ""))[:4],
            "machine_notes": str(payload.get("machine_notes") or ""),
            "use_cases": use_cases,
            "other_materials": other_materials,
            "extracted_materials": ", ".join(material_names),
            "material_ids": material_ids,
            "materials": material_names,
            "material_links": [{"material_id": mid, "material_name": catalog_by_id.get(mid, "")} for mid in material_ids],
            "email": supplier_email,
        }
        machine["auto_resolved_materials"] = resolved_materials["auto_resolved"]
        elapsed_ms = int((time.time() - t0) * 1000)
        print(
            "[machines][save] done "
            f"id={record_id} create={not bool(machine_id)} "
            f"material_count={len(material_ids)} sync={material_sync} "
            f"elapsed_ms={elapsed_ms}"
        )
        return JSONResponse({
            "ok": True,
            "machine": machine,
            "material_sync": material_sync,
            "material_resolution": {
                "auto_resolved": resolved_materials["auto_resolved"],
                "unresolved": resolved_materials["unresolved"],
            },
            "zoho_id": record_id,
        })
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/ingestion/analytics")
async def ingestion_analytics(
    supplier_id: str = "",
    supplier_email: str = "",
    limit: int = 300,
):
    """
    Backend-composed ingestion payload for analytics tab.
    Mirrors Past projects v2 sources in one call:
      - projects
      - process profiles
      - manufacturing lessons
      - quoting lessons
    """
    safe_supplier_id = (supplier_id or "").strip()
    safe_supplier_email = (supplier_email or "").strip().lower()
    if not safe_supplier_id and not safe_supplier_email:
        return JSONResponse(
            {"ok": False, "error": "supplier_id or supplier_email is required"},
            status_code=400,
        )
    safe_limit = max(1, min(limit, 500))
    project_lookup_limit = 500

    async def _load_projects():
        rows = await asyncio.to_thread(
            legacy_server_mod._fetch_zoho_supplier_projects,  # type: ignore[attr-defined]
            safe_supplier_id,
            safe_supplier_email,
            safe_limit,
        )
        return legacy_server_mod._records_to_corpus_projects(rows)  # type: ignore[attr-defined]

    async def _load_profiles():
        rows = await asyncio.to_thread(
            legacy_server_mod._fetch_zoho_process_profiles,  # type: ignore[attr-defined]
            safe_supplier_id,
            safe_supplier_email,
            safe_limit,
        )
        return legacy_server_mod._records_to_process_profiles(rows)  # type: ignore[attr-defined]

    async def _load_lessons():
        lessons_resp = await legacy_server_mod.zoho_lessons(  # type: ignore[attr-defined]
            supplier_id=safe_supplier_id,
            supplier_email=safe_supplier_email,
            limit=safe_limit,
        )
        raw = {}
        body = getattr(lessons_resp, "body", b"")
        if isinstance(body, (bytes, bytearray)) and body:
            raw = json.loads(body.decode("utf-8"))
        elif isinstance(lessons_resp, dict):
            raw = lessons_resp
        return (
            list(raw.get("mfg_lessons") or []),
            list(raw.get("quoting_lessons") or []),
        )

    p_res, pr_res, l_res = await asyncio.gather(
        _load_projects(),
        _load_profiles(),
        _load_lessons(),
        return_exceptions=True,
    )

    if isinstance(p_res, Exception):
        return JSONResponse({"ok": False, "error": f"Projects fetch failed: {p_res}"}, status_code=500)
    projects = p_res
    profiles = [] if isinstance(pr_res, Exception) else pr_res
    if isinstance(l_res, Exception):
        mfg_lessons, quoting_lessons = [], []
    else:
        mfg_lessons, quoting_lessons = l_res

    parts = []
    process_counts: dict[str, int] = {}
    material_counts: dict[str, int] = {}
    for project in projects:
        for part in list(project.get("parts") or []):
            parts.append(part)
            process = str(part.get("process_primary") or part.get("process") or "").strip()
            material = str(part.get("material") or "").strip()
            if process:
                process_counts[process] = process_counts.get(process, 0) + 1
            if material:
                material_counts[material] = material_counts.get(material, 0) + 1

    profile_process_counts: dict[str, int] = {}
    for profile in profiles:
        key = str(
            profile.get("generic_process")
            or profile.get("branded_process")
            or profile.get("process_family")
            or ""
        ).strip()
        if key:
            profile_process_counts[key] = profile_process_counts.get(key, 0) + 1

    quoting_linked = sum(1 for l in quoting_lessons if str(l.get("source_job") or "").strip())
    mfg_linked = sum(1 for l in mfg_lessons if str(l.get("source_part") or "").strip())

    top_process = sorted(process_counts.items(), key=lambda kv: kv[1], reverse=True)[:1]
    top_material = sorted(material_counts.items(), key=lambda kv: kv[1], reverse=True)[:1]
    uncovered_profiles = [p for p in profile_process_counts.keys() if p not in process_counts]

    return JSONResponse(
        {
            "ok": True,
            "projects": projects,
            "profiles": profiles,
            "mfg_lessons": mfg_lessons,
            "quoting_lessons": quoting_lessons,
            "counts": {
                "projects": len(projects),
                "parts": len(parts),
                "profiles": len(profiles),
                "mfg_lessons": len(mfg_lessons),
                "quoting_lessons": len(quoting_lessons),
            },
            "analytics": {
                "process_counts": process_counts,
                "material_counts": material_counts,
                "profile_process_counts": profile_process_counts,
                "quoting_linked": quoting_linked,
                "mfg_linked": mfg_linked,
                "top_process": {"name": top_process[0][0], "count": top_process[0][1]} if top_process else None,
                "top_material": {"name": top_material[0][0], "count": top_material[0][1]} if top_material else None,
                "uncovered_profiles": uncovered_profiles,
            },
        }
    )


@app.get("/api/ingestion/inbound-stats")
async def inbound_stats(
    supplier_id: str = "",
    supplier_email: str = "",
    limit: int = 100,
):
    """
    Single-call inbound stats feed for ingestion analytics.
    Consolidates:
      - /api/rfp/recent (scoped + global)
      - /api/assessment/recent (crm + scoped + global)
    """
    safe_limit = max(1, min(limit, 100))
    sid = (supplier_id or "").strip()
    semail = (supplier_email or "").strip().lower()
    if not sid and not semail:
        return JSONResponse(
            {"ok": False, "error": "supplier_id or supplier_email is required"},
            status_code=400,
        )

    async def _rfp_scoped_only():
        # RFP recent route is supplier-id scoped; avoid global fallback when id is absent.
        if not sid:
            return {"items": []}
        return await rfp_recent_route(supplier_id=sid, limit=safe_limit)

    rfp_scoped, asmt_crm, asmt_scoped = await asyncio.gather(
        _rfp_scoped_only(),
        assessment_recent_route(
            supplier_id=sid or None,
            supplier_email=semail or None,
            limit=safe_limit,
            crm_only=True,
        ),
        assessment_recent_route(
            supplier_id=sid or None,
            supplier_email=semail or None,
            limit=safe_limit,
            crm_only=False,
        ),
        return_exceptions=True,
    )

    def _items(res):
        if isinstance(res, Exception):
            return []
        return list((res or {}).get("items") or [])

    return JSONResponse(
        {
            "ok": True,
            "rfps_scoped": _items(rfp_scoped),
            "rfps_global": [],
            "assessments_crm": _items(asmt_crm),
            "assessments_scoped": _items(asmt_scoped),
            "assessments_global": [],
        }
    )


@app.get("/api/projects/attachments")
async def project_attachments(
    record_id: str = "",
    part_id: str = "",
    supplier_id: str = "",
    supplier_email: str = "",
    limit: int = 300,
):
    """
    List Zoho attachments for a Supplier_Past_Projects record.
    Returns preview/download URLs via existing legacy proxy route.
    """
    rid = (record_id or "").strip()
    pid = (part_id or "").strip()
    sid = (supplier_id or "").strip()
    semail = (supplier_email or "").strip().lower()
    safe_limit = max(1, min(limit, 500))
    project_lookup_limit = 500
    if not rid and not pid:
        return JSONResponse({"ok": False, "error": "record_id or part_id is required", "attachments": []}, status_code=400)
    if not sid and not semail:
        return JSONResponse(
            {"ok": False, "error": "supplier_id or supplier_email is required", "attachments": []},
            status_code=400,
        )
    try:
        # Always resolve supplier-scoped rows first and enforce ownership.
        rows = legacy_server_mod._fetch_zoho_supplier_projects(  # type: ignore[attr-defined]
            supplier_id=sid,
            supplier_email=semail,
            limit=project_lookup_limit,
        )
        allowed_record_ids = {str((rec or {}).get("id") or "").strip() for rec in (rows or [])}

        # Fallback: resolve record_id from Pinecone vector id (part_id) if record_id not provided.
        if not rid and pid:
            for rec in rows or []:
                if str(rec.get("Pinecone_Vector_ID") or "").strip() == pid:
                    rid = str(rec.get("id") or "").strip()
                    break

        if not rid:
            return JSONResponse({"ok": False, "error": "Could not resolve record_id from part_id", "attachments": []}, status_code=404)
        if rid not in allowed_record_ids:
            return JSONResponse({"ok": False, "error": "Record not found for supplier", "attachments": []}, status_code=404)

        rows = legacy_server_mod._list_zoho_attachments(rid)  # type: ignore[attr-defined]
        attachments = []
        for a in rows or []:
            aid = str((a or {}).get("id") or "").strip()
            name = str((a or {}).get("File_Name") or (a or {}).get("file_name") or "").strip()
            content_type = str(
                (a or {}).get("Content_Type")
                or (a or {}).get("content_type")
                or (a or {}).get("Mime_Type")
                or (a or {}).get("mime_type")
                or (a or {}).get("$file_type")
                or ""
            ).strip().lower()
            ext = Path(name).suffix.lower()
            is_image = ext in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"} or content_type.startswith("image/")
            proxy = f"/zoho-attachment-image?record_id={rid}&attachment_id={aid}" if aid else ""
            attachments.append(
                {
                    "id": aid,
                    "name": name,
                    "is_image": bool(is_image),
                    "content_type": content_type,
                    "url": proxy,
                }
            )
        return JSONResponse({"ok": True, "record_id": rid, "attachments": attachments})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e), "attachments": []}, status_code=500)


@app.get("/api/rfp/crm-media")
async def rfp_crm_media(record_id: str = "", limit: int = 12):
    """
    Return BRFP attachment metadata plus image/CAD previews for supplier assessment.
    Uses the same BRFP module that no-bid routing writes into.
    """
    rid = (record_id or "").strip()
    safe_limit = max(1, min(limit, 20))
    if not rid:
        return JSONResponse({"ok": False, "error": "record_id is required", "attachments": [], "image_urls": [], "cad_previews_b64": []}, status_code=400)
    try:
        attachments = _list_zoho_module_attachments(ZOHO_BRFP_MODULE, rid)[:safe_limit]
        image_urls: list[str] = []
        cad_previews_b64: list[str] = []
        normalized_attachments: list[dict] = []
        image_exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
        cad_exts = {".step", ".stp", ".igs", ".iges", ".stl", ".obj", ".3mf", ".glb", ".gltf", ".ply"}

        for att in attachments:
            aid = str((att or {}).get("id") or "").strip()
            name = str((att or {}).get("File_Name") or (att or {}).get("file_name") or "").strip()
            ext = Path(name).suffix.lower()
            proxy = f"/zoho-attachment-image?module_api={ZOHO_BRFP_MODULE}&record_id={rid}&attachment_id={aid}" if aid else ""
            normalized_attachments.append(
                {
                    "id": aid,
                    "name": name,
                    "url": proxy,
                    "is_image": ext in image_exts,
                    "is_cad": ext in cad_exts,
                }
            )
            if ext in image_exts and proxy:
                image_urls.append(proxy)
                continue
            if ext not in cad_exts:
                continue
            try:
                blob = requests.get(
                    f"{_zoho_api_base()}/{ZOHO_BRFP_MODULE}/{rid}/Attachments/{aid}",
                    headers=_zoho_headers(),
                    timeout=20,
                )
                if blob.status_code != 200:
                    continue
                previews = file_to_images_b64(blob.content, name) or []
                if previews:
                    cad_previews_b64.append(previews[0])
            except Exception:
                continue

        return JSONResponse(
            {
                "ok": True,
                "record_id": rid,
                "attachments": normalized_attachments,
                "image_urls": image_urls,
                "cad_previews_b64": cad_previews_b64,
                "overall_image_b64": cad_previews_b64[0] if cad_previews_b64 else "",
            }
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e), "attachments": [], "image_urls": [], "cad_previews_b64": []}, status_code=500)


@app.get("/api/rfp/crm-record")
async def rfp_crm_record(record_id: str = ""):
    """
    Fetch the full BRFP record so the UI can hydrate exact Parts subform values.
    """
    rid = (record_id or "").strip()
    if not rid:
        return JSONResponse({"ok": False, "error": "record_id is required"}, status_code=400)
    try:
        row = _fetch_single_zoho_record(ZOHO_BRFP_MODULE, rid)
        if not row:
            return JSONResponse({"ok": False, "error": "BRFP record not found"}, status_code=404)
        mapped = _map_brfp_row_for_supplier_portal(row)
        if not mapped:
            return JSONResponse({"ok": False, "error": "Could not map BRFP record"}, status_code=500)
        return JSONResponse({"ok": True, "item": mapped})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/dashboard/bootstrap")
async def dashboard_bootstrap(
    supplier_id: str = "",
    supplier_email: str = "",
    supplier_name: str = "",
    limit: int = 100,
    include_corpus: int = 0,
):
    """
    Single-call dashboard feed:
      - /api/rfp/recent (scoped + global)
      - /api/assessment/recent (crm + scoped + global)
      - /api/assessment/corpus-health
    """
    safe_limit = max(1, min(limit, 100))
    sid = (supplier_id or "").strip()
    semail = (supplier_email or "").strip().lower()
    sname = (supplier_name or "").strip()
    if not sid and not semail:
        return JSONResponse(
            {"ok": False, "error": "supplier_id or supplier_email is required"},
            status_code=400,
        )

    async def _rfp_scoped_only():
        # RFP recent route is supplier-id scoped; avoid global fallback when id is absent.
        if not sid:
            return {"items": []}
        return await rfp_recent_route(supplier_id=sid, limit=safe_limit)

    async def _rfp_crm_recent():
        try:
            return {"items": _fetch_recent_brfps_for_supplier_portal(supplier_email=semail, limit=safe_limit, days=30)}
        except Exception:
            return {"items": []}

    tasks = [
        _rfp_scoped_only(),
        _rfp_crm_recent(),
        assessment_recent_route(
            supplier_id=sid or None,
            supplier_email=semail or None,
            limit=safe_limit,
            crm_only=True,
        ),
        assessment_recent_route(
            supplier_id=sid or None,
            supplier_email=semail or None,
            limit=safe_limit,
            crm_only=False,
        ),
    ]
    if bool(include_corpus):
        tasks.append(assessment_corpus_route(supplier_id=sid or None, supplier_name=sname or None))

    results = await asyncio.gather(
        *tasks,
        return_exceptions=True,
    )
    rfp_scoped = results[0] if len(results) > 0 else {}
    rfp_crm = results[1] if len(results) > 1 else {}
    asmt_crm = results[2] if len(results) > 2 else {}
    asmt_scoped = results[3] if len(results) > 3 else {}
    corpus = results[4] if len(results) > 4 else {}

    def _items(res):
        if isinstance(res, Exception):
            return []
        return list((res or {}).get("items") or [])

    corpus_payload = {} if isinstance(corpus, Exception) else (corpus or {})
    return JSONResponse(
        {
            "ok": True,
            "rfps_scoped": _items(rfp_scoped),
            "rfps_crm": _items(rfp_crm),
            "rfps_global": [],
            "assessments_crm": _items(asmt_crm),
            "assessments_scoped": _items(asmt_scoped),
            "assessments_global": [],
            "corpus_health": corpus_payload,
        }
    )

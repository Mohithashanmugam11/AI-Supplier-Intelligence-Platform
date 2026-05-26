"""
TrustBridge â€” Assessment Router
POST /api/assessment/run  â€” full scoring pipeline, returns result directly
Nothing stored. Result goes straight back to the browser.
"""

import asyncio
from collections import Counter, deque
import requests
import os
import re
import hashlib
import json
from datetime import datetime, timezone
import httpx
from urllib.parse import urlencode
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from models import (
    RFPSubmitRequest,
    AssessmentResult,
    ScoredPart,
    MatchedJob,
    Flag,
)

from assessment.state    import get_supplier_data_state
from assessment.scoring  import (
    score_part,
    score_b1,
    score_b2,
    score_c,
    evaluate_feasibility_gate,
    compute_composite,
    compute_overall_score,
    _infer_recommended_processes,
)
from assessment.flags    import generate_flags
from assessment.guidance import generate_guidance
from assessment.reasoning import (
    generate_fit_reasons_bundle,
)

from auth.zoho_auth import get_zoho_token, zoho_headers
from deps import get_historical_projects_index

router = APIRouter()
ASSESSMENT_CACHE: dict[str, dict] = {}
ASSESSMENT_CACHE_MAX = max(100, int(os.getenv("ASSESSMENT_CACHE_MAX", "1000")))
ASSESSMENT_RECENT = deque(maxlen=250)
ZOHO_RECENT_SCOPE_BLOCKED = False
ZOHO_PAST_PROJECTS_MODULE = os.getenv("ZOHO_PAST_PROJECTS_MODULE", "Supplier_Past_Projects")
ZOHO_BRFP_MODULE = os.getenv("ZOHO_BRFP_MODULE", "RFQs")
ZOHO_ASSESSMENT_BID_STATUS_FIELD = os.getenv("ZOHO_ASSESSMENT_BID_STATUS_FIELD", "Bid_Decision")
ZOHO_ASSESSMENT_BID_BOOL_FIELD = os.getenv("ZOHO_ASSESSMENT_BID_BOOL_FIELD", "Is_Bidded")
ZOHO_ASSESSMENT_NOBID_BOOL_FIELD = os.getenv("ZOHO_ASSESSMENT_NOBID_BOOL_FIELD", "No_Bid")
ZOHO_ASSESSMENT_ROUTE_FIELD = os.getenv("ZOHO_ASSESSMENT_ROUTE_FIELD", "No_Bid_Path")
NO_BID_OVERRIDES: set[str] = set()
ASSESSMENT_VERBOSE = os.getenv("ASSESSMENT_VERBOSE_LOGS", "true").strip().lower() in {"1", "true", "yes", "on"}


def _alog(message: str):
    if ASSESSMENT_VERBOSE:
        print(f"[assessment][router] {message}")


def _cache_assessment_payload(key: str, payload: dict):
    k = str(key or "").strip()
    if not k:
        return
    ASSESSMENT_CACHE[k] = payload
    while len(ASSESSMENT_CACHE) > ASSESSMENT_CACHE_MAX:
        oldest_key = next(iter(ASSESSMENT_CACHE))
        ASSESSMENT_CACHE.pop(oldest_key, None)


class NoBidRouteRequest(BaseModel):
    rfp_id: str
    supplier_id: str | None = None
    supplier_name: str | None = None
    path: str = "decline_only"  # decline_only | referral_program | master_rfp_engine
    reason: str | None = ""
    buyer_contact_email: str | None = ""
    note: str | None = ""
    cert_requirements_multi: list[str] | None = None
    certification_preferences: str | None = ""
    geo_constraint_multi: list[str] | None = None
    geo_preference: str | None = ""


class MatchFeedbackRow(BaseModel):
    part_id: str | None = None
    pinecone_vector_id: str
    user_rating: str | None = None
    user_score: float | None = None
    reason: str | None = None
    field_corrections: dict | None = None


class AssessmentFeedbackRequest(BaseModel):
    rfp_id: str
    overall_accuracy: str | None = None
    overall_score: float | None = None
    overall_feedback: str | None = None
    rows: list[MatchFeedbackRow] = []


class AssessmentIntakeUpdateRequest(BaseModel):
    rfp_id: str
    supplier_id: str | None = None
    supplier_email: str | None = None
    buyer: str | None = None
    project: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    company_name: str | None = None
    company_location: str | None = None
    company_size: str | None = None
    customer_account_name: str | None = None
    customer_industry: str | None = None
    project_date: str | None = None
    expected_annual_production_volume: str | None = None
    certs_required: str | None = None
    mandatory_certifications: str | None = None
    certification_notes: str | None = None
    geo_preference: str | None = None
    delivery: str | None = None
    priority_note: str | None = None
    project_description: str | None = None
    other_project_requirements: str | None = None


def _is_truthy(value) -> bool:
    if value is True:
        return True
    if value in (False, None):
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def _normalize_status(raw_status: str | None) -> str:
    status = (raw_status or "").strip().lower().replace("-", "_").replace(" ", "_")
    return status


def _derive_assessment_status(row: dict, zoho_id: str | None = None) -> str:
    if zoho_id and zoho_id in NO_BID_OVERRIDES:
        return "no_bid"
    if _is_truthy(row.get(ZOHO_ASSESSMENT_NOBID_BOOL_FIELD)):
        return "no_bid"
    if row.get(ZOHO_ASSESSMENT_BID_BOOL_FIELD) is False:
        return "no_bid"
    status = _normalize_status(
        row.get(ZOHO_ASSESSMENT_BID_STATUS_FIELD)
        or row.get("Status")
        or row.get("Bid_Status")
        or row.get("Assessment_Status")
    )
    if status in {"no_bid", "nobid", "not_bidded", "declined"}:
        return "no_bid"
    return "scored"


def _assign_candidate_images_to_parts(
    parts: list,
    extracted_images_b64: list[str],
    extracted_image_sources: list[str] | None = None,
) -> list[list[str]]:
    """
    Assign a focused subset of extracted images to each part.
    Primary approach: semantic text->image matching per part.
    Fallback: index-based mapping when embeddings are unavailable.
    Slightly prefers CAD images over document images to avoid wrong picks.
    """
    cleaned_images = [img for img in (extracted_images_b64 or []) if isinstance(img, str) and img.strip()]
    n_parts = len(parts or [])
    if n_parts == 0:
        return []
    if not cleaned_images:
        return [[] for _ in range(n_parts)]

    n_images = len(cleaned_images)
    source_by_idx = []
    for i in range(n_images):
        src = ""
        if extracted_image_sources and i < len(extracted_image_sources):
            src = (extracted_image_sources[i] or "").strip().lower()
        source_by_idx.append(src)

    # Semantic assignment.
    try:
        import base64
        import io
        from PIL import Image
        import numpy as np
        from clip_embedder import compute_clip_embedding_from_pil, compute_clip_text_embedding

        image_vectors: list[np.ndarray | None] = []
        for img_b64 in cleaned_images:
            try:
                raw = base64.b64decode(img_b64)
                pil = Image.open(io.BytesIO(raw)).convert("RGB")
                vec = compute_clip_embedding_from_pil(pil)
                image_vectors.append(np.array(vec, dtype=np.float32) if vec is not None else None)
            except Exception:
                image_vectors.append(None)

        part_vectors: list[np.ndarray | None] = []
        for part in (parts or []):
            text = f"{getattr(part, 'description', '')} {getattr(part, 'material', '')} {getattr(part, 'process', '')} {getattr(part, 'tolerance', '')}".strip()
            vec = compute_clip_text_embedding(text) if text else None
            part_vectors.append(np.array(vec, dtype=np.float32) if vec is not None else None)

        # Score matrix with CAD preference bonus.
        score_rows: list[list[float]] = []
        for p_vec in part_vectors:
            row_scores: list[float] = []
            for idx, i_vec in enumerate(image_vectors):
                if p_vec is None or i_vec is None:
                    row_scores.append(-1.0)
                    continue
                sim = float(np.dot(p_vec, i_vec))
                if source_by_idx[idx] == "cad":
                    sim += 0.02
                row_scores.append(sim)
            score_rows.append(row_scores)

        out_idx: list[list[int]] = [[] for _ in range(n_parts)]

        # Primary one-to-one greedy assignment to reduce cross-part confusion.
        used_images: set[int] = set()
        edges = []
        for pi in range(n_parts):
            for ii in range(n_images):
                s = score_rows[pi][ii] if pi < len(score_rows) else -1.0
                if s > -0.5:
                    edges.append((s, pi, ii))
        edges.sort(reverse=True, key=lambda x: x[0])
        assigned_parts: set[int] = set()
        for s, pi, ii in edges:
            if pi in assigned_parts or ii in used_images:
                continue
            out_idx[pi].append(ii)
            assigned_parts.add(pi)
            used_images.add(ii)
            if len(assigned_parts) >= n_parts:
                break

        # Fill missing primary assignments.
        for pi in range(n_parts):
            if out_idx[pi]:
                continue
            best_ii = 0
            best_s = -1e9
            for ii in range(n_images):
                s = score_rows[pi][ii] if pi < len(score_rows) else -1.0
                if s > best_s:
                    best_s = s
                    best_ii = ii
            out_idx[pi].append(best_ii)

        # Add second-best candidate.
        for pi in range(n_parts):
            primary = out_idx[pi][0]
            second = None
            second_s = -1e9
            for ii in range(n_images):
                if ii == primary:
                    continue
                s = score_rows[pi][ii] if pi < len(score_rows) else -1.0
                if s > second_s:
                    second_s = s
                    second = ii
            if second is not None:
                out_idx[pi].append(second)

        return [[cleaned_images[ii] for ii in bucket[:2]] for bucket in out_idx]
    except Exception:
        pass

    # Fallback: index-based assignment.
    out: list[list[str]] = [[] for _ in range(n_parts)]
    for i in range(n_parts):
        primary_idx = i if n_images == n_parts else int(round((i + 0.5) * n_images / n_parts - 0.5)) if n_images > n_parts else i % n_images
        primary_idx = max(0, min(primary_idx, n_images - 1))
        out[i].append(cleaned_images[primary_idx])
        if n_images > 1:
            neighbor_idx = min(primary_idx + 1, n_images - 1)
            if neighbor_idx == primary_idx:
                neighbor_idx = max(primary_idx - 1, 0)
            if neighbor_idx != primary_idx:
                out[i].append(cleaned_images[neighbor_idx])
    return out


def _candidate_image_indices_for_parts(parts: list, extracted_images_b64: list[str], assigned: list[list[str]]) -> list[list[int]]:
    cleaned_images = [img for img in (extracted_images_b64 or []) if isinstance(img, str) and img.strip()]
    index_map: dict[str, int] = {}
    for idx, img in enumerate(cleaned_images):
        if img not in index_map:
            index_map[img] = idx
    out: list[list[int]] = []
    n_parts = len(parts or [])
    for i in range(n_parts):
        part_assigned = assigned[i] if i < len(assigned) else []
        indices: list[int] = []
        for img in part_assigned:
            idx = index_map.get(img)
            if idx is not None and idx not in indices:
                indices.append(idx)
        out.append(indices)
    return out


def _join_unique(values: list[str]) -> str:
    seen = set()
    out = []
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    return ", ".join(out)


def _safe_lookup(value):
    if not value:
        return None
    return {"id": str(value)}


def _resolve_supplier_contact_lookup_id(
    preferred_email: str | None,
    fallback_email: str | None,
    supplier_account_id: str | None,
) -> str | None:
    """
    Resolve Contact id for Supplier_Contact_Lookup in Zoho.
    Priority:
      1) preferred_email (intake contact email)
      2) fallback_email (supplier login email)
    Scope:
      - Prefer contacts whose Account_Name.id matches supplier_account_id.
    """
    account_id = str(supplier_account_id or "").strip()
    emails = []
    for raw in (preferred_email, fallback_email):
        e = str(raw or "").strip().lower()
        if e and e not in emails:
            emails.append(e)
    if not emails:
        return None

    for email in emails:
        try:
            resp = requests.get(
                "https://www.zohoapis.com/crm/v2/Contacts/search",
                headers=zoho_headers(),
                params={"email": email},
                timeout=10,
            )
            if resp.status_code == 204:
                _alog(f"supplier_contact_lookup miss email={email} status=204")
                continue
            if resp.status_code != 200:
                _alog(f"supplier_contact_lookup non200 email={email} status={resp.status_code}")
                continue
            rows = (resp.json() or {}).get("data", []) or []
            if not rows:
                _alog(f"supplier_contact_lookup empty email={email}")
                continue

            # First pass: account-scoped match.
            if account_id:
                for row in rows:
                    contact_id = str((row or {}).get("id") or "").strip()
                    acct = (row or {}).get("Account_Name")
                    acct_id = str((acct or {}).get("id") if isinstance(acct, dict) else "").strip()
                    if contact_id and acct_id and acct_id == account_id:
                        _alog(
                            f"supplier_contact_lookup hit_scoped email={email} "
                            f"contact_id={contact_id} account_id={acct_id}"
                        )
                        return contact_id

            # Fallback: first contact result.
            first_id = str((rows[0] or {}).get("id") or "").strip()
            if first_id:
                _alog(f"supplier_contact_lookup hit_unscoped email={email} contact_id={first_id}")
                return first_id
        except Exception as e:
            _alog(f"supplier_contact_lookup error email={email} err={e}")
            continue
    return None


def _clean_zoho_payload(value):
    """
    Recursively drop empty fields before sending to Zoho.
    Keeps valid False/0 values.
    """
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            cleaned = _clean_zoho_payload(v)
            if cleaned is None:
                continue
            out[k] = cleaned
        return out if out else None
    if isinstance(value, list):
        out = []
        for item in value:
            cleaned = _clean_zoho_payload(item)
            if cleaned is None:
                continue
            out.append(cleaned)
        return out if out else None
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        return s if s else None
    return value


def _clip_zoho_text(value: str | None, max_len: int) -> str:
    text = str(value or "").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def _safe_zoho_number(value, default: float = 0.0) -> float:
    """
    Zoho numeric subform fields are brittle with null/non-numeric values.
    Always emit a finite float fallback so part rows persist for text-only inputs too.
    """
    try:
        if value is None:
            return float(default)
        n = float(value)
        if n != n:  # NaN guard
            return float(default)
        return n
    except Exception:
        return float(default)


async def _load_base_assessment(rfp_id: str, supplier_id: str | None, supplier_email: str | None) -> AssessmentResult | None:
    payload = ASSESSMENT_CACHE.get(rfp_id)
    if payload:
        try:
            return AssessmentResult.model_validate(payload)
        except Exception:
            pass

    if not rfp_id.startswith("ZOHO-"):
        return None
    try:
        zoho_id = rfp_id.replace("ZOHO-", "", 1)
        row = _fetch_zoho_assessment_row(zoho_id)
        if not row:
            return None
        # Respect supplier scoping by account lookup first.
        if supplier_id:
            row_sid = _pick_lookup_id((row or {}).get("Supplier_Name"))
            if row_sid and str(row_sid) != str(supplier_id):
                return None
        # Email fallback only when supplier account lookup is absent.
        if (not supplier_id) and supplier_email:
            row_email = str((row or {}).get("Email") or "").strip().lower()
            row_secondary = str((row or {}).get("Secondary_Email") or "").strip().lower()
            target_email = str(supplier_email).strip().lower()
            if (row_email or row_secondary) and (row_email != target_email and row_secondary != target_email):
                return None
        return await _build_assessment_result_from_zoho_record(row)
    except Exception:
        return None


async def _score_part_partial(
    part,
    supplier_id: str,
    supplier_name: str | None,
    state,
    mode: str,
    base_part: ScoredPart | None,
    part_image_b64: str | None,
    overall_image_b64: str | None,
    candidate_images_b64: list[str] | None,
    candidate_image_indices: list[int] | None,
    certs_required: list[str] | None = None,
    supplier_certs: list[str] | None = None,
) -> ScoredPart:
    recomputed: list[str] = []
    # Recompute feasibility gate every time because both profiles/history can change it.
    gate = evaluate_feasibility_gate(part, supplier_id, supplier_name)
    gate_status = gate.get("gate_status", "pass")
    gate_reasons = list(gate.get("gate_reasons") or [])
    dependency_tags = list(gate.get("dependency_tags") or [])

    if gate_status == "hard_fail":
        return ScoredPart(
            part_id=part.id,
            description=part.description,
            b1=None,
            b2=None,
            c=None,
            c_text=None,
            c_img=None,
            image_quality=None,
            image_weight=None,
            match_confidence="low",
            match_confidence_score=0.0,
            gate_status=gate_status,
            gate_reasons=gate_reasons,
            dependency_tags=dependency_tags,
            geometry_basis=(base_part.geometry_basis if base_part else None),
            material=part.material or None,
            process=part.process or None,
            tolerance=part.tolerance or None,
            qty=part.qty,
            composite=0.0,
            scoring_mode="partial",
            matched_jobs=[],
            image_candidate_indices=list(candidate_image_indices or []),
        )

    b1 = base_part.b1 if base_part and base_part.b1 is not None else None
    b2 = base_part.b2 if base_part and base_part.b2 is not None else None
    c = base_part.c if base_part and base_part.c is not None else None
    c_text = base_part.c_text if base_part else None
    c_img = base_part.c_img if base_part else None
    image_quality = base_part.image_quality if base_part else None
    image_weight = base_part.image_weight if base_part else None
    match_confidence = base_part.match_confidence if base_part else None
    match_confidence_score = base_part.match_confidence_score if base_part else 0.0
    strongest_positive_driver = base_part.strongest_positive_driver if base_part else None
    main_penalty = base_part.main_penalty if base_part else None
    confidence_reason = base_part.confidence_reason if base_part else None
    matched_jobs = list(base_part.matched_jobs) if base_part else []

    if mode in {"all", "profile"}:
        b1_details: dict = {}
        b1 = await score_b1(part, supplier_id, certs_required=certs_required, supplier_certs=supplier_certs, details_out=b1_details)
        recomputed.append("B1")
    b2_details: dict = {}
    if mode in {"all", "history"}:
        _inferred_procs, _ = await _infer_recommended_processes(part)
        b2 = await score_b2(part, supplier_id, supplier_name, recommended_processes=_inferred_procs, details_out=b2_details)
        recomputed.append("B2")
        c, matched_jobs, c_debug = await score_c(
            part,
            supplier_id,
            supplier_name,
            part_image_b64,
            overall_image_b64,
            candidate_images_b64 or [],
        )
        c_text = c_debug.get("c_text")
        c_img = c_debug.get("c_img")
        image_quality = c_debug.get("image_quality")
        image_weight = c_debug.get("image_weight")
        match_confidence = c_debug.get("match_confidence")
        match_confidence_score = c_debug.get("match_confidence_score")
        strongest_positive_driver = c_debug.get("strongest_positive_driver")
        main_penalty = c_debug.get("main_penalty")
        confidence_reason = c_debug.get("confidence_reason")
        recomputed.append("C")

    # Keep B2 influence in history refresh, but dampen abrupt movement so
    # history-triggered rescoring remains stable and primarily C-driven.
    if mode == "history" and base_part and base_part.b2 is not None and b2 is not None:
        try:
            b2_new_weight = float(os.getenv("HISTORY_RECALC_B2_NEW_WEIGHT", "0.30"))
        except Exception:
            b2_new_weight = 0.30
        b2_new_weight = max(0.0, min(1.0, b2_new_weight))
        b2_old_weight = 1.0 - b2_new_weight
        prev_b2 = float(base_part.b2)
        next_b2 = float(b2)
        blended_b2 = (prev_b2 * b2_old_weight) + (next_b2 * b2_new_weight)
        _alog(
            f"partial_part b2_blend part_id={part.id} prev_b2={round(prev_b2,2)} "
            f"new_b2={round(next_b2,2)} blended_b2={round(blended_b2,2)} "
            f"w_new={round(b2_new_weight,2)}"
        )
        b2 = blended_b2

    # Ensure missing values still get computed if base snapshot lacked them.
    if b2 is None:
        _fb_inferred, _ = await _infer_recommended_processes(part)
        b2 = await score_b2(part, supplier_id, supplier_name, recommended_processes=_fb_inferred, details_out=b2_details)
        if "B2" not in recomputed:
            recomputed.append("B2(fallback)")
    if c is None and mode != "profile":
        c, matched_jobs, c_debug = await score_c(
            part,
            supplier_id,
            supplier_name,
            part_image_b64,
            overall_image_b64,
            candidate_images_b64 or [],
        )
        c_text = c_debug.get("c_text")
        c_img = c_debug.get("c_img")
        image_quality = c_debug.get("image_quality")
        image_weight = c_debug.get("image_weight")
        match_confidence = c_debug.get("match_confidence")
        match_confidence_score = c_debug.get("match_confidence_score")
        strongest_positive_driver = c_debug.get("strongest_positive_driver")
        main_penalty = c_debug.get("main_penalty")
        confidence_reason = c_debug.get("confidence_reason")
        if "C" not in recomputed:
            recomputed.append("C(fallback)")

    # Live history refresh should be reward-consistent for users:
    # adding corpus should not unexpectedly tank C for the same assessed part.
    # Keep full re-runs unchanged; apply only to history-only partial recalc.
    if mode == "history" and base_part and base_part.c is not None and c is not None:
        prev_c = float(base_part.c)
        if c < prev_c:
            _alog(
                f"partial_part c_non_regression part_id={part.id} "
                f"prev_c={prev_c} new_c={c} -> kept_prev"
            )
            c = prev_c

    composite, scoring_mode = compute_composite(
        b1,
        float(b2 or 0.0),
        c,
        state.state,
        match_confidence_score=match_confidence_score,
    )
    _alog(
        f"partial_part part_id={part.id} mode={mode} recomputed={','.join(recomputed) or 'none'} "
        f"gate={gate_status} b1={b1} b2={b2} c={c} composite={composite}"
    )
    _b1_details = locals().get("b1_details", {}) or {}
    _b2_details = b2_details or {}
    return ScoredPart(
        part_id=part.id,
        description=part.description,
        b1=b1,
        b1_profile_processes=_b1_details.get("profile_processes") or (base_part.b1_profile_processes if base_part else []),
        b1_profile_materials=_b1_details.get("profile_materials") or (base_part.b1_profile_materials if base_part else []),
        b1_matched_processes=_b1_details.get("matched_processes") or (base_part.b1_matched_processes if base_part else []),
        b1_required_processes=_b1_details.get("required_processes") or (base_part.b1_required_processes if base_part else []),
        b1_matched_materials=_b1_details.get("matched_materials") or (base_part.b1_matched_materials if base_part else []),
        b1_tolerance_capable=_b1_details.get("tolerance_capable") if _b1_details else (base_part.b1_tolerance_capable if base_part else None),
        b1_missing_certs=_b1_details.get("missing_certs") or (base_part.b1_missing_certs if base_part else []),
        b2=float(b2 or 0.0),
        b2_history_matched_processes=_b2_details.get("history_matched_processes") or (base_part.b2_history_matched_processes if base_part else []),
        b2_history_matched_materials=_b2_details.get("history_matched_materials") or (base_part.b2_history_matched_materials if base_part else []),
        c=c,
        c_text=c_text,
        c_img=c_img,
        image_quality=image_quality,
        image_weight=image_weight,
        match_confidence=match_confidence,
        match_confidence_score=match_confidence_score,
        strongest_positive_driver=strongest_positive_driver,
        main_penalty=main_penalty,
        confidence_reason=confidence_reason,
        gate_status=gate_status,
        gate_reasons=gate_reasons,
        dependency_tags=dependency_tags,
        geometry_basis=(base_part.geometry_basis if base_part else None),
        material=part.material or None,
        process=part.process or None,
        tolerance=part.tolerance or None,
        qty=part.qty,
        composite=composite,
        scoring_mode=scoring_mode,
        matched_jobs=matched_jobs,
        image_candidate_indices=list(candidate_image_indices or []),
    )


@router.post("/run", response_model=AssessmentResult)
async def run_assessment(
    rfp_id: str,
    rfp: RFPSubmitRequest,
    response: Response,
    persist: bool = True,
    recalc_mode: str = "all",
):
    """
    Accepts the full RFP payload directly â€” no database fetch needed.
    Runs the full pipeline and returns the result to the browser.

    Flow:
    1. Check supplier state (A/B/C) via Pinecone
    2. Block if State B
    3. Score all parts concurrently
    4. Rollup overall score
    5. Generate flags (rule-based)
    6. Generate guidance (Gemini)
    7. Return â€” nothing stored
    """

    uploaded_images_b64 = list(getattr(rfp, "uploaded_images_b64", []) or [])
    extracted_images_b64 = list(getattr(rfp, "extracted_images_b64", []) or [])
    extracted_image_sources = list(getattr(rfp, "extracted_image_sources", []) or [])
    overall_image_b64 = getattr(rfp, "overall_image_b64", None)
    normalized_mode = (recalc_mode or "all").strip().lower()
    if normalized_mode not in {"all", "profile", "history", "auto"}:
        normalized_mode = "all"
    if normalized_mode == "auto":
        # Safe default for unknown source event.
        normalized_mode = "all"

    # For partial recalcs (profile or history updates), auto-set persist=False
    # so that the existing Zoho record gets UPDATED (not a new record created)
    if normalized_mode in {"profile", "history"} and str(rfp_id or "").startswith("ZOHO-"):
        persist = False
        _alog(
            f"run persist_override rfp_id={rfp_id} mode={normalized_mode} "
            f"reason=partial_recalc_requires_update"
        )

    part_image_overrides: dict[str, str] = {}
    if normalized_mode in {"history", "all"} and str(rfp_id or "").startswith("ZOHO-"):
        # Recalc reliability: always attempt to hydrate images for Zoho-backed snapshots
        # so C-score has the same visual basis as original assessment whenever possible.
        no_part_images = all(not (getattr(p, "image_b64", None) or "").strip() for p in (rfp.parts or []))
        no_overall = not (overall_image_b64 or "").strip()
        no_extracted = len([img for img in extracted_images_b64 if isinstance(img, str) and img.strip()]) == 0
        zoho_record_id = str(rfp_id).replace("ZOHO-", "", 1)
        hydrated = _fetch_assessment_images_b64_from_zoho(
            zoho_record_id,
            [getattr(p, "id", "") for p in (rfp.parts or [])],
        )
        part_image_overrides = dict(hydrated.get("part_images_b64") or {})
        # Prefer direct payload images; fill gaps from hydrated snapshot.
        if no_overall and hydrated.get("overall_image_b64"):
            overall_image_b64 = hydrated.get("overall_image_b64")
        if no_extracted and hydrated.get("extracted_images_b64"):
            extracted_images_b64 = list(hydrated.get("extracted_images_b64") or [])
            extracted_image_sources = ["zoho_attachment"] * len(extracted_images_b64)
        _alog(
            f"run image_hydration rfp_id={rfp_id} mode={normalized_mode} "
            f"attempted=true no_part={no_part_images} no_overall={no_overall} no_extracted={no_extracted} "
            f"hydrated_part_images={len(part_image_overrides)} "
            f"overall_image={bool((overall_image_b64 or '').strip())} "
            f"extracted_images={len(extracted_images_b64)}"
        )

    _alog(
        f"run start rfp_id={rfp_id} supplier_id={rfp.supplier_id} "
        f"supplier_email={rfp.supplier_email or ''} parts={len(rfp.parts or [])} "
        f"uploaded_images={len(uploaded_images_b64)} extracted_images={len(extracted_images_b64)} "
        f"persist={persist} recalc_mode={recalc_mode}"
    )
    # â”€â”€ State check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    state = await get_supplier_data_state(rfp.supplier_id, rfp.supplier_name)
    _alog(
        f"run state rfp_id={rfp_id} supplier_id={rfp.supplier_id} "
        f"state={state.state} has_profile={state.has_profile} has_history={state.has_history}"
    )

    # â”€â”€ Score all parts concurrently â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if not rfp.parts:
        _alog(f"run abort rfp_id={rfp_id} reason=no_parts")
        raise HTTPException(status_code=400, detail="RFP has no parts to score")

    part_candidate_images = _assign_candidate_images_to_parts(
        rfp.parts,
        extracted_images_b64,
        extracted_image_sources,
    )
    part_candidate_image_indices = _candidate_image_indices_for_parts(
        rfp.parts, extracted_images_b64, part_candidate_images
    )
    _alog(
        f"run image_assignment rfp_id={rfp_id} part_buckets={len(part_candidate_images)} "
        f"non_empty_buckets={sum(1 for b in part_candidate_images if b)}"
    )
    for idx, part in enumerate(rfp.parts or []):
        part_id = getattr(part, "id", f"P-{idx+1:03d}")
        direct_part_image = bool((getattr(part, "image_b64", "") or "").strip())
        hydrated_part_image = bool((part_image_overrides.get(part_id) or "").strip())
        candidate_count = len(part_candidate_images[idx]) if idx < len(part_candidate_images) else 0
        candidate_indices = part_candidate_image_indices[idx] if idx < len(part_candidate_image_indices) else []
        # Fallback basis order: part image -> overall image -> extracted candidate -> text only.
        if direct_part_image or hydrated_part_image:
            image_basis = "part"
        elif bool((overall_image_b64 or "").strip()):
            image_basis = "overall"
        elif candidate_count > 0:
            image_basis = "extracted"
        else:
            image_basis = "text_only"
        _alog(
            f"run part_input part_id={part_id} direct_part_image={direct_part_image} "
            f"hydrated_part_image={hydrated_part_image} "
            f"overall_image={bool((overall_image_b64 or '').strip())} "
            f"candidate_images={candidate_count} candidate_indices={candidate_indices} "
            f"image_basis={image_basis}"
        )

    base_result = None
    base_by_part_id: dict[str, ScoredPart] = {}
    if normalized_mode in {"profile", "history"}:
        base_result = await _load_base_assessment(rfp_id, rfp.supplier_id, rfp.supplier_email)
        if base_result:
            base_by_part_id = {p.part_id: p for p in (base_result.parts or [])}
            _alog(
                f"run partial_base rfp_id={rfp_id} mode={normalized_mode} "
                f"base_parts={len(base_by_part_id)}"
            )
        else:
            _alog(f"run partial_base_missing rfp_id={rfp_id} mode={normalized_mode} -> fallback all")
            normalized_mode = "all"

    try:
        if normalized_mode == "all":
            scored_parts = list(await asyncio.gather(
                *[
                    score_part(
                        part,
                        rfp.supplier_id,
                        rfp.supplier_name,
                        state,
                        part_image_overrides.get(getattr(part, "id", "")) or part.image_b64,
                        overall_image_b64,
                        part_candidate_images[idx] if idx < len(part_candidate_images) else [],
                        part_candidate_image_indices[idx] if idx < len(part_candidate_image_indices) else [],
                        certs_required=list(rfp.certs_required or []),
                        supplier_certs=list(rfp.supplier_certs or []),
                    )
                    for idx, part in enumerate(rfp.parts)
                ]
            ))
        else:
            scored_parts = list(await asyncio.gather(
                *[
                    _score_part_partial(
                        part=part,
                        supplier_id=rfp.supplier_id,
                        supplier_name=rfp.supplier_name,
                        state=state,
                        mode=normalized_mode,
                        base_part=base_by_part_id.get(part.id),
                        part_image_b64=part_image_overrides.get(getattr(part, "id", "")) or part.image_b64,
                        overall_image_b64=overall_image_b64,
                        candidate_images_b64=part_candidate_images[idx] if idx < len(part_candidate_images) else [],
                        candidate_image_indices=part_candidate_image_indices[idx] if idx < len(part_candidate_image_indices) else [],
                        certs_required=list(rfp.certs_required or []),
                        supplier_certs=list(rfp.supplier_certs or []),
                    )
                    for idx, part in enumerate(rfp.parts)
                ]
            ))
    except Exception as e:
        _alog(f"run scoring_error rfp_id={rfp_id} supplier_id={rfp.supplier_id} error={e}")
        raise
    _alog(
        f"run scored rfp_id={rfp_id} scored_parts={len(scored_parts)} "
        f"hard_fail_parts={sum(1 for p in scored_parts if (p.gate_status or '') == 'hard_fail')}"
    )
    _alog(
        f"run mode_summary rfp_id={rfp_id} recalc_mode={normalized_mode} "
        f"parts_with_b1={sum(1 for p in scored_parts if p.b1 is not None)} "
        f"parts_with_b2={sum(1 for p in scored_parts if p.b2 is not None)} "
        f"parts_with_c={sum(1 for p in scored_parts if p.c is not None)}"
    )
    for p in scored_parts:
        _alog(
            f"run part_result part_id={p.part_id} gate={p.gate_status} "
            f"b1={p.b1} b2={p.b2} c={p.c} composite={p.composite} "
            f"c_text={p.c_text} c_img={p.c_img} image_weight={p.image_weight} "
            f"matches={len(p.matched_jobs or [])} "
            f"positive='{(p.strongest_positive_driver or '')[:120]}' "
            f"penalty='{(p.main_penalty or '')[:120]}' "
            f"confidence_reason='{(p.confidence_reason or '')[:120]}'"
        )

    # Ensure matched-job images in fresh run responses are attachment-backed when possible.
    _hydrate_scored_part_match_images(scored_parts)

    # â”€â”€ Overall score â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    overall = compute_overall_score(scored_parts)
    
    # Blend with old overall if partial recalc (profile or history update)
    if normalized_mode in {"profile", "history"} and base_result and base_result.overall_score is not None:
        old_overall = float(base_result.overall_score)
        new_computed = overall
        # Weighted blend: 60% new data, 40% historical baseline
        overall = (0.6 * new_computed) + (0.4 * old_overall)
        _alog(
            f"run overall_blend rfp_id={rfp_id} mode={normalized_mode} "
            f"old_overall={round(old_overall, 2)} new_computed={round(new_computed, 2)} "
            f"blended_overall={round(overall, 2)}"
        )
    else:
        _alog(f"run overall rfp_id={rfp_id} overall={overall}")

    # â”€â”€ Flags â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    flags = await generate_flags(scored_parts, rfp, state)

    # â”€â”€ Guidance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    guidance, fit_bundle = await asyncio.gather(
        generate_guidance(rfp, scored_parts, flags),
        generate_fit_reasons_bundle(rfp, scored_parts, overall),
    )
    fit_reason, requested_fit_reason, manufacturability_fit_reason = fit_bundle
    _alog(f"run guidance rfp_id={rfp_id} guidance_items={len(guidance or [])} flags={len(flags or [])}")

    # â”€â”€ Flatten matched jobs summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    seen     = set()
    all_jobs = []
    for part in scored_parts:
        for job in part.matched_jobs:
            if job.job_id not in seen:
                seen.add(job.job_id)
                all_jobs.append(job)
    all_jobs.sort(key=lambda j: j.similarity, reverse=True)

    result = AssessmentResult(
        rfp_id=rfp_id,
        supplier_id=rfp.supplier_id,
        overall_score=overall,
        scoring_mode=state.state,
        parts=scored_parts,
        flags=flags,
        guidance=guidance,
        fit_reason=fit_reason,
        requested_fit_reason=requested_fit_reason,
        manufacturability_fit_reason=manufacturability_fit_reason,
        buyer=rfp.buyer,
        contact_name=getattr(rfp, "contact_name", None),
        contact_email=getattr(rfp, "contact_email", None),
        contact_phone=getattr(rfp, "contact_phone", None),
        company_name=getattr(rfp, "company_name", None),
        company_location=getattr(rfp, "company_location", None),
        company_size=getattr(rfp, "company_size", None),
        customer_account_name=getattr(rfp, "customer_account_name", None),
        customer_industry=getattr(rfp, "customer_industry", None),
        project_date=getattr(rfp, "project_date", None),
        expected_annual_production_volume=getattr(rfp, "expected_annual_production_volume", None),
        mandatory_certifications=", ".join(getattr(rfp, "mandatory_certifications", []) or []),
        certification_notes=getattr(rfp, "certification_notes", None),
        project_description=getattr(rfp, "project_description", None),
        other_project_requirements=getattr(rfp, "other_project_requirements", None),
        project=rfp.project,
        certs_required=[c for c in (rfp.certs_required or []) if str(c or "").strip()],
        geo_preference=getattr(rfp, "geo_preference", None),
        delivery=rfp.delivery,
        priority_note=rfp.priority_note,
        matched_jobs_summary=all_jobs[:5],
    )
    existing_record_id = ""
    if str(rfp_id or "").startswith("ZOHO-"):
        existing_record_id = str(rfp_id).replace("ZOHO-", "", 1).strip()
    if not existing_record_id:
        existing_record_id = str(getattr(rfp, "assessment_record_id", "") or "").strip()

    final_rfp_id = str(rfp_id or "").strip()
    if persist:
        # Re-assessment/upsert path: if we already know the Zoho row, update it.
        if existing_record_id:
            update_meta = await update_assessment_in_zoho(existing_record_id, rfp, result)
            if update_meta.get("ok"):
                response.headers["X-Zoho-Save"] = "updated"
                response.headers["X-Zoho-Record-Id"] = existing_record_id
                final_rfp_id = f"ZOHO-{existing_record_id}"
                _alog(f"run persist_upsert_ok rfp_id={rfp_id} record_id={existing_record_id}")
            else:
                response.headers["X-Zoho-Save"] = "update_failed"
                if update_meta.get("error"):
                    response.headers["X-Zoho-Error"] = str(update_meta.get("error"))[:180]
                _alog(
                    f"run persist_upsert_failed rfp_id={rfp_id} "
                    f"record_id={existing_record_id} error={update_meta.get('error') or 'unknown'}"
                )
        else:
            save_meta = await save_assessment_to_zoho(rfp, result)
            if save_meta.get("ok"):
                response.headers["X-Zoho-Save"] = "ok"
                if save_meta.get("record_id"):
                    response.headers["X-Zoho-Record-Id"] = str(save_meta.get("record_id"))
                    final_rfp_id = f"ZOHO-{str(save_meta.get('record_id'))}"
                _alog(f"run persist_ok rfp_id={rfp_id} record_id={save_meta.get('record_id') or ''}")
            else:
                response.headers["X-Zoho-Save"] = "failed"
                if save_meta.get("error"):
                    response.headers["X-Zoho-Error"] = str(save_meta.get("error"))[:180]
                _alog(f"run persist_failed rfp_id={rfp_id} error={save_meta.get('error') or 'unknown'}")
    else:
        response.headers["X-Zoho-Save"] = "skipped"
        _alog(f"run persist_skipped rfp_id={rfp_id}")

    # Use canonical Zoho id in response/cache whenever available.
    if final_rfp_id:
        result.rfp_id = final_rfp_id
    final_record_id = ""
    if str(result.rfp_id or "").startswith("ZOHO-"):
        final_record_id = str(result.rfp_id).replace("ZOHO-", "", 1).strip()
    if final_record_id:
        _attach_assessment_part_images_to_result(final_record_id, result.parts or [])

    # Cache result for dashboard "Open Assessment" flow in current runtime session.
    result_payload = result.model_dump()
    _cache_assessment_payload(result.rfp_id, result_payload)
    if str(rfp_id or "").strip() and str(rfp_id).strip() != result.rfp_id:
        # Alias old id -> canonical id during transition.
        _cache_assessment_payload(str(rfp_id).strip(), result_payload)
    ASSESSMENT_RECENT.appendleft({
        "rfp_id": result.rfp_id,
        "buyer": rfp.buyer,
        "project": rfp.project,
        "parts_count": len(rfp.parts or []),
        "overall_score": result.overall_score,
        "scoring_mode": result.scoring_mode,
        "supplier_id": rfp.supplier_id,
        "supplier_email": rfp.supplier_email or "",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "status": "scored",
        "has_cached": True,
    })
    _alog(f"run cache_update rfp_id={result.rfp_id} recent_size={len(ASSESSMENT_RECENT)}")

    _alog(f"run done rfp_id={rfp_id} supplier_id={rfp.supplier_id}")
    return result


def _build_assessment_record_data(
    rfp: RFPSubmitRequest,
    result: AssessmentResult,
    *,
    include_bid_status: bool,
) -> tuple[dict, list[dict]]:
    flags_text = "\n".join(f"[{f.type.upper()}] {f.title}: {f.body}" for f in result.flags)
    normalized_guidance = []
    for raw in (result.guidance or []):
        txt = str(raw or "").strip()
        if not txt:
            continue
        txt = re.sub(r"^\s*(?:\d+[\.\)]|[-*•]+)\s*", "", txt).strip()
        if txt:
            normalized_guidance.append(txt)
    guidance_text = "\n".join(f"{i + 1}. {g}" for i, g in enumerate(normalized_guidance))

    parts_data = []
    for scored_part in result.parts:
        rfp_part = next((p for p in rfp.parts if p.id == scored_part.part_id), None)
        if not rfp_part:
            continue
        matched_job_ids = _encode_match_refs(scored_part.matched_jobs, limit=3)
        b1_profile_payload = {
            "b1_profile_processes": scored_part.b1_profile_processes or [],
            "b1_profile_materials": scored_part.b1_profile_materials or [],
            "b1_matched_processes": scored_part.b1_matched_processes or [],
            "b1_required_processes": scored_part.b1_required_processes or [],
            "b1_matched_materials": scored_part.b1_matched_materials or [],
            "b1_tolerance_capable": scored_part.b1_tolerance_capable,
            "b1_missing_certs": scored_part.b1_missing_certs or [],
        }
        b2_history_payload = {
            "b2_inferred_process": scored_part.b2_inferred_process,
            "b2_process_aligned": scored_part.b2_process_aligned,
            "b2_history_matched_processes": scored_part.b2_history_matched_processes or [],
            "b2_history_matched_materials": scored_part.b2_history_matched_materials or [],
            "b2_base_score": scored_part.b2_base_score,
            "b2_ai_delta": scored_part.b2_ai_delta,
            "b2_infer_source": scored_part.b2_infer_source,
        }
        parts_data.append({
            "Part_Id": _clip_zoho_text(scored_part.part_id, 255),
            "Description": _clip_zoho_text(scored_part.description, 255),
            "Material": _clip_zoho_text(rfp_part.material or "", 255),
            "Process": _clip_zoho_text(rfp_part.process or "", 255),
            "Tolerance": _clip_zoho_text(rfp_part.tolerance or "", 255),
            "Quantity": rfp_part.qty,
            "B1_Score": _safe_zoho_number(scored_part.b1),
            "B2_Score": _safe_zoho_number(scored_part.b2),
            "C_Score": _safe_zoho_number(scored_part.c),
            "Composite_Score": _safe_zoho_number(scored_part.composite),
            "Matched_Job_ID": matched_job_ids,
            "B1_Profile_Processes_JSON": json.dumps(b1_profile_payload, ensure_ascii=False),
            "B2_History_Details_JSON": json.dumps(b2_history_payload, ensure_ascii=False),
        })

    similar_rows = []
    lookup_cache: dict[str, str | None] = {}
    seen_vec_ids = set()
    source_jobs = list(result.matched_jobs_summary or [])
    if not source_jobs:
        for sp in result.parts or []:
            source_jobs.extend(sp.matched_jobs or [])

    for mj in source_jobs[:25]:
        vec_id = (mj.job_id or "").strip()
        if not vec_id or _is_image_filename(vec_id) or vec_id in seen_vec_ids:
            continue
        seen_vec_ids.add(vec_id)
        row = {
            "Pinecone_Vector_ID": vec_id,
            "Fit_Score": f"{float(mj.similarity or 0.0):.1f}",
        }
        lookup_id = _lookup_past_project_record_id(vec_id, lookup_cache)
        if lookup_id:
            row["Past_Project_Lookup"] = {"id": str(lookup_id)}
        similar_rows.append(row)
        if len(similar_rows) >= 10:
            break

    delivery_date = None
    if rfp.delivery:
        match = re.search(r"\d{4}-\d{2}-\d{2}", rfp.delivery)
        if match:
            delivery_date = match.group(0)

    required_certs = [c for c in (rfp.certs_required or []) if str(c or "").strip()]
    mandatory_certs = [c for c in (getattr(rfp, "mandatory_certifications", []) or []) if str(c or "").strip()]
    all_certs = []
    seen_certs = set()
    for cert in required_certs + mandatory_certs:
        c = str(cert).strip()
        if not c:
            continue
        k = c.lower()
        if k in seen_certs:
            continue
        seen_certs.add(k)
        all_certs.append(c)

    project_description = getattr(rfp, "project_description", None) or ""
    other_requirements = getattr(rfp, "other_project_requirements", None) or ""
    if other_requirements:
        project_description = (
            f"{project_description}\n\nOther Project Requirements: {other_requirements}"
            if project_description else
            f"Other Project Requirements: {other_requirements}"
        )

    buyer_name_value = (rfp.buyer or "").strip()
    if not buyer_name_value:
        buyer_name_value = (getattr(rfp, "company_name", None) or "").strip()
    if not buyer_name_value:
        buyer_name_value = (getattr(rfp, "contact_name", None) or "").strip()

    supplier_contact_lookup_id = _resolve_supplier_contact_lookup_id(
        getattr(rfp, "contact_email", None),
        getattr(rfp, "supplier_email", None),
        getattr(rfp, "supplier_id", None),
    )

    record_data = {
        # Keep supplier identity in Email so recent list scoping is stable.
        "Email": (rfp.supplier_email or getattr(rfp, "contact_email", None)),
        # Preserve buyer/supplier contact email separately.
        "Secondary_Email": (getattr(rfp, "contact_email", None) or ""),
        "Supplier_Name": {"id": rfp.supplier_id},
        "Supplier_Contact_Lookup": {"id": supplier_contact_lookup_id} if supplier_contact_lookup_id else None,
        "Project_Name": rfp.project,
        "Required_Certifications": ", ".join(all_certs),
        "Overall_Fit_Score": result.overall_score,
        "Flags": flags_text,
        "Assessment_Date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "Buyer_Name": buyer_name_value,
        "Delivery_Date": delivery_date,
        "Project_Description": project_description,
        "Expected_Annual_Production_Volume": getattr(rfp, "expected_annual_production_volume", None) or "",
        "Company_Name": getattr(rfp, "company_name", None) or "",
        "Company_Location": getattr(rfp, "company_location", None) or "",
        "Company_Size": getattr(rfp, "company_size", None) or "",
        "Contact_No": getattr(rfp, "contact_phone", None) or "",
        "Scoring_Mode": result.scoring_mode,
        "Quoting_Guidance": guidance_text,
        "Requested_Fit_Reasoning": _clip_zoho_text((result.requested_fit_reason or ""), 255),
        "Manufacturability_Fit_Reasoning": _clip_zoho_text((result.manufacturability_fit_reason or ""), 255),
        "Parts_Assessments": parts_data,
        "Similar_Past_Projects": similar_rows,
    }
    if include_bid_status:
        record_data[ZOHO_ASSESSMENT_BID_STATUS_FIELD] = "Open"
    return record_data, similar_rows


async def save_assessment_to_zoho(rfp: RFPSubmitRequest, result: AssessmentResult):
    """
    Save the assessment result to Zoho CRM 'RFP_Assessments' module.
    """
    import base64

    try:
        headers = zoho_headers()

        record_data, similar_rows = _build_assessment_record_data(rfp, result, include_bid_status=True)

        # Create main record (with fallbacks for strict Zoho validation)
        url = "https://www.zohoapis.com/crm/v2/RFP_Assessments"

        async def _post_assessment(payload: dict):
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(url, headers=headers, json={"data": [payload]})
            if r.status_code == 201:
                return True, r, ""
            err = f"{r.status_code}"
            try:
                body = r.json()
                first = (body.get("data") or [{}])[0] if isinstance(body, dict) else {}
                code = first.get("code") or body.get("code")
                msg = first.get("message") or body.get("message")
                details = first.get("details") or {}
                err = f"{r.status_code} {code or ''} {msg or ''} {details}".strip()
            except Exception:
                if r.text:
                    err = f"{r.status_code} {r.text[:240]}"
            return False, r, err

        # Try full payload first.
        ok, resp, err = await _post_assessment(record_data)

        # If lookup in Similar_Past_Projects fails, retry without that lookup.
        if not ok:
            retry_without_lookup = False
            try:
                payload = resp.json()
                for item in payload.get("data", []):
                    details = item.get("details", {}) or {}
                    if (
                        item.get("code") == "INVALID_DATA"
                        and details.get("parent_api_name") == "Similar_Past_Projects"
                        and details.get("api_name") == "Past_Project_Lookup"
                    ):
                        retry_without_lookup = True
                        break
            except Exception:
                pass

            if retry_without_lookup:
                retry_rows = []
                for row in similar_rows:
                    clean_row = dict(row)
                    clean_row.pop("Past_Project_Lookup", None)
                    retry_rows.append(clean_row)
                retry_data = dict(record_data)
                retry_data["Similar_Past_Projects"] = retry_rows
                ok, resp, err = await _post_assessment(retry_data)
                if ok:
                    print(
                        "[assessment] Zoho retry succeeded without Past_Project_Lookup; "
                        f"saved Similar_Past_Projects rows={len(retry_rows)}"
                    )

        # Additional resilient fallbacks so we still persist the assessment.
        if not ok:
            # 1) Remove Supplier_Name lookup (can fail if lookup id is stale/missing access).
            fallback = dict(record_data)
            fallback.pop("Supplier_Name", None)
            ok, resp, err = await _post_assessment(fallback)
            if ok:
                print("[assessment] Zoho fallback succeeded without Supplier_Name lookup")

        if not ok:
            # 2) Remove Similar_Past_Projects subform.
            fallback = dict(record_data)
            fallback.pop("Similar_Past_Projects", None)
            ok, resp, err = await _post_assessment(fallback)
            if ok:
                print("[assessment] Zoho fallback succeeded without Similar_Past_Projects")

        if not ok:
            # 3) Remove Parts_Assessments subform.
            _alog(
                "zoho parts_assessments_rejected_on_create "
                f"error={err} parts_rows={len(record_data.get('Parts_Assessments') or [])}"
            )
            fallback = dict(record_data)
            fallback.pop("Parts_Assessments", None)
            ok, resp, err = await _post_assessment(fallback)
            if ok:
                print("[assessment] Zoho fallback succeeded without Parts_Assessments")

        if not ok:
            # 4) Remove Delivery_Date (format/validation can fail depending on CRM field config).
            fallback = dict(record_data)
            fallback.pop("Delivery_Date", None)
            ok, resp, err = await _post_assessment(fallback)
            if ok:
                print("[assessment] Zoho fallback succeeded without Delivery_Date")

        if not ok:
            print(f"[assessment] Failed to create Zoho record after fallbacks: {err}")
            return {"ok": False, "error": f"create failed: {err}"}
        resp_data = resp.json()
        print(
            f"[assessment] Zoho create accepted. Similar_Past_Projects rows attempted: {len(similar_rows)}"
        )
        record_id = resp_data["data"][0]["details"]["id"]
        print(f"[assessment] Created Zoho record: {record_id}")

        # Upload images as attachments
        attach_url = f"https://www.zohoapis.com/crm/v2/RFP_Assessments/{record_id}/Attachments"
        attach_headers = {"Authorization": headers.get("Authorization", "")}
        overall_image_b64 = getattr(rfp, "overall_image_b64", None)
        extracted_images_b64 = list(getattr(rfp, "extracted_images_b64", []) or [])

        images_to_upload = []
        if overall_image_b64:
            images_to_upload.append(("overall_image.jpg", base64.b64decode(overall_image_b64)))
        for i, img_b64 in enumerate(extracted_images_b64):
            if img_b64:
                images_to_upload.append((f"extracted_image_{i+1}.jpg", base64.b64decode(img_b64)))
        for part in rfp.parts:
            if part.image_b64:
                images_to_upload.append((f"part_{part.id}_image.jpg", base64.b64decode(part.image_b64)))

        async with httpx.AsyncClient(timeout=10.0) as client:
            for filename, file_bytes in images_to_upload:
                files = {"file": (filename, file_bytes, "image/jpeg")}
                attach_resp = await client.post(attach_url, headers=attach_headers, files=files)
                if attach_resp.status_code == 200:
                    print(f"[assessment] Uploaded attachment: {filename}")
                else:
                    print(f"[assessment] Failed to upload {filename}: {attach_resp.status_code}")
        return {"ok": True, "record_id": record_id}

    except Exception as e:
        print(f"[assessment] Error saving to Zoho: {e}")
        # Don't fail the assessment if save fails
        return {"ok": False, "error": str(e)}


async def update_assessment_in_zoho(record_id: str, rfp: RFPSubmitRequest, result: AssessmentResult):
    """
    Update an existing Zoho RFP_Assessments record in place (used for live recalculation).
    """
    try:
        headers = zoho_headers()
        record_data, similar_rows = _build_assessment_record_data(rfp, result, include_bid_status=False)
        url = "https://www.zohoapis.com/crm/v2/RFP_Assessments"

        async def _put_assessment(payload: dict):
            put_payload = dict(payload)
            put_payload["id"] = str(record_id)
            async with httpx.AsyncClient(timeout=12.0) as client:
                r = await client.put(url, headers=headers, json={"data": [put_payload]})
            if r.status_code in (200, 201):
                return True, r, ""
            err = f"{r.status_code}"
            try:
                body = r.json()
                first = (body.get("data") or [{}])[0] if isinstance(body, dict) else {}
                code = first.get("code") or body.get("code")
                msg = first.get("message") or body.get("message")
                details = first.get("details") or {}
                err = f"{r.status_code} {code or ''} {msg or ''} {details}".strip()
            except Exception:
                if r.text:
                    err = f"{r.status_code} {r.text[:240]}"
            return False, r, err

        ok, resp, err = await _put_assessment(record_data)

        if not ok:
            retry_without_lookup = False
            try:
                payload = resp.json()
                for item in payload.get("data", []):
                    details = item.get("details", {}) or {}
                    if (
                        item.get("code") == "INVALID_DATA"
                        and details.get("parent_api_name") == "Similar_Past_Projects"
                        and details.get("api_name") == "Past_Project_Lookup"
                    ):
                        retry_without_lookup = True
                        break
            except Exception:
                pass
            if retry_without_lookup:
                retry_rows = []
                for row in similar_rows:
                    clean_row = dict(row)
                    clean_row.pop("Past_Project_Lookup", None)
                    retry_rows.append(clean_row)
                retry_data = dict(record_data)
                retry_data["Similar_Past_Projects"] = retry_rows
                ok, resp, err = await _put_assessment(retry_data)

        if not ok:
            fallback = dict(record_data)
            fallback.pop("Supplier_Name", None)
            ok, resp, err = await _put_assessment(fallback)
        if not ok:
            fallback = dict(record_data)
            fallback.pop("Similar_Past_Projects", None)
            ok, resp, err = await _put_assessment(fallback)
        if not ok:
            _alog(
                "zoho parts_assessments_rejected_on_update "
                f"record_id={record_id} error={err} "
                f"parts_rows={len(record_data.get('Parts_Assessments') or [])}"
            )
            fallback = dict(record_data)
            fallback.pop("Parts_Assessments", None)
            ok, resp, err = await _put_assessment(fallback)
        if not ok:
            fallback = dict(record_data)
            fallback.pop("Delivery_Date", None)
            ok, resp, err = await _put_assessment(fallback)

        if ok:
            return {"ok": True, "record_id": str(record_id)}
        return {"ok": False, "error": f"update failed: {err}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def _pick_lookup_id(value):
    if isinstance(value, dict):
        return value.get("id")
    if isinstance(value, str):
        return value
    return None


def _fetch_recent_assessments_from_zoho(
    supplier_email: str | None,
    supplier_id: str | None,
    limit: int,
) -> list[dict]:
    global ZOHO_RECENT_SCOPE_BLOCKED
    if ZOHO_RECENT_SCOPE_BLOCKED:
        return []

    safe_limit = max(1, min(limit, 100))
    rows: list[dict] = []

    try:
        # Try search first (fast path for Supplier_Name account lookup).
        if supplier_id:
            resp = requests.get(
                "https://www.zohoapis.com/crm/v2/RFP_Assessments/search",
                headers=zoho_headers(),
                params={
                    "criteria": f"(Supplier_Name:equals:{supplier_id})",
                    "per_page": safe_limit,
                    "page": 1,
                },
                timeout=10,
            )
            if resp.status_code == 200:
                for row in resp.json().get("data", []):
                    zoho_id = str(row.get("id") or "")
                    rows.append({
                        "rfp_id": f"ZOHO-{zoho_id}",
                        "buyer": row.get("Buyer_Name") or "Unknown Buyer",
                        "project": row.get("Project_Name") or "RFP Assessment",
                        "parts_count": len(row.get("Parts_Assessments") or []),
                        "overall_score": row.get("Overall_Fit_Score"),
                        "scoring_mode": row.get("Scoring_Mode"),
                        "supplier_id": _pick_lookup_id(row.get("Supplier_Name")),
                        "supplier_email": row.get("Email") or row.get("Secondary_Email") or "",
                        "created_at": row.get("Created_Time") or row.get("Assessment_Date"),
                        "status": _derive_assessment_status(row, zoho_id),
                        "has_cached": True,
                    })
                return rows[:safe_limit]
            if resp.status_code not in (204, 401):
                print(f"[assessment] Zoho recent search by Supplier_Name failed: {resp.status_code} {resp.text}")

        # Email search fallback only when supplier id is not available.
        if (not supplier_id) and supplier_email:
            resp = requests.get(
                "https://www.zohoapis.com/crm/v2/RFP_Assessments/search",
                headers=zoho_headers(),
                params={
                    "criteria": f"(Email:equals:{supplier_email})",
                    "per_page": safe_limit,
                    "page": 1,
                },
                timeout=10,
            )
            if resp.status_code == 200:
                for row in resp.json().get("data", []):
                    zoho_id = str(row.get("id") or "")
                    rows.append({
                        "rfp_id": f"ZOHO-{zoho_id}",
                        "buyer": row.get("Buyer_Name") or "Unknown Buyer",
                        "project": row.get("Project_Name") or "RFP Assessment",
                        "parts_count": len(row.get("Parts_Assessments") or []),
                        "overall_score": row.get("Overall_Fit_Score"),
                        "scoring_mode": row.get("Scoring_Mode"),
                        "supplier_id": _pick_lookup_id(row.get("Supplier_Name")),
                        "supplier_email": row.get("Email") or row.get("Secondary_Email") or "",
                        "created_at": row.get("Created_Time") or row.get("Assessment_Date"),
                        "status": _derive_assessment_status(row, zoho_id),
                        "has_cached": True,
                    })
                return rows[:safe_limit]
            if resp.status_code not in (204, 401):
                print(f"[assessment] Zoho recent search failed: {resp.status_code} {resp.text}")

        # Fallback: list latest rows and filter in Python by supplier id OR email.
        resp = requests.get(
            "https://www.zohoapis.com/crm/v2/RFP_Assessments",
            headers=zoho_headers(),
            params={"per_page": min(200, safe_limit * 4), "page": 1},
            timeout=10,
        )
        if resp.status_code == 204:
            return []
        if resp.status_code == 401:
            payload = {}
            try:
                payload = resp.json()
            except Exception:
                pass
            if payload.get("code") == "OAUTH_SCOPE_MISMATCH":
                ZOHO_RECENT_SCOPE_BLOCKED = True
                print("[assessment] Zoho recent disabled: OAUTH_SCOPE_MISMATCH on module list endpoint")
                return []
        if resp.status_code != 200:
            print(f"[assessment] Zoho recent list fetch failed: {resp.status_code} {resp.text}")
            return []

        for row in resp.json().get("data", []):
            zoho_id = str(row.get("id") or "")
            row_supplier_id = _pick_lookup_id(row.get("Supplier_Name"))
            row_email = (row.get("Email") or "").lower()
            row_secondary = (row.get("Secondary_Email") or "").lower()
            if supplier_id:
                id_match = bool(row_supplier_id and str(row_supplier_id) == str(supplier_id))
                if not id_match:
                    continue
            elif supplier_email:
                email_match = bool(
                    (row_email and row_email == supplier_email.lower())
                    or (row_secondary and row_secondary == supplier_email.lower())
                )
                if not email_match:
                    continue
            rows.append({
                "rfp_id": f"ZOHO-{zoho_id}",
                "buyer": row.get("Buyer_Name") or "Unknown Buyer",
                "project": row.get("Project_Name") or "RFP Assessment",
                "parts_count": len(row.get("Parts_Assessments") or []),
                "overall_score": row.get("Overall_Fit_Score"),
                "scoring_mode": row.get("Scoring_Mode"),
                "supplier_id": row_supplier_id,
                "supplier_email": row.get("Email") or row.get("Secondary_Email") or "",
                "created_at": row.get("Created_Time") or row.get("Assessment_Date"),
                "status": _derive_assessment_status(row, zoho_id),
                "has_cached": True,
            })

        rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return rows[:safe_limit]
    except Exception as e:
        print(f"[assessment] Zoho recent fetch error: {e}")
        return []


def _safe_float(value, default=0.0):
    try:
        if value is None or value == "":
            return None if default is None else float(default)
        return float(value)
    except Exception:
        return None if default is None else float(default)


def _pick_meta(data: dict, *keys: str):
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return ""


def _meta_to_details(meta: dict) -> dict[str, str]:
    if not isinstance(meta, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in meta.items():
        if v in (None, ""):
            continue
        try:
            if isinstance(v, (dict, list, tuple, set)):
                txt = json.dumps(v, ensure_ascii=False)
            else:
                txt = str(v).strip()
        except Exception:
            continue
        if txt:
            out[str(k)] = txt
    return out


def _served_image_url(raw_image: str) -> str | None:
    image = (raw_image or "").strip()
    if not image:
        return None
    if image.startswith("data:image"):
        return image
    if image.startswith("http://") or image.startswith("https://"):
        return image
    if image.startswith("/images/") or image.startswith("/parts/") or image.startswith("/api/"):
        return image
    # Do not fabricate URLs from bare vector ids / non-image tokens.
    if not _is_image_filename(image):
        return None
    filename = image.replace("\\", "/").split("/")[-1]
    return f"/images/{filename}" if filename else None


def _split_csvish(raw_value) -> list[str]:
    if raw_value is None:
        return []
    if isinstance(raw_value, list):
        out = []
        for item in raw_value:
            out.extend(_split_csvish(item))
        return out
    text = str(raw_value).strip()
    if not text:
        return []
    return [p.strip() for p in text.split(",") if p.strip()]


def _is_image_filename(value: str) -> bool:
    lower = (value or "").lower()
    return lower.endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".avif"))


def _extract_filename_from_disposition(disposition: str | None, fallback: str) -> str:
    text = disposition or ""
    m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^\";]+)"?', text, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return fallback


def _fetch_zoho_assessment_row(zoho_id: str) -> dict | None:
    try:
        resp = requests.get(
            f"https://www.zohoapis.com/crm/v2/RFP_Assessments/{zoho_id}",
            headers=zoho_headers(),
            timeout=12,
        )
        if resp.status_code != 200:
            return None
        rows = resp.json().get("data", [])
        return rows[0] if rows else None
    except Exception:
        return None


def _build_brfp_payload_from_assessment(row: dict, req: NoBidRouteRequest) -> dict:
    parts = row.get("Parts_Assessments") or []
    materials = _join_unique([p.get("Material") for p in parts])
    processes = _join_unique([p.get("Process") for p in parts])
    finishes = _join_unique([p.get("Finish") for p in parts])
    qty_lines = []
    for p in parts:
        pid = p.get("Part_Id") or p.get("Description") or "Part"
        qty = p.get("Quantity")
        if qty not in (None, ""):
            qty_lines.append(f"{pid}: {qty}")
    quantity_text = "\n".join(qty_lines)

    parts_rows = []
    for p in parts[:50]:
        part_id = p.get("Part_Id") or ""
        img_hint = f"part_{part_id}_image.jpg" if part_id else ""
        other_text = p.get("Tolerance") or ""
        if img_hint:
            other_text = (f"{other_text} | " if other_text else "") + f"Image: {img_hint}"
        parts_rows.append({
            "Part_Name": p.get("Description") or part_id or "",
            "Quantity": p.get("Quantity") or None,
            "Material": p.get("Material") or "",
            "Process": p.get("Process") or "",
            "Finish": p.get("Finish") or "",
            "Other": other_text,
        })

    buyer = row.get("Buyer_Name") or "Unknown Buyer"
    project = row.get("Project_Name") or "RFP"
    mapped = {
        "Name": f"{project} | {buyer} | No-bid Route",
        "Client_Company_Name": buyer,
        "Project_Description": project,
        "Customer_Contact_email": (req.buyer_contact_email or "").strip() or (row.get("Email") or ""),
        "Material": materials,
        "Process_Requirements": processes,
        "Finish_Reqirements": finishes,
        "Quantity": quantity_text,
        "Certification_Requests": row.get("Required_Certifications") or "",
        "Cert_Requirements_Multi": list(req.cert_requirements_multi or []),
        "Certification_Preferences": (req.certification_preferences or "").strip(),
        "Geo_Constraint_Multi": list(req.geo_constraint_multi or []),
        "Geographic_Preferences": (req.geo_preference or "").strip(),
        "Other_Requests_or_Requirements": _join_unique([
            "Created from supplier no-bid route",
            req.reason or "",
            req.note or "",
        ]),
        "From_Referral": req.path == "referral_program",
    }

    supplier_lookup = _safe_lookup(req.supplier_id)
    if supplier_lookup:
        # Avoid populating both supplier lookups redundantly.
        if req.path == "referral_program":
            mapped["Referring_Supplier"] = supplier_lookup
        else:
            mapped["Supplier_Account_Lookup"] = supplier_lookup

        # Populate Overall Supplier Matches subform with referring supplier context.
        mapped["Overall_Supplier_Matches"] = [{
            "Account_Lookup": supplier_lookup,
            "Parts_Covered": len(parts),
            "Average_Match_Score": _safe_float(row.get("Overall_Fit_Score"), 0.0),
            "RFQ_Global_Score": _safe_float(row.get("Overall_Fit_Score"), 0.0),
        }]

    if parts_rows:
        mapped["Parts"] = parts_rows
    return _clean_zoho_payload(mapped) or {}


def _create_brfp_record(payload: dict) -> str:
    work = dict(payload or {})
    if not work:
        raise HTTPException(status_code=400, detail="BRFP create skipped: payload is empty after cleaning")
    removed_keys: list[str] = []
    last_error = ""

    for _ in range(6):
        resp = requests.post(
            f"https://www.zohoapis.com/crm/v2/{ZOHO_BRFP_MODULE}",
            headers=zoho_headers(),
            json={"data": [work]},
            timeout=15,
        )
        if resp.status_code == 201:
            data = resp.json().get("data", [])
            if not data:
                raise HTTPException(status_code=400, detail="BRFP create failed: empty response")
            rid = data[0].get("details", {}).get("id")
            if not rid:
                raise HTTPException(status_code=400, detail="BRFP create failed: missing id")
            if removed_keys:
                print(f"[no-bid] BRFP create succeeded after removing fields: {', '.join(removed_keys)}")
            return str(rid)

        last_error = f"{resp.status_code} {resp.text[:300]}"
        payload_json = {}
        try:
            payload_json = resp.json()
        except Exception:
            payload_json = {}

        removed_any = False
        for item in payload_json.get("data", []):
            details = item.get("details", {}) or {}
            api_name = details.get("api_name")
            parent_api = details.get("parent_api_name")
            code = item.get("code")
            if code != "INVALID_DATA":
                continue

            # If a subform row fails, drop the whole subform and continue.
            if parent_api == "Parts" and "Parts" in work:
                work.pop("Parts", None)
                removed_keys.append("Parts")
                removed_any = True
                continue

            # Drop invalid top-level field and retry.
            if api_name and api_name in work:
                work.pop(api_name, None)
                removed_keys.append(str(api_name))
                removed_any = True

        if not removed_any:
            break

    raise HTTPException(
        status_code=400,
        detail=(
            f"BRFP create failed for module '{ZOHO_BRFP_MODULE}' after retries: "
            f"{last_error}. Removed: {', '.join(removed_keys) or 'none'}"
        ),
    )


def _copy_assessment_attachments_to_brfp(zoho_assessment_id: str, brfp_id: str, limit: int = 20) -> int:
    try:
        list_resp = requests.get(
            f"https://www.zohoapis.com/crm/v2/RFP_Assessments/{zoho_assessment_id}/Attachments",
            headers=zoho_headers(),
            timeout=12,
        )
        if list_resp.status_code != 200:
            return 0
        rows = list_resp.json().get("data", [])[:limit]
        copied = 0
        upload_url = f"https://www.zohoapis.com/crm/v2/{ZOHO_BRFP_MODULE}/{brfp_id}/Attachments"
        auth_header = {"Authorization": zoho_headers().get("Authorization", "")}
        for idx, item in enumerate(rows):
            att_id = item.get("id")
            if not att_id:
                continue
            file_resp = requests.get(
                f"https://www.zohoapis.com/crm/v2/RFP_Assessments/{zoho_assessment_id}/Attachments/{att_id}",
                headers=zoho_headers(),
                timeout=20,
            )
            if file_resp.status_code != 200:
                continue
            file_name = _extract_filename_from_disposition(
                file_resp.headers.get("Content-Disposition"),
                f"assessment_attachment_{idx+1}",
            )
            content_type = file_resp.headers.get("Content-Type", "application/octet-stream")
            files = {"file": (file_name, file_resp.content, content_type)}
            up = requests.post(upload_url, headers=auth_header, files=files, timeout=20)
            if up.status_code == 200:
                copied += 1
        return copied
    except Exception:
        return 0


def _update_assessment_no_bid(zoho_id: str, req: NoBidRouteRequest, brfp_id: str | None = None) -> tuple[bool, str]:
    route_value = (
        "Referral_Program" if req.path == "referral_program"
        else "Master_RFP_Engine" if req.path == "master_rfp_engine"
        else "Decline_Only"
    )
    status_value = "No-bid"

    payload = {
        "id": zoho_id,
        ZOHO_ASSESSMENT_NOBID_BOOL_FIELD: True,
        ZOHO_ASSESSMENT_BID_BOOL_FIELD: False,
        ZOHO_ASSESSMENT_BID_STATUS_FIELD: status_value,
        ZOHO_ASSESSMENT_ROUTE_FIELD: route_value,
    }
    if req.reason:
        payload["No_Bid_Reason"] = req.reason
    if brfp_id:
        payload["BRFP_Record"] = {"id": str(brfp_id)}

    work = dict(payload)
    removed_keys: list[str] = []
    last_error = ""
    for _ in range(7):
        try:
            resp = requests.put(
                "https://www.zohoapis.com/crm/v2/RFP_Assessments",
                headers=zoho_headers(),
                json={"data": [work]},
                timeout=12,
            )
        except Exception as e:
            return False, f"exception during assessment update: {e}"

        if resp.status_code in (200, 201):
            NO_BID_OVERRIDES.add(zoho_id)
            if removed_keys:
                print(f"[no-bid] assessment update succeeded after removing fields: {', '.join(removed_keys)}")
            return True, "ok"

        last_error = f"{resp.status_code} {resp.text[:300]}"
        payload_json = {}
        try:
            payload_json = resp.json()
        except Exception:
            payload_json = {}

        removed_any = False
        for item in payload_json.get("data", []):
            if item.get("code") != "INVALID_DATA":
                continue
            details = item.get("details", {}) or {}
            api_name = details.get("api_name")
            if api_name and api_name in work and api_name != "id":
                work.pop(api_name, None)
                removed_keys.append(str(api_name))
                removed_any = True
        if not removed_any:
            break

    # Keep immediate UI behavior in current process, even if CRM field update failed.
    NO_BID_OVERRIDES.add(zoho_id)
    return False, f"assessment update failed: {last_error}; removed={','.join(removed_keys) or 'none'}"


def _pick_vector_ids(matched_jobs: list[MatchedJob], limit: int = 3) -> list[str]:
    picked: list[str] = []
    for job in matched_jobs or []:
        jid = (job.job_id or "").strip()
        if not jid:
            continue
        if _is_image_filename(jid):
            continue
        if jid in picked:
            continue
        picked.append(jid)
        if len(picked) >= limit:
            break
    return picked


def _encode_match_refs(matched_jobs: list[MatchedJob], limit: int = 3) -> str:
    refs: list[str] = []
    seen = set()
    for job in matched_jobs or []:
        jid = (job.job_id or "").strip()
        if not jid or _is_image_filename(jid) or jid in seen:
            continue
        seen.add(jid)
        try:
            sim = float(job.similarity or 0.0)
        except Exception:
            sim = 0.0
        refs.append(f"{jid}::{sim:.1f}")
        if len(refs) >= limit:
            break
    return ",".join(refs)


def _parse_match_token(token: str) -> tuple[str, float | None]:
    t = (token or "").strip()
    if not t:
        return "", None
    if "::" in t:
        jid, sim_raw = t.split("::", 1)
        jid = (jid or "").strip()
        try:
            return jid, float(sim_raw)
        except Exception:
            return jid, None
    return t, None


def _lookup_past_project_record_id(vector_id: str, cache: dict[str, str | None]) -> str | None:
    key = (vector_id or "").strip()
    if not key:
        return None
    if key in cache:
        _alog(f"record_lookup cache_hit vector_id={key} record_id={cache[key] or ''}")
        return cache[key]
    # Try configured module first, then known fallback aliases.
    modules = []
    primary = (ZOHO_PAST_PROJECTS_MODULE or "").strip()
    if primary:
        modules.append(primary)
    for fallback in ("Supplier_Past_Projects", "Past_Projects"):
        if fallback not in modules:
            modules.append(fallback)
    try:
        for module_name in modules:
            _alog(f"record_lookup query module={module_name} vector_id={key}")
            resp = requests.get(
                f"https://www.zohoapis.com/crm/v2/{module_name}/search",
                headers=zoho_headers(),
                params={"criteria": f"(Pinecone_Vector_ID:equals:{key})", "per_page": 1, "page": 1},
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json().get("data", [])
                if data:
                    rec_id = str(data[0].get("id"))
                    cache[key] = rec_id
                    _alog(f"record_lookup hit module={module_name} vector_id={key} record_id={rec_id}")
                    return rec_id
            elif resp.status_code not in (204, 404):
                print(f"[assessment] lookup warning module={module_name} vector={key} status={resp.status_code}")
            else:
                _alog(f"record_lookup miss module={module_name} vector_id={key} status={resp.status_code}")
        cache[key] = None
        _alog(f"record_lookup final_miss vector_id={key}")
        return None
    except Exception as e:
        print(f"[assessment] past project lookup failed for {key}: {e}")
        cache[key] = None
        return None


def _norm_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").strip().lower())


def _fetch_part_image_urls_from_zoho(record_id: str, parts: list[ScoredPart]) -> dict[str, list[dict]]:
    part_map: dict[str, ScoredPart] = {}
    for p in (parts or []):
        pid = str(getattr(p, "part_id", "") or "").strip()
        if pid:
            part_map[pid] = p
    out: dict[str, list[dict]] = {pid: [] for pid in part_map.keys()}
    if not record_id or not out:
        return out
    try:
        resp = requests.get(
            f"https://www.zohoapis.com/crm/v2/RFP_Assessments/{record_id}/Attachments",
            headers=zoho_headers(),
            timeout=10,
        )
        if resp.status_code != 200:
            return out
        rows = resp.json().get("data", []) or []
        part_tokens: dict[str, list[str]] = {}
        for pid, part in part_map.items():
            tokens = []
            pid_norm = _norm_token(pid)
            if pid_norm:
                tokens.append(pid_norm)
            desc_norm = _norm_token(str(getattr(part, "description", "") or ""))
            if desc_norm and desc_norm not in tokens:
                tokens.append(desc_norm)
            # Extra tolerance: split description into significant words.
            for word in re.findall(r"[a-z0-9]+", str(getattr(part, "description", "") or "").lower()):
                if len(word) < 4:
                    continue
                if word not in tokens:
                    tokens.append(word)
            part_tokens[pid] = tokens

        for row in rows:
            att_id = str(row.get("id") or "").strip()
            file_name = (
                row.get("File_Name")
                or row.get("file_name")
                or row.get("$file_name")
                or ""
            ).strip()
            if not att_id or not file_name:
                continue
            lower = file_name.lower()
            if not lower.startswith("part_") or "_image" not in lower:
                continue

            matched_part: str | None = None
            file_norm = _norm_token(file_name)
            for pid, tokens in part_tokens.items():
                if not tokens:
                    continue
                if any(tok and tok in file_norm for tok in tokens):
                    matched_part = pid
                    break

            if not matched_part and len(out) == 1:
                matched_part = next(iter(out.keys()))

            if not matched_part:
                continue

            query = urlencode({"record_id": record_id, "attachment_id": att_id, "module_api": "RFP_Assessments"})
            out[matched_part].append({
                "name": file_name,
                "url": f"/api/assessment/attachment?{query}",
                "record_id": record_id,
                "attachment_id": att_id,
                "attachment_module": "RFP_Assessments",
            })
    except Exception as e:
        print(f"[assessment] attachment fetch failed for record {record_id}: {e}")
    return out


def _attach_assessment_part_images_to_result(record_id: str, parts: list[ScoredPart]) -> None:
    """
    Ensure fresh /run responses include assessment-part images via Zoho attachment proxy URLs.
    This avoids local /parts dependency and makes images visible immediately after run.
    """
    rid = str(record_id or "").strip()
    if not rid or not parts:
        return
    part_attachment_map = _fetch_part_image_urls_from_zoho(rid, parts)
    added = 0
    for part in (parts or []):
        attachments = part_attachment_map.get(part.part_id) or []
        if not attachments:
            continue
        existing_urls = {mj.image_url for mj in (part.matched_jobs or []) if mj.image_url}
        for att in attachments:
            image_url = str(att.get("url") or "").strip()
            if not image_url or image_url in existing_urls:
                continue
            part.matched_jobs.append(
                MatchedJob(
                    job_id=att.get("name") or f"{part.part_id}_image",
                    similarity=0.0,
                    project_name="Part Image",
                    image_url=image_url,
                    record_id=str(att.get("record_id") or rid),
                    attachment_id=str(att.get("attachment_id") or ""),
                    attachment_module=str(att.get("attachment_module") or "RFP_Assessments"),
                )
            )
            existing_urls.add(image_url)
            added += 1
    _alog(f"run part_attachment_merge record_id={rid} added={added}")


def _fetch_supplier_project_attachment_proxy(
    record_id: str,
    cache: dict[str, str | None],
    preferred_token: str = "",
) -> str | None:
    rid = (record_id or "").strip()
    if not rid:
        return None
    token = (preferred_token or "").strip().lower()
    cache_key = f"{rid}::{token}" if token else rid
    if cache_key in cache:
        _alog(
            f"supplier_attachment_proxy cache_hit record_id={rid} token={token} "
            f"proxy={cache[cache_key] or ''}"
        )
        return cache[cache_key]
    modules = []
    primary = (ZOHO_PAST_PROJECTS_MODULE or "").strip()
    if primary:
        modules.append(primary)
    for fallback in ("Supplier_Past_Projects", "Past_Projects"):
        if fallback not in modules:
            modules.append(fallback)
    try:
        for module_name in modules:
            _alog(f"supplier_attachment_proxy list_start module={module_name} record_id={rid}")
            resp = requests.get(
                f"https://www.zohoapis.com/crm/v2/{module_name}/{rid}/Attachments",
                headers=zoho_headers(),
                timeout=10,
            )
            if resp.status_code != 200:
                _alog(f"supplier_attachment_proxy list_non200 module={module_name} record_id={rid} status={resp.status_code}")
                continue
            rows = resp.json().get("data", []) or []
            _alog(f"supplier_attachment_proxy list_ok module={module_name} record_id={rid} attachments={len(rows)}")
            if not rows:
                continue
            preferred = None
            for row in rows:
                fn = str(row.get("File_Name") or row.get("file_name") or row.get("$file_name") or "").lower().strip()
                aid = str(row.get("id") or "").strip()
                if not aid:
                    continue
                if token and fn and token in fn:
                    preferred = aid
                    break
                if fn.endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".avif")):
                    preferred = aid
                    break
                if preferred is None:
                    preferred = aid
            if preferred:
                q = urlencode({"record_id": rid, "attachment_id": preferred, "module_api": module_name})
                proxy = f"/api/assessment/attachment?{q}"
                cache[cache_key] = proxy
                _alog(
                    f"supplier_attachment_proxy selected module={module_name} record_id={rid} "
                    f"attachment_id={preferred} token={token} proxy={proxy}"
                )
                return proxy
        cache[cache_key] = None
        _alog(f"supplier_attachment_proxy no_attachment record_id={rid}")
        return None
    except Exception as e:
        print(f"[assessment] supplier project attachment lookup failed for record {rid}: {e}")
        cache[cache_key] = None
        return None


def _hydrate_scored_part_match_images(parts: list[ScoredPart]) -> None:
    """
    For live /run responses, upgrade matched-job image URLs to Zoho attachment proxy URLs
    whenever the vector -> Supplier_Past_Projects record mapping exists.
    This avoids fragile local /parts paths and ensures the exact CRM attachment is used.
    """
    if not parts:
        return
    vector_lookup_cache: dict[str, str | None] = {}
    attachment_proxy_cache: dict[str, str | None] = {}
    for part in parts:
        upgraded: list[MatchedJob] = []
        for job in (part.matched_jobs or []):
            img = (job.image_url or "").strip()
            lower = img.lower()
            rec_id = (job.record_id or "").strip()
            att_id = (job.attachment_id or "").strip()

            needs_upgrade = (
                (not att_id)
                and (
                    lower.startswith("/parts/")
                    or lower.startswith("/images/")
                    or lower.startswith("/part_")
                    or (img.startswith("part_") and "/" not in img and "." not in img)
                )
            )
            if needs_upgrade:
                rid = rec_id or _lookup_past_project_record_id(job.job_id, vector_lookup_cache)
                if rid:
                    proxy = _fetch_supplier_project_attachment_proxy(
                        rid,
                        attachment_proxy_cache,
                        job.job_id,
                    )
                    if proxy:
                        _alog(
                            f"run_image_hydrate upgraded part={part.part_id} job={job.job_id} "
                            f"record_id={rid} proxy={proxy}"
                        )
                        img = proxy
                        rec_id = rid
                    else:
                        _alog(
                            f"run_image_hydrate proxy_missing part={part.part_id} job={job.job_id} "
                            f"record_id={rid}"
                        )
                else:
                    _alog(f"run_image_hydrate no_record_id part={part.part_id} job={job.job_id}")

            upgraded.append(
                MatchedJob(
                    job_id=job.job_id,
                    similarity=job.similarity,
                    project_id=job.project_id,
                    project_name=job.project_name,
                    part_name=job.part_name,
                    project_link=job.project_link,
                    part_family=job.part_family,
                    material=job.material,
                    process_primary=job.process_primary,
                    customer_industry=job.customer_industry,
                    finish=job.finish,
                    features=job.features,
                    outcome=job.outcome,
                    why_matched=job.why_matched,
                    risk_note=job.risk_note,
                    details=job.details or {},
                    project_date=job.project_date,
                    image_url=img,
                    record_id=rec_id or None,
                    attachment_id=att_id or None,
                    attachment_module=job.attachment_module,
                )
            )
        part.matched_jobs = upgraded


def _fetch_assessment_images_b64_from_zoho(record_id: str, part_ids: list[str]) -> dict:
    """
    Fetch attachment binaries from Zoho assessment record and return base64 payloads
    for history recalculation:
      - part_<part_id>_image.*
      - overall_image.*
      - extracted_image_<n>.*
    """
    out = {
        "part_images_b64": {},
        "overall_image_b64": None,
        "extracted_images_b64": [],
    }
    if not record_id:
        return out
    try:
        list_resp = requests.get(
            f"https://www.zohoapis.com/crm/v2/RFP_Assessments/{record_id}/Attachments",
            headers=zoho_headers(),
            timeout=12,
        )
        if list_resp.status_code != 200:
            return out

        rows = list_resp.json().get("data", []) or []
        _alog(
            f"image_hydration list record_id={record_id} attachments_total={len(rows)} "
            f"parts_requested={len(part_ids or [])}"
        )
        part_ids_lower = {str(pid).lower(): str(pid) for pid in (part_ids or []) if pid}

        part_hits: list[tuple[str, str, str]] = []  # (part_id, attachment_id, file_name)
        overall_hit: tuple[str, str] | None = None  # (attachment_id, file_name)
        extracted_hits: list[tuple[int, str, str]] = []  # (index, attachment_id, file_name)

        for row in rows:
            att_id = str(row.get("id") or "").strip()
            file_name = (
                row.get("File_Name")
                or row.get("file_name")
                or row.get("$file_name")
                or ""
            ).strip()
            if not att_id or not file_name:
                continue
            lower = file_name.lower()

            if lower.startswith("overall_image"):
                overall_hit = (att_id, file_name)
                continue

            if lower.startswith("extracted_image_"):
                m = re.search(r"extracted_image_(\d+)", lower)
                idx = int(m.group(1)) if m else 9999
                extracted_hits.append((idx, att_id, file_name))
                continue

            if lower.startswith("part_") and "_image" in lower and part_ids_lower:
                matched_part: str | None = None
                for pid_lower, original in part_ids_lower.items():
                    if f"part_{pid_lower}_image" in lower:
                        matched_part = original
                        break
                if not matched_part and len(part_ids_lower) == 1:
                    matched_part = next(iter(part_ids_lower.values()))
                if matched_part:
                    part_hits.append((matched_part, att_id, file_name))

        def _download_b64(attachment_id: str) -> str | None:
            try:
                import base64
                file_resp = requests.get(
                    f"https://www.zohoapis.com/crm/v2/RFP_Assessments/{record_id}/Attachments/{attachment_id}",
                    headers=zoho_headers(),
                    timeout=20,
                )
                if file_resp.status_code != 200 or not file_resp.content:
                    return None
                return base64.b64encode(file_resp.content).decode("utf-8")
            except Exception:
                return None

        for part_id, att_id, _name in part_hits:
            b64 = _download_b64(att_id)
            if b64:
                out["part_images_b64"][part_id] = b64

        if overall_hit:
            b64 = _download_b64(overall_hit[0])
            if b64:
                out["overall_image_b64"] = b64

        extracted_hits.sort(key=lambda x: x[0])
        for _idx, att_id, _name in extracted_hits:
            b64 = _download_b64(att_id)
            if b64:
                out["extracted_images_b64"].append(b64)
        _alog(
            f"image_hydration done record_id={record_id} "
            f"part_images={len(out['part_images_b64'])} "
            f"overall_image={bool(out['overall_image_b64'])} "
            f"extracted_images={len(out['extracted_images_b64'])}"
        )

    except Exception as e:
        print(f"[assessment] image hydration fetch failed for record {record_id}: {e}")
    return out


def _batch_fetch_past_project_names(record_ids: list[str]) -> dict[str, str]:
    """Fetch Zoho 'Name' field from Supplier_Past_Projects for a set of record IDs.
    Returns {record_id: project_name}. Used as fallback when Pinecone lacks project_name."""
    ids = [str(r).strip() for r in (record_ids or []) if str(r or "").strip()]
    if not ids:
        return {}
    module = (ZOHO_PAST_PROJECTS_MODULE or "Supplier_Past_Projects").strip()
    out: dict[str, str] = {}
    try:
        resp = requests.get(
            f"https://www.zohoapis.com/crm/v2/{module}",
            headers=zoho_headers(),
            params={"ids": ",".join(ids[:100])},
            timeout=10,
        )
        if resp.status_code == 200:
            for row in (resp.json().get("data") or []):
                rid = str(row.get("id") or "").strip()
                name = str(row.get("Name") or "").strip()
                if rid and name:
                    out[rid] = name
    except Exception as e:
        print(f"[assessment] past_project_names fetch failed: {e}")
    return out


def _enrich_jobs_from_pinecone(job_ids: list[str]) -> dict[str, dict]:
    if not job_ids:
        return {}

    try:
        index = get_historical_projects_index()
        fetched = index.fetch(ids=job_ids)
        vectors = fetched.vectors or {}
    except Exception as e:
        print(f"[assessment] Pinecone enrich failed: {e}")
        return {}

    enriched: dict[str, dict] = {}
    for job_id, vec in vectors.items():
        meta = vec.metadata or {}
        enriched[job_id] = {
            "project_name": _pick_meta(meta, "Project_Name", "project_name", "project"),
            "part_name": _pick_meta(meta, "part_name", "Part_Name"),
            "part_family": _pick_meta(meta, "Part_Family", "part_family", "part_type"),
            "material": _pick_meta(meta, "Material", "material", "Material_Primary", "material_primary", "raw_material"),
            "process_primary": _pick_meta(
                meta,
                "Process_Primary",
                "process_primary",
                "Process",
                "process",
                "Process_Secondary",
                "process_secondary",
            ),
            "customer_industry": _pick_meta(meta, "Customer_Industry", "customer_industry"),
            "finish": _pick_meta(meta, "Finish", "finish", "Surface_Finish", "surface_finish", "finish_type"),
            "features": _pick_meta(meta, "Features", "features"),
            "outcome": _pick_meta(meta, "Outcome", "outcome"),
            "project_date": _pick_meta(meta, "Project_Date", "project_date"),
            "project_link": _pick_meta(
                meta,
                "project_link",
                "project_url",
                "source_url",
                "share_url",
                "record_url",
                "zoho_record_url",
                "project_detail_url",
            ),
            "image_url": _served_image_url(_pick_meta(meta, "image_url", "image_path")),
            "record_id": _pick_meta(meta, "source_record_id", "record_id", "zoho_record_id"),
            "attachment_id": _pick_meta(meta, "attachment_id", "image_attachment_id"),
            "attachment_module": _pick_meta(meta, "attachment_module", "module_api"),
            "details": _meta_to_details(meta),
        }
    return enriched


def _parse_flags(flags_text: str | None) -> list[Flag]:
    if not flags_text:
        return []
    parsed: list[Flag] = []
    for raw_line in flags_text.splitlines():
        line = (raw_line or "").strip()
        if not line:
            continue
        if line.startswith("[PASS]"):
            text = line[len("[PASS]"):].strip()
            title, _, body = text.partition(":")
            parsed.append(Flag(type="pass", title=(title or "Pass").strip(), body=(body or title or "").strip()))
        elif line.startswith("[WARN]"):
            text = line[len("[WARN]"):].strip()
            title, _, body = text.partition(":")
            parsed.append(Flag(type="warn", title=(title or "Warning").strip(), body=(body or title or "").strip()))
    return parsed


def _parse_guidance(guidance_text: str | None) -> list[str]:
    if not guidance_text:
        return []
    lines = []
    for raw in guidance_text.splitlines():
        line = raw.strip()
        if not line:
            continue
        line = line.lstrip("•").strip()
        if line:
            lines.append(line)
    return lines


def _split_process_tokens(value: str | None) -> list[str]:
    text = (value or "").strip()
    if not text:
        return []
    tokens = re.split(r"[+,/·]| and ", text, flags=re.IGNORECASE)
    out: list[str] = []
    seen = set()
    for token in tokens:
        clean = token.strip()
        if not clean:
            continue
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(clean)
    return out


def _canonical_process_display(value: str) -> str:
    key = (value or "").strip().lower()
    pretty = {
        "cnc milling": "CNC Milling",
        "cnc turning": "CNC Turning",
        "edm wire": "EDM Wire",
        "sheet metal": "Sheet Metal",
        "3d printing": "3D Printing",
        "metal additive manufacturing": "Metal Additive Manufacturing",
        "gear hobbing": "Gear Hobbing",
    }
    if key in pretty:
        return pretty[key]
    if not key:
        return "Unknown"
    return " ".join([w.upper() if len(w) <= 3 else w.capitalize() for w in key.split()])


def _build_supplier_corpus_health(supplier_id: str | None, supplier_name: str | None) -> dict:
    if not supplier_id:
        return {"score": 0, "processes": [], "total_jobs": 0, "top_gap": ""}
    try:
        # Reuse existing supplier-history fetch logic used in scoring.
        from assessment.scoring import _fetch_supplier_history_rows, _fetch_supplier_profile_rows, _normalize_process  # type: ignore

        rows = _fetch_supplier_history_rows(supplier_id, supplier_name)
        profile_rows = _fetch_supplier_profile_rows(supplier_id)
        process_counts: Counter[str] = Counter()
        lesson_signal_count = 0
        for row in rows:
            process_raw = _pick_meta(row, "Process_Primary", "process_primary", "process")
            for token in _split_process_tokens(process_raw):
                norm = _normalize_process(token)
                if norm:
                    process_counts[norm] += 1
            lesson_blob = str(
                _pick_meta(
                    row,
                    "What_Worked",
                    "what_worked",
                    "NCR_Description",
                    "ncr_description",
                    "Quoting_Lesson",
                    "quoting_lesson",
                )
                or ""
            ).strip()
            if lesson_blob:
                lesson_signal_count += 1

        # Profile-only suppliers should still get non-zero coverage visibility.
        # If history has no process rows, seed counts from process-profile metadata.
        if not process_counts:
            for row in profile_rows:
                process_raw = _pick_meta(
                    row,
                    "Process_Primary",
                    "process_primary",
                    "process",
                    "generic_process",
                    "branded_process",
                    "process_family",
                )
                for token in _split_process_tokens(process_raw):
                    norm = _normalize_process(token)
                    if norm:
                        process_counts[norm] += 1

        if not process_counts:
            return {"score": 0, "processes": [], "total_jobs": len(rows), "top_gap": "", "total_profiles": len(profile_rows)}

        top = process_counts.most_common(6)
        total_count = sum(process_counts.values()) or 1
        process_rows = [
            {
                "label": _canonical_process_display(label),
                "count": count,
                "pct": round((count / total_count) * 100, 1),
            }
            for label, count in top
        ]

        # More realistic score proxy from breadth + volume + balance + profile depth.
        total_jobs = len(rows)
        total_profiles = len(profile_rows)
        distinct = len(process_counts)
        dominant_share = (top[0][1] / total_count) if top else 1.0
        breadth_score = min(distinct / 10.0, 1.0) * 25.0
        volume_jobs_score = min(total_jobs / 80.0, 1.0) * 40.0
        profile_depth_score = min(total_profiles / 40.0, 1.0) * 20.0
        balance_score = max(0.0, (1.0 - dominant_share)) * 15.0
        raw_score = breadth_score + volume_jobs_score + profile_depth_score + balance_score
        score_100 = int(round(min(95.0, max(8.0, raw_score))))

        weakest = min(process_rows, key=lambda p: p["pct"]) if process_rows else None
        top_gap = weakest["label"] if weakest else ""
        corpus_signature = hashlib.sha1(
            json.dumps(
                {
                    "supplier_id": supplier_id,
                    "total_jobs": total_jobs,
                    "total_profiles": total_profiles,
                    "lesson_signal_count": int(lesson_signal_count),
                    "process_counts": sorted(process_counts.items()),
                },
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()
        return {
            "score": score_100,
            "processes": process_rows,
            "total_jobs": total_jobs,
            "total_profiles": len(profile_rows),
            "total_lessons": int(lesson_signal_count),
            "lessons_linked": int(lesson_signal_count),
            "corpus_signature": corpus_signature,
            "top_gap": top_gap,
        }
    except Exception as e:
        print(f"[assessment] corpus health build failed: {e}")
        return {"score": 0, "processes": [], "total_jobs": 0, "top_gap": ""}


async def _build_assessment_result_from_zoho_record(row: dict) -> AssessmentResult:
    supplier_id = _pick_lookup_id(row.get("Supplier_Name")) or "unknown"
    supplier_name = ""
    if isinstance(row.get("Supplier_Name"), dict):
        supplier_name = row.get("Supplier_Name", {}).get("name") or ""
    rfp_id = f"ZOHO-{row.get('id')}"
    parts_raw = row.get("Parts_Assessments") or []

    parts: list[ScoredPart] = []
    similar_rows = row.get("Similar_Past_Projects") or []
    similar_jobs: list[MatchedJob] = []
    all_job_ids: list[str] = []
    for p in parts_raw:
        b1_blob = p.get("B1_Profile_Processes_JSON")
        b2_blob = p.get("B2_History_Details_JSON")
        try:
            b1_details = json.loads(b1_blob) if isinstance(b1_blob, str) and b1_blob.strip() else {}
        except Exception:
            b1_details = {}
        try:
            b2_details = json.loads(b2_blob) if isinstance(b2_blob, str) and b2_blob.strip() else {}
        except Exception:
            b2_details = {}
        matched_jobs = []
        seen_tokens = set()
        for token in _split_csvish(p.get("Matched_Job_ID")):
            clean, sim = _parse_match_token(token)
            if not clean or clean in seen_tokens:
                continue
            seen_tokens.add(clean)
            if _is_image_filename(clean):
                image_url = _served_image_url(clean)
                matched_jobs.append(MatchedJob(
                    job_id=clean,
                    similarity=sim or 0.0,
                    project_name="Part Image",
                    image_url=image_url,
                ))
                # Still try Pinecone enrichment for image-like IDs; many corpora use image/file ids.
                all_job_ids.append(clean)
                continue
            matched_jobs.append(MatchedJob(job_id=clean, similarity=sim or 0.0))
            all_job_ids.append(clean)

        for token in _split_csvish(p.get("Part_Image")):
            clean, _ = _parse_match_token(token)
            if not clean or clean in seen_tokens:
                continue
            seen_tokens.add(clean)
            if not _is_image_filename(clean):
                continue
            image_url = _served_image_url(clean)
            matched_jobs.append(MatchedJob(
                job_id=clean,
                similarity=0.0,
                project_name="Part Image",
                image_url=image_url,
            ))
        parts.append(
            ScoredPart(
                part_id=p.get("Part_Id") or f"PART-{len(parts)+1}",
                description=p.get("Description") or "Part",
                b1=_safe_float(p.get("B1_Score"), default=0.0),
                b1_profile_processes=b1_details.get("b1_profile_processes") or [],
                b1_profile_materials=b1_details.get("b1_profile_materials") or [],
                b1_matched_processes=b1_details.get("b1_matched_processes") or [],
                b1_required_processes=b1_details.get("b1_required_processes") or [],
                b1_matched_materials=b1_details.get("b1_matched_materials") or [],
                b1_tolerance_capable=b1_details.get("b1_tolerance_capable"),
                b1_missing_certs=b1_details.get("b1_missing_certs") or [],
                b2=_safe_float(p.get("B2_Score"), default=0.0),
                b2_base_score=_safe_float(b2_details.get("b2_base_score"), default=None),
                b2_ai_delta=_safe_float(b2_details.get("b2_ai_delta"), default=None),
                b2_infer_source=(b2_details.get("b2_infer_source") or None),
                b2_inferred_process=(b2_details.get("b2_inferred_process") or None),
                b2_process_aligned=b2_details.get("b2_process_aligned"),
                b2_history_matched_processes=b2_details.get("b2_history_matched_processes") or [],
                b2_history_matched_materials=b2_details.get("b2_history_matched_materials") or [],
                c=_safe_float(p.get("C_Score"), default=0.0),
                material=(p.get("Material") or "").strip() or None,
                process=(p.get("Process") or "").strip() or None,
                tolerance=(p.get("Tolerance") or "").strip() or None,
                qty=p.get("Quantity") or None,
                composite=_safe_float(p.get("Composite_Score"), default=0.0),
                scoring_mode="full",
                matched_jobs=matched_jobs,
            )
        )

    for s in similar_rows:
        vid = (s.get("Pinecone_Vector_ID") or "").strip()
        if not vid:
            continue
        if _is_image_filename(vid):
            continue
        fit_score = _safe_float(s.get("Fit_Score"), default=0.0)
        similar_jobs.append(MatchedJob(job_id=vid, similarity=fit_score))
        all_job_ids.append(vid)

    # Attach part images from Zoho attachments for snapshot overview.
    record_id = str(row.get("id") or "").strip()
    if parts and record_id:
        part_attachment_map = _fetch_part_image_urls_from_zoho(record_id, parts)
        for part in parts:
            attachments = part_attachment_map.get(part.part_id) or []
            if not attachments:
                continue
            existing_urls = {mj.image_url for mj in part.matched_jobs if mj.image_url}
            for att in attachments:
                image_url = att.get("url")
                if not image_url or image_url in existing_urls:
                    continue
                part.matched_jobs.append(
                    MatchedJob(
                        job_id=att.get("name") or f"{part.part_id}_image",
                        similarity=0.0,
                        project_name="Part Image",
                        image_url=image_url,
                        record_id=str(att.get("record_id") or record_id),
                        attachment_id=str(att.get("attachment_id") or ""),
                        attachment_module=str(att.get("attachment_module") or "RFP_Assessments"),
                    )
                )
                existing_urls.add(image_url)

    if not parts:
        parts = [
            ScoredPart(
                part_id="PART-001",
                description=row.get("Project_Name") or "RFP Part",
                b1=0.0,
                b2=0.0,
                c=0.0,
                composite=_safe_float(row.get("Overall_Fit_Score"), default=0.0),
                scoring_mode="partial",
                matched_jobs=[],
            )
        ]

    enrichment = _enrich_jobs_from_pinecone(list(dict.fromkeys(all_job_ids)))

    # Fallback: for jobs where Pinecone has no project_name yet, fetch the Zoho
    # Supplier_Past_Projects "Name" field using the record_id from Pinecone metadata.
    missing_name_record_ids = list({
        meta.get("record_id")
        for meta in enrichment.values()
        if not meta.get("project_name") and meta.get("record_id")
    })
    zoho_project_names = _batch_fetch_past_project_names(missing_name_record_ids)
    for meta in enrichment.values():
        if not meta.get("project_name") and meta.get("record_id"):
            fetched = zoho_project_names.get(meta["record_id"])
            if fetched:
                meta["project_name"] = fetched

    vector_lookup_cache: dict[str, str | None] = {}
    attachment_proxy_cache: dict[str, str | None] = {}
    for part in parts:
        merged = []
        for job in part.matched_jobs:
            meta = enrichment.get(job.job_id, {})
            merged_image_url = meta.get("image_url") or job.image_url
            merged_record_id = meta.get("record_id") or job.record_id
            merged_attachment_id = meta.get("attachment_id") or job.attachment_id
            merged_attachment_module = meta.get("attachment_module") or job.attachment_module
            lower_img = (merged_image_url or "").lower()
            _alog(
                f"image_merge part={part.part_id} job={job.job_id} "
                f"meta_record={meta.get('record_id') or ''} base_record={job.record_id or ''} "
                f"attachment_id={merged_attachment_id or ''} image_url={(merged_image_url or '')[:120]}"
            )
            if (not merged_attachment_id) and (lower_img.startswith("/parts/") or lower_img.startswith("/images/")):
                rec_id = merged_record_id or _lookup_past_project_record_id(job.job_id, vector_lookup_cache)
                if rec_id:
                    proxy = _fetch_supplier_project_attachment_proxy(rec_id, attachment_proxy_cache, job.job_id)
                    if proxy:
                        merged_image_url = proxy
                        merged_record_id = rec_id
                        merged_attachment_module = merged_attachment_module or "Supplier_Past_Projects"
                        _alog(
                            f"image_merge upgraded_to_proxy part={part.part_id} job={job.job_id} "
                            f"record_id={rec_id} proxy={proxy}"
                        )
                    else:
                        _alog(
                            f"image_merge proxy_missing part={part.part_id} job={job.job_id} "
                            f"record_id={rec_id}"
                        )
                else:
                    _alog(f"image_merge no_record_id part={part.part_id} job={job.job_id}")
            merged.append(
                MatchedJob(
                    job_id=job.job_id,
                    similarity=job.similarity,
                    project_name=meta.get("project_name") or job.project_name,
                    part_name=meta.get("part_name") or job.part_name,
                    project_link=meta.get("project_link") or job.project_link,
                    part_family=meta.get("part_family") or job.part_family,
                    material=meta.get("material") or job.material,
                    process_primary=meta.get("process_primary") or job.process_primary,
                    customer_industry=meta.get("customer_industry") or job.customer_industry,
                    finish=meta.get("finish") or job.finish,
                    features=meta.get("features") or job.features,
                    outcome=meta.get("outcome") or job.outcome,
                    why_matched=job.why_matched,
                    risk_note=job.risk_note,
                    details=(meta.get("details") or job.details or {}),
                    project_date=meta.get("project_date") or job.project_date,
                    image_url=merged_image_url,
                    record_id=merged_record_id,
                    attachment_id=merged_attachment_id,
                    attachment_module=merged_attachment_module,
                )
            )
        part.matched_jobs = merged
        try:
            for j in part.matched_jobs[:5]:
                src = "none"
                if j.attachment_id and j.record_id:
                    src = "zoho_attachment"
                elif (j.image_url or "").startswith("/parts/"):
                    src = "parts_static"
                elif (j.image_url or "").startswith("/images/"):
                    src = "images_static"
                elif (j.image_url or "").startswith("http"):
                    src = "absolute_url"
                _alog(
                    f"image_trace part={part.part_id} job={j.job_id} src={src} "
                    f"record_id={j.record_id or ''} attachment_id={j.attachment_id or ''} "
                    f"image_url={(j.image_url or '')[:120]}"
                )
        except Exception:
            pass

    # IMPORTANT: For historical Zoho records opened from dashboard, return a pure snapshot.
    # Do not re-run scoring/rehydration here; UI should reflect saved CRM data only.

    matched_summary = []
    seen_jobs = set()
    for part in parts:
        for job in part.matched_jobs:
            # Keep image-file placeholders out of history summary cards.
            # They are still available at part-level for thumbnail rendering.
            has_meaningful_meta = any([
                (job.project_name or "").strip().lower() not in {"", "part image"},
                bool(job.project_link),
                bool(job.material),
                bool(job.process_primary),
                bool(job.part_family),
                bool(job.customer_industry),
                bool(job.features),
                bool(job.outcome),
            ])
            if job.image_url and _is_image_filename(job.job_id or "") and not has_meaningful_meta:
                continue
            if job.job_id in seen_jobs:
                continue
            seen_jobs.add(job.job_id)
            matched_summary.append(job)

    for job in similar_jobs:
        if job.job_id in seen_jobs:
            continue
        seen_jobs.add(job.job_id)
        meta = enrichment.get(job.job_id, {})
        merged_image_url = meta.get("image_url") or job.image_url
        merged_record_id = meta.get("record_id") or job.record_id
        merged_attachment_id = meta.get("attachment_id") or job.attachment_id
        merged_attachment_module = meta.get("attachment_module") or job.attachment_module
        lower_img = (merged_image_url or "").lower()
        if (not merged_attachment_id) and (lower_img.startswith("/parts/") or lower_img.startswith("/images/")):
            rec_id = merged_record_id or _lookup_past_project_record_id(job.job_id, vector_lookup_cache)
            if rec_id:
                proxy = _fetch_supplier_project_attachment_proxy(rec_id, attachment_proxy_cache, job.job_id)
                if proxy:
                    merged_image_url = proxy
                    merged_record_id = rec_id
                    merged_attachment_module = merged_attachment_module or "Supplier_Past_Projects"
                    _alog(
                        f"summary_image upgraded_to_proxy job={job.job_id} "
                        f"record_id={rec_id} proxy={proxy}"
                    )
                else:
                    _alog(f"summary_image proxy_missing job={job.job_id} record_id={rec_id}")
            else:
                _alog(f"summary_image no_record_id job={job.job_id}")
        matched_summary.append(
            MatchedJob(
                job_id=job.job_id,
                similarity=job.similarity,
                project_name=meta.get("project_name") or job.project_name,
                project_link=meta.get("project_link") or job.project_link,
                part_family=meta.get("part_family") or job.part_family,
                material=meta.get("material") or job.material,
                process_primary=meta.get("process_primary") or job.process_primary,
                customer_industry=meta.get("customer_industry") or job.customer_industry,
                finish=meta.get("finish") or job.finish,
                features=meta.get("features") or job.features,
                outcome=meta.get("outcome") or job.outcome,
                why_matched=job.why_matched,
                risk_note=job.risk_note,
                details=(meta.get("details") or job.details or {}),
                project_date=meta.get("project_date") or job.project_date,
                image_url=merged_image_url,
                record_id=merged_record_id,
                attachment_id=merged_attachment_id,
                attachment_module=merged_attachment_module,
            )
        )

    mode = row.get("Scoring_Mode")
    scoring_mode = mode if mode in {"A", "B", "C"} else "C"

    return AssessmentResult(
        rfp_id=rfp_id,
        supplier_id=str(supplier_id),
        overall_score=_safe_float(row.get("Overall_Fit_Score"), default=0.0),
        scoring_mode=scoring_mode,
        parts=parts,
        flags=_parse_flags(row.get("Flags")),
        guidance=_parse_guidance(row.get("Quoting_Guidance")),
        requested_fit_reason=(row.get("Requested_Fit_Reasoning") or "").strip() or None,
        manufacturability_fit_reason=(row.get("Manufacturability_Fit_Reasoning") or "").strip() or None,
        matched_jobs_summary=matched_summary[:5],
        buyer=(row.get("Buyer_Name") or "").strip() or None,
        contact_name=(row.get("Buyer_Name") or "").strip() or None,
        contact_email=(row.get("Secondary_Email") or row.get("Email") or "").strip() or None,
        contact_phone=(row.get("Contact_No") or "").strip() or None,
        company_name=(row.get("Company_Name") or "").strip() or None,
        company_location=(row.get("Company_Location") or "").strip() or None,
        company_size=(row.get("Company_Size") or "").strip() or None,
        customer_account_name=(row.get("Customer_Account_Name") or row.get("Customer_Name") or "").strip() or None,
        customer_industry=(row.get("Customer_Industry") or "").strip() or None,
        project_date=(row.get("Project_Date") or "").strip() or None,
        expected_annual_production_volume=(row.get("Expected_Annual_Production_Volume") or "").strip() or None,
        mandatory_certifications=(row.get("Required_Certifications") or "").strip() or None,
        certification_notes=(row.get("Certification_Notes") or "").strip() or None,
        project_description=(row.get("Project_Description") or "").strip() or None,
        other_project_requirements=(row.get("Other_Project_Requirements") or "").strip() or None,
        project=(row.get("Project_Name") or "").strip() or None,
        certs_required=_split_csvish(row.get("Required_Certifications")),
        geo_preference=(row.get("Geographic_Preferences") or row.get("Geo_Preference") or "").strip() or None,
        delivery=(row.get("Delivery_Date") or "").strip() or None,
        priority_note=(row.get("Priority_Note") or row.get("Priority") or "").strip() or None,
    )


@router.get("/recent")
async def recent_assessments(
    supplier_id: str | None = None,
    supplier_email: str | None = None,
    limit: int = 20,
    crm_only: bool = False,
):
    safe_supplier_id = (supplier_id or "").strip()
    safe_supplier_email = (supplier_email or "").strip().lower()
    if not safe_supplier_id and not safe_supplier_email:
        # Never return cross-supplier snapshots on unscoped calls.
        return {"items": []}

    safe_limit = max(1, min(limit, 100))

    local_rows = []
    if not crm_only:
        local_rows = list(ASSESSMENT_RECENT)
        if safe_supplier_id:
            local_rows = [r for r in local_rows if str(r.get("supplier_id") or "").strip() == safe_supplier_id]
        elif safe_supplier_email:
            local_rows = [r for r in local_rows if str(r.get("supplier_email") or "").strip().lower() == safe_supplier_email]

    zoho_rows = _fetch_recent_assessments_from_zoho(safe_supplier_email, safe_supplier_id, safe_limit)

    merged: list[dict] = []
    seen_ids = set()
    for row in local_rows + zoho_rows:
        rid = row.get("rfp_id")
        if not rid or rid in seen_ids:
            continue
        seen_ids.add(rid)
        merged.append(row)

    # Final hard guard: enforce supplier ownership one more time before returning.
    guarded: list[dict] = []
    for row in merged:
        row_sid = str(row.get("supplier_id") or "").strip()
        row_semail = str(row.get("supplier_email") or "").strip().lower()
        id_ok = bool(safe_supplier_id and row_sid and row_sid == safe_supplier_id)
        email_ok = bool((not safe_supplier_id) and safe_supplier_email and row_semail and row_semail == safe_supplier_email)
        if id_ok or email_ok:
            guarded.append(row)

    merged = guarded
    merged.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return {"items": merged[:safe_limit]}


@router.post("/update-intake")
async def update_assessment_intake(req: AssessmentIntakeUpdateRequest):
    raw_rfp_id = (req.rfp_id or "").strip()
    if not raw_rfp_id:
        raise HTTPException(status_code=400, detail="rfp_id is required")
    if not raw_rfp_id.startswith("ZOHO-"):
        raise HTTPException(status_code=400, detail="Only Zoho-backed assessments can be updated")

    zoho_id = raw_rfp_id.replace("ZOHO-", "", 1).strip()
    safe_supplier_id = (req.supplier_id or "").strip()
    safe_supplier_email = (req.supplier_email or "").strip().lower()

    try:
        fetch_resp = requests.get(
            f"https://www.zohoapis.com/crm/v2/RFP_Assessments/{zoho_id}",
            headers=zoho_headers(),
            timeout=10,
        )
        if fetch_resp.status_code != 200:
            raise HTTPException(status_code=fetch_resp.status_code, detail="Could not load assessment row")
        data = fetch_resp.json().get("data", []) or []
        if not data:
            raise HTTPException(status_code=404, detail="Assessment not found")
        row = data[0] or {}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update fetch error: {e}")

    row_supplier = row.get("Supplier_Name") or {}
    row_supplier_id = str(_pick_lookup_id(row_supplier) or "").strip()
    row_supplier_email = str((row.get("Supplier_Email") or row.get("Email") or row.get("Secondary_Email") or "")).strip().lower()
    has_access = False
    if safe_supplier_id and row_supplier_id and safe_supplier_id == row_supplier_id:
        has_access = True
    if (not safe_supplier_id) and safe_supplier_email and row_supplier_email and safe_supplier_email == row_supplier_email:
        has_access = True
    if not has_access:
        raise HTTPException(status_code=403, detail="Assessment does not belong to this supplier")

    def _clean(v: str | None) -> str:
        return str(v or "").strip()

    certs_joined = ", ".join(
        [x for x in (_clean(req.certs_required) + "," + _clean(req.mandatory_certifications)).split(",") if x.strip()]
    ).strip(", ").strip()
    if not certs_joined:
        certs_joined = _clean(req.mandatory_certifications) or _clean(req.certs_required)

    payload = {
        "id": str(zoho_id),
        "Buyer_Name": _clean(req.buyer),
        "Project_Name": _clean(req.project),
        "Secondary_Email": _clean(req.contact_email),
        "Contact_No": _clean(req.contact_phone),
        "Company_Name": _clean(req.company_name),
        "Company_Location": _clean(req.company_location),
        "Company_Size": _clean(req.company_size),
        "Customer_Account_Name": _clean(req.customer_account_name),
        "Customer_Industry": _clean(req.customer_industry),
        "Project_Date": _clean(req.project_date),
        "Expected_Annual_Production_Volume": _clean(req.expected_annual_production_volume),
        "Required_Certifications": certs_joined,
        "Certification_Notes": _clean(req.certification_notes),
        "Geographic_Preferences": _clean(req.geo_preference),
        "Delivery_Date": _clean(req.delivery),
        "Priority_Note": _clean(req.priority_note),
        "Project_Description": _clean(req.project_description),
        "Other_Project_Requirements": _clean(req.other_project_requirements),
    }

    try:
        put_resp = requests.put(
            "https://www.zohoapis.com/crm/v2/RFP_Assessments",
            headers=zoho_headers(),
            json={"data": [payload]},
            timeout=12,
        )
        if put_resp.status_code not in (200, 201):
            err = f"{put_resp.status_code}"
            try:
                body = put_resp.json()
                first = (body.get("data") or [{}])[0] if isinstance(body, dict) else {}
                code = first.get("code") or body.get("code")
                msg = first.get("message") or body.get("message")
                details = first.get("details") or {}
                err = f"{put_resp.status_code} {code or ''} {msg or ''} {details}".strip()
            except Exception:
                if put_resp.text:
                    err = f"{put_resp.status_code} {put_resp.text[:220]}"
            raise HTTPException(status_code=500, detail=f"Intake update failed: {err}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Intake update error: {e}")

    return {"ok": True, "rfp_id": raw_rfp_id}


@router.post("/no-bid")
async def no_bid_route(req: NoBidRouteRequest):
    """
    Route a no-bid decision:
      - decline_only: mark assessment as no-bid only
      - referral_program: create BRFP with From_Referral=true and Referring_Supplier
      - master_rfp_engine: create BRFP for full engine routing
    """
    raw_rfp_id = (req.rfp_id or "").strip()
    if not raw_rfp_id:
        raise HTTPException(status_code=400, detail="rfp_id is required")
    if req.path not in {"decline_only", "referral_program", "master_rfp_engine"}:
        raise HTTPException(status_code=400, detail="path must be decline_only | referral_program | master_rfp_engine")

    # We currently support no-bid routing for Zoho-backed records.
    if not raw_rfp_id.startswith("ZOHO-"):
        return {"ok": True, "path": req.path, "brfp_id": None, "attachments_copied": 0, "note": "Local-only assessment marked as no-bid"}

    zoho_id = raw_rfp_id.replace("ZOHO-", "", 1)
    row = _fetch_zoho_assessment_row(zoho_id)
    if not row:
        raise HTTPException(status_code=404, detail="RFP Assessment record not found in Zoho")

    brfp_id = None
    copied = 0
    if req.path in {"referral_program", "master_rfp_engine"}:
        payload = _build_brfp_payload_from_assessment(row, req)
        brfp_id = _create_brfp_record(payload)
        copied = _copy_assessment_attachments_to_brfp(zoho_id, brfp_id)

    update_ok, update_msg = _update_assessment_no_bid(zoho_id, req, brfp_id)
    return {
        "ok": True,
        "path": req.path,
        "brfp_id": brfp_id,
        "attachments_copied": copied,
        "assessment_updated": update_ok,
        "assessment_update_message": update_msg,
    }


@router.post("/match-feedback")
async def save_match_feedback(req: AssessmentFeedbackRequest):
    """
    Persist supplier feedback into existing RFP_Assessments fields:
      - Similar_Past_Projects subform row updates:
          User_Rating, User_Score, Reason, Field_Correction
      - Parent record updates:
          Overall_Accuracy, Overall_Feedback
    """
    raw_rfp_id = (req.rfp_id or "").strip()
    if not raw_rfp_id:
        raise HTTPException(status_code=400, detail="rfp_id is required")
    if not raw_rfp_id.startswith("ZOHO-"):
        return {"ok": True, "updated_rows": 0, "updated_overall": False, "note": "local-only assessment"}

    zoho_id = raw_rfp_id.replace("ZOHO-", "", 1)
    row_map: dict[str, MatchFeedbackRow] = {}
    for item in req.rows or []:
        vec_id = (item.pinecone_vector_id or "").strip()
        if not vec_id:
            continue
        row_map[vec_id] = item

    try:
        fetch_resp = requests.get(
            f"https://www.zohoapis.com/crm/v2/RFP_Assessments/{zoho_id}",
            headers=zoho_headers(),
            timeout=10,
        )
        if fetch_resp.status_code != 200:
            raise HTTPException(status_code=fetch_resp.status_code, detail="Could not load assessment row")
        data = fetch_resp.json().get("data", []) or []
        if not data:
            raise HTTPException(status_code=404, detail="Assessment not found")
        assessment_row = data[0] or {}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Feedback fetch error: {e}")

    existing_similar_rows = list(assessment_row.get("Similar_Past_Projects") or [])
    updated_count = 0
    updated_similar_rows = []
    matched_vec_ids: set[str] = set()

    for sr in existing_similar_rows:
        current = dict(sr or {})
        vec_id = str(current.get("Pinecone_Vector_ID") or "").strip()
        fb = row_map.get(vec_id)
        if fb:
            matched_vec_ids.add(vec_id)
            if fb.user_rating is not None:
                current["User_Rating"] = fb.user_rating
            if fb.user_score is not None:
                current["User_Score"] = round(float(fb.user_score), 2)
            if fb.reason is not None:
                current["Reason"] = fb.reason
            if fb.field_corrections is not None:
                current["Field_Correction"] = json.dumps(fb.field_corrections)
            updated_count += 1
        updated_similar_rows.append(current)

    for vec_id, fb in row_map.items():
        if vec_id in matched_vec_ids:
            continue
        appended = {
            "Pinecone_Vector_ID": vec_id,
            "User_Rating": fb.user_rating or "",
            "User_Score": (round(float(fb.user_score), 2) if fb.user_score is not None else None),
            "Reason": fb.reason or "",
            "Field_Correction": (json.dumps(fb.field_corrections) if fb.field_corrections else ""),
            "Fit_Score": "",
        }
        updated_similar_rows.append(appended)
        updated_count += 1

    payload = {"id": str(zoho_id)}
    payload["Similar_Past_Projects"] = updated_similar_rows
    updated_overall = False
    if req.overall_accuracy is not None:
        payload["Overall_Accuracy"] = req.overall_accuracy
        updated_overall = True
    if req.overall_score is not None:
        payload["Overall_Score"] = round(float(req.overall_score), 2)
        updated_overall = True
    if req.overall_feedback is not None:
        payload["Overall_Feedback"] = req.overall_feedback
        updated_overall = True

    try:
        put_resp = requests.put(
            "https://www.zohoapis.com/crm/v2/RFP_Assessments",
            headers=zoho_headers(),
            json={"data": [payload]},
            timeout=12,
        )
        if put_resp.status_code not in (200, 201):
            err = f"{put_resp.status_code}"
            try:
                body = put_resp.json()
                first = (body.get("data") or [{}])[0] if isinstance(body, dict) else {}
                code = first.get("code") or body.get("code")
                msg = first.get("message") or body.get("message")
                details = first.get("details") or {}
                err = f"{put_resp.status_code} {code or ''} {msg or ''} {details}".strip()
            except Exception:
                if put_resp.text:
                    err = f"{put_resp.status_code} {put_resp.text[:200]}"
            raise HTTPException(status_code=500, detail=f"Feedback save failed: {err}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Feedback save error: {e}")

    return {
        "ok": True,
        "updated_rows": updated_count,
        "updated_overall": updated_overall,
        "rfp_id": raw_rfp_id,
    }


@router.get("/corpus-health")
async def corpus_health(
    supplier_id: str | None = None,
    supplier_name: str | None = None,
):
    return _build_supplier_corpus_health(supplier_id, supplier_name)


@router.get("/result", response_model=AssessmentResult)
async def assessment_result(
    rfp_id: str,
    supplier_id: str | None = None,
    supplier_email: str | None = None,
    force_refresh: bool = False,
):
    safe_supplier_id = (supplier_id or "").strip()
    safe_supplier_email = (supplier_email or "").strip().lower()
    if not safe_supplier_id and not safe_supplier_email:
        raise HTTPException(status_code=400, detail="supplier_id or supplier_email is required")

    # Accept raw numeric Zoho record ids by normalizing to canonical prefix.
    if re.fullmatch(r"\d{10,}", (rfp_id or "").strip()):
        rfp_id = f"ZOHO-{rfp_id.strip()}"

    # Skip cache for ZOHO- ids when force_refresh is set so the backend re-runs
    # full Zoho + Pinecone enrichment (_build_assessment_result_from_zoho_record).
    payload = ASSESSMENT_CACHE.get(rfp_id)
    if payload and not (force_refresh and rfp_id.startswith("ZOHO-")):
        if not rfp_id.startswith("ZOHO-"):
            return payload
        cached_supplier_id = str((payload or {}).get("supplier_id") or "").strip()
        cached_supplier_email = str((payload or {}).get("supplier_email") or "").strip().lower()
        has_access = False
        if safe_supplier_id and cached_supplier_id and safe_supplier_id == cached_supplier_id:
            has_access = True
        if (not safe_supplier_id) and safe_supplier_email and cached_supplier_email and safe_supplier_email == cached_supplier_email:
            has_access = True
        if has_access:
            return payload

    # Normalize legacy malformed ids such as ZOHO-RFP-XXXX.
    if rfp_id.startswith("ZOHO-RFP-"):
        local_id = rfp_id.replace("ZOHO-", "", 1)
        payload = ASSESSMENT_CACHE.get(local_id)
        if payload and not force_refresh:
            return payload

    # Historical records shown in dashboard use a Zoho-prefixed id.
    if rfp_id.startswith("ZOHO-"):
        zoho_id = rfp_id.replace("ZOHO-", "", 1)
        # Guard: local transient ids should not be queried against Zoho module endpoint.
        if zoho_id.startswith("RFP-"):
            raise HTTPException(
                status_code=404,
                detail="Assessment snapshot unavailable in this session. Re-run assessment to open full fit/history view.",
            )
        try:
            resp = requests.get(
                f"https://www.zohoapis.com/crm/v2/RFP_Assessments/{zoho_id}",
                headers=zoho_headers(),
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json().get("data", [])
                if data:
                    row = data[0]
                    row_supplier = row.get("Supplier_Name") or {}
                    row_supplier_id = _pick_lookup_id(row_supplier)
                    row_supplier_email = (
                        (row.get("Supplier_Email") or row.get("Email") or row.get("Secondary_Email") or "").strip().lower()
                    )
                    has_access = False
                    if safe_supplier_id and row_supplier_id and row_supplier_id == safe_supplier_id:
                        has_access = True
                    if (not safe_supplier_id) and safe_supplier_email and row_supplier_email and row_supplier_email == safe_supplier_email:
                        has_access = True
                    if not has_access:
                        raise HTTPException(status_code=403, detail="Assessment does not belong to this supplier")
                    result = await _build_assessment_result_from_zoho_record(row)
                    _cache_assessment_payload(rfp_id, result.model_dump())
                    return result
            elif resp.status_code != 404:
                print(f"[assessment] Zoho result fetch failed: {resp.status_code} {resp.text}")
        except Exception as e:
            print(f"[assessment] Zoho result fetch error: {e}")

    raise HTTPException(
        status_code=404,
        detail="Assessment snapshot unavailable in this session. Re-run assessment to open full fit/history view.",
    )


@router.get("/attachment")
async def assessment_attachment(record_id: str, attachment_id: str, module_api: str = "RFP_Assessments"):
    """
    Proxy Zoho attachment bytes for snapshot image rendering in frontend.
    """
    try:
        module_name = (module_api or "RFP_Assessments").strip() or "RFP_Assessments"
        _alog(
            f"attachment_proxy request module={module_name} record_id={record_id} attachment_id={attachment_id}"
        )
        resp = requests.get(
            f"https://www.zohoapis.com/crm/v2/{module_name}/{record_id}/Attachments/{attachment_id}",
            headers=zoho_headers(),
            timeout=20,
        )
        if resp.status_code != 200:
            _alog(
                f"attachment_proxy non200 module={module_name} record_id={record_id} "
                f"attachment_id={attachment_id} status={resp.status_code}"
            )
            raise HTTPException(status_code=resp.status_code, detail="Attachment fetch failed")
        content_type = resp.headers.get("Content-Type", "application/octet-stream")
        disposition = resp.headers.get("Content-Disposition", "inline")
        if not content_type or content_type == "application/octet-stream":
            body = resp.content or b""
            dispo_l = (disposition or "").lower()
            if body.startswith(b"\x89PNG\r\n\x1a\n") or ".png" in dispo_l:
                content_type = "image/png"
            elif body.startswith(b"\xff\xd8\xff") or ".jpg" in dispo_l or ".jpeg" in dispo_l:
                content_type = "image/jpeg"
            elif body[:6] in (b"GIF87a", b"GIF89a") or ".gif" in dispo_l:
                content_type = "image/gif"
            elif body.startswith(b"RIFF") and body[8:12] == b"WEBP" or ".webp" in dispo_l:
                content_type = "image/webp"
        _alog(
            f"attachment_proxy ok module={module_name} record_id={record_id} attachment_id={attachment_id} "
            f"content_type={content_type} bytes={len(resp.content or b'')}"
        )
        return Response(
            content=resp.content,
            media_type=content_type,
            headers={"Content-Disposition": disposition},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Attachment proxy error: {e}")

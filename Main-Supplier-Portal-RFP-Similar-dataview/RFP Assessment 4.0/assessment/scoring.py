"""
TrustBridge scoring engine for supplier RFP assessment.

B1: SentenceTransformer semantic match vs process capability profiles
B2: Process mix inferred from supplier history in Zoho and Pinecone metadata
C:  CLIP visual/text match vs supplier past-project vectors in Pinecone
"""

import asyncio
import httpx
import json
import os
import re
import time
from collections import Counter
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode

from clip_embedder import compute_clip_embedding_from_pil, compute_clip_text_embedding
from deps import (
    get_historical_projects_index,
    get_process_profile_index,
    get_text_embedder,
)
from models import MatchedJob, RFPPart, ScoredPart, SupplierDataState

_SUPPLIER_PROFILE_ROWS_CACHE: dict[str, dict] = {}  # stores {"rows": list[dict], "ts": float}
_SUPPLIER_FEEDBACK_SIGNAL_CACHE: dict[str, dict] = {}
_ASSESSMENT_VERBOSE = os.getenv("ASSESSMENT_VERBOSE_LOGS", "true").strip().lower() in {"1", "true", "yes", "on"}
_HISTORY_FIRST_SCORING = os.getenv("HISTORY_FIRST_SCORING", "true").strip().lower() in {"1", "true", "yes", "on"}
_OUTCOME_AWARE_HISTORY = os.getenv("OUTCOME_AWARE_HISTORY", "true").strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)).strip())
    except Exception:
        return float(default)


# Certification penalty tuning:
# multiplier = max(CERT_PENALTY_MIN_MULTIPLIER, CERT_PENALTY_PER_MISSING ** capped_missing_count)
_CERT_PENALTY_PER_MISSING = min(1.0, max(0.0, _env_float("CERT_PENALTY_PER_MISSING", 0.95)))
_CERT_PENALTY_MIN_MULTIPLIER = min(1.0, max(0.0, _env_float("CERT_PENALTY_MIN_MULTIPLIER", 0.60)))
_CERT_PENALTY_MAX_MISSING_COUNT = max(0, int(_env_float("CERT_PENALTY_MAX_MISSING_COUNT", 5)))


def _resolve_weights():
    def _normalize_group(group_name: str, values: list[float]) -> list[float]:
        cleaned = [max(0.0, float(v)) for v in values]
        total = sum(cleaned)
        if total <= 0.0:
            fallback = [1.0 / float(len(cleaned))] * len(cleaned)
            _alog(
                f"weights normalized group={group_name} reason=non_positive_sum "
                f"input={values} output={fallback}"
            )
            return fallback
        normalized = [v / total for v in cleaned]
        if any(abs(a - b) > 1e-9 for a, b in zip(normalized, values)):
            _alog(f"weights normalized group={group_name} input={values} output={normalized}")
        return normalized

    if _HISTORY_FIRST_SCORING:
        w_b1 = _env_float("WEIGHT_B1", 0.25)
        w_b2 = _env_float("WEIGHT_B2", 0.15)
        w_c = _env_float("WEIGHT_C", 0.60)
        # Fallbacks when one signal is missing.
        w_b1_only = _env_float("WEIGHT_B1_ONLY_NO_C", 0.60)
        w_b2_with_b1_only = _env_float("WEIGHT_B2_WITH_B1_ONLY", 0.40)
        w_b2_only_no_b1 = _env_float("WEIGHT_B2_ONLY_NO_B1", 0.30)
        w_c_only_no_b1 = _env_float("WEIGHT_C_ONLY_NO_B1", 0.70)
    else:
        w_b1 = _env_float("WEIGHT_B1", 0.35)
        w_b2 = _env_float("WEIGHT_B2", 0.30)
        w_c = _env_float("WEIGHT_C", 0.35)
        w_b1_only = _env_float("WEIGHT_B1_ONLY_NO_C", 0.55)
        w_b2_with_b1_only = _env_float("WEIGHT_B2_WITH_B1_ONLY", 0.45)
        w_b2_only_no_b1 = _env_float("WEIGHT_B2_ONLY_NO_B1", 0.45)
        w_c_only_no_b1 = _env_float("WEIGHT_C_ONLY_NO_B1", 0.55)

    w_b1, w_b2, w_c = _normalize_group("full", [w_b1, w_b2, w_c])
    w_b1_only, w_b2_with_b1_only = _normalize_group("b1_only", [w_b1_only, w_b2_with_b1_only])
    w_b2_only_no_b1, w_c_only_no_b1 = _normalize_group("no_b1", [w_b2_only_no_b1, w_c_only_no_b1])

    return {
        "w_b1": w_b1,
        "w_b2": w_b2,
        "w_c": w_c,
        "w_b1_only": w_b1_only,
        "w_b2_with_b1_only": w_b2_with_b1_only,
        "w_b2_only_no_b1": w_b2_only_no_b1,
        "w_c_only_no_b1": w_c_only_no_b1,
    }


def _alog(message: str):
    if _ASSESSMENT_VERBOSE:
        print(f"[assessment][scoring] {message}")


def _normalize_material(value: str) -> str:
    text = (value or "").lower().strip()
    if not text:
        return ""

    # Generic cleanup.
    text = re.sub(r"[‐‑‒–—−]", "-", text)
    text = re.sub(r"[_/,;:()]+", " ", text)
    text = re.sub(r"\b(astm|aisi|din|en|iso)\b", " ", text)
    text = re.sub(r"\b(eos|renishaw|markforged|forgedx|sls|slm|dmls|am|grade)\b", " ", text)
    text = re.sub(r"\baluminium\b", "aluminum", text)
    text = re.sub(r"\bss\b", "stainless steel", text)
    text = re.sub(r"\bstainless\b", "stainless steel", text)
    text = re.sub(r"\s+", " ", text).strip()

    # Normalize grade-like patterns generically (works for many materials).
    # Examples:
    # 17-4PH -> 17 4ph
    # 6061-T6 -> 6061 t6
    # Ti-6Al-4V -> ti 6al 4v
    text = re.sub(r"(?<=\d)-(?=\d)", " ", text)
    text = re.sub(r"(?<=\d)-(?=[a-z])", " ", text)
    text = re.sub(r"(?<=[a-z])-(?=\d)", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    tokens = [t for t in re.split(r"\s+", text) if t]
    if not tokens:
        return ""

    families: list[str] = []
    grade_tokens: list[str] = []
    other_tokens: list[str] = []

    def add_unique(bucket: list[str], token: str):
        if token and token not in bucket:
            bucket.append(token)

    for tok in tokens:
        t = re.sub(r"[^a-z0-9]", "", tok)
        if not t:
            continue
        if t in {"steel", "stainless", "stainlesssteel"}:
            add_unique(families, "stainless steel")
        elif t in {"al", "aluminum"}:
            add_unique(families, "aluminum")
        elif t in {"ti", "titanium"}:
            add_unique(families, "titanium")
        elif t in {"inconel", "nickelalloy", "nickel"}:
            add_unique(families, "inconel")
        elif t in {"hastelloy"}:
            add_unique(families, "hastelloy")
        elif t in {"brass", "bronze", "copper"}:
            add_unique(families, t)
        elif t in {"abs", "nylon", "peek", "delrin", "pom", "ptfe", "pla", "petg"}:
            add_unique(families, t)
        elif re.search(r"\d", t):
            # Keep generic grade tokens (e.g. 316l, 6061, t6, 6al, 4v, 17, 4ph).
            add_unique(grade_tokens, t)
        else:
            add_unique(other_tokens, t)

    # Compact common split-grade sequences:
    # "17 4ph" -> "174ph", "6al 4v" -> "6al4v"
    compacted: list[str] = []
    i = 0
    while i < len(grade_tokens):
        cur = grade_tokens[i]
        nxt = grade_tokens[i + 1] if i + 1 < len(grade_tokens) else ""
        if cur.isdigit() and nxt and any(ch.isalpha() for ch in nxt):
            compacted.append(f"{cur}{nxt}")
            i += 2
            continue
        if any(ch.isalpha() for ch in cur) and nxt and any(ch.isdigit() for ch in nxt):
            compacted.append(f"{cur}{nxt}")
            i += 2
            continue
        compacted.append(cur)
        i += 1

    # Keep an alias layer as an override (still useful for known frequent forms).
    alias_key = " ".join(tokens)
    aliases = {
        "stainless steel 316": "stainless steel 316",
        "stainless steel 316l": "stainless steel 316l",
        "aluminum 6061": "aluminum 6061",
        "aluminum 6061 t6": "aluminum 6061 t6",
        "aluminum 7075": "aluminum 7075",
        "aluminum 7075 t6": "aluminum 7075 t6",
        "titanium 6al 4v": "titanium 6al4v",
    }
    if alias_key in aliases:
        return aliases[alias_key]

    normalized = " ".join([*families, *compacted, *other_tokens]).strip()
    return normalized or " ".join(tokens)


def _normalize_process(value: str) -> str:
    text = (value or "").lower().strip()
    text = re.sub(r"[\-_/,]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    aliases = {
        "turning": "cnc turning",
        "lathe": "cnc turning",
        "cnc turn": "cnc turning",
        "milling": "cnc milling",
        "cnc mill": "cnc milling",
        "5 axis cnc": "5 axis cnc milling",
        "5 axis mill": "5 axis cnc milling",
        "3 axis cnc": "3 axis cnc milling",
        "grinding": "od grinding",
        "od grind": "od grinding",
        "wire edm": "edm wire",
        "edm": "edm wire",
        "sheet metal fabrication": "sheet metal",
        "additive manufacturing": "3d printing",
        "metal additive manufacturing": "dmls",
        "direct metal laser sintering": "dmls",
        "metal 3d printing": "dmls",
        "slm": "dmls",
    }
    return aliases.get(text, text)


def _expand_process_terms(rfp_process: str) -> list[str]:
    """
    Expand incoming RFP process phrasing into close synonyms so recall/matching
    works across supplier vocab differences.
    """
    synonyms = {
        "3d printing": ["3d printing", "additive manufacturing", "fdm", "sls", "sla"],
        "machining": ["machining", "cnc machining"],
        "casting": ["casting"],
        "cnc": ["cnc machining", "cnc milling", "cnc turning", "5 axis cnc milling"],
        "milling": ["cnc milling", "5 axis cnc milling", "milling"],
        "turning": ["cnc turning", "turning", "lathe"],
        "injection molding": ["injection molding", "molding"],
        "sheet metal": ["sheet metal", "sheet metal forming", "stamping"],
        "grinding": ["grinding", "od grinding", "surface grinding"],
        "edm": ["edm", "electrical discharge machining", "wire edm"],
        "welding": ["welding", "tig welding", "mig welding"],
        "sls": [
            "sls",
            "selective laser sintering",
            "polymer 3d printing",
            "nylon 3d printing",
            "3d printing",
            "additive manufacturing",
        ],
        "dmls": [
            "dmls",
            "metal 3d printing",
            "direct metal laser sintering",
            "metal additive manufacturing",
            "slm",
        ],
        "slm": [
            "slm",
            "selective laser melting",
            "metal 3d printing",
            "dmls",
            "metal additive manufacturing",
        ],
        "fdm": ["fdm", "fused deposition modeling", "3d printing", "fff", "additive manufacturing"],
        "mjf": ["mjf", "multi jet fusion", "3d printing", "hp mjf", "polymer am"],
    }

    base_tokens = _parse_process_tokens(rfp_process)
    expanded: list[str] = []

    def add_term(term: str):
        norm = _normalize_process(term)
        if not norm:
            return
        if norm not in expanded:
            expanded.append(norm)

    for token in base_tokens:
        add_term(token)
        for key, vals in synonyms.items():
            if key in token or token in key:
                for v in vals:
                    add_term(v)

    if not expanded:
        for token in _parse_process_tokens(_normalize_process(rfp_process)):
            add_term(token)
    return expanded


def _cert_penalty_calc(
    certs_required: list[str],
    supplier_certs: list[str],
) -> tuple[float, list[str]]:
    """
    Returns (multiplier, missing_cert_names).
    Applies configurable per-missing-cert compounding with floor and cap:
      multiplier = max(min_multiplier, per_missing ** min(missing_count, max_missing_count))
    Matching is case-insensitive substring so 'AS9100D' matches 'AS9100'
    and 'ISO 9001:2015' matches 'ISO 9001'.
    """
    if not certs_required:
        return 1.0, []

    def _norm(c: str) -> str:
        c = re.sub(r"[:\-]\s*\d{4}\b", "", (c or "").lower())   # strip :2015 / -2015
        c = re.sub(r"\s+(rev|revision|ed|edition)\s*\S*", "", c) # strip Rev D etc.
        return re.sub(r"\s+", " ", c).strip()

    supplier_norms = [_norm(c) for c in (supplier_certs or [])]
    missing: list[str] = []
    for req in certs_required:
        req_norm = _norm(req)
        if not req_norm:
            continue
        if not any(req_norm in s or s in req_norm for s in supplier_norms):
            missing.append(req)

    missing_count = len(missing)
    capped_count = min(missing_count, _CERT_PENALTY_MAX_MISSING_COUNT)
    raw = _CERT_PENALTY_PER_MISSING ** capped_count
    multiplier = round(max(_CERT_PENALTY_MIN_MULTIPLIER, raw), 4)
    return multiplier, missing


async def score_b1(
    part: RFPPart,
    supplier_id: str,
    certs_required: list[str] | None = None,
    supplier_certs: list[str] | None = None,
    details_out: dict | None = None,
) -> Optional[float]:
    """
    Semantic match of part spec vs supplier's capability profile.
    Uses the same multi-layer recall pattern but scoped to one supplier.
    If certs_required is provided, applies a 0.85x penalty per missing cert.
    If details_out dict is provided, it is populated with per-signal match info
    (matched_processes, matched_materials, tolerance_capable, missing_certs)
    for UI display — never sent to the supplier directly.
    """
    part_id = f"{part.id or 'unknown'}"
    profile_index_name = os.getenv("PINECONE_PROFILE_INDEX", "").strip() or "process-profiles2"
    _alog(
        f"b1 start part_id={part_id} supplier_id={supplier_id} "
        f"profile_index={profile_index_name}"
    )

    # Seed details_out with RFP-side data so fields are always present even
    # when the profile-metadata path is skipped (no Pinecone profile rows).
    if details_out is not None:
        details_out.setdefault("required_processes", list(_expand_process_terms(part.process)))
        details_out.setdefault("matched_processes", [])
        details_out.setdefault("matched_materials", [])
        details_out.setdefault("tolerance_capable", None)
        details_out.setdefault("missing_certs", [])

    def _penalize(score: Optional[float]) -> Optional[float]:
        if score is None:
            return score
        multiplier, missing = _cert_penalty_calc(certs_required or [], supplier_certs or [])
        if details_out is not None:
            details_out["missing_certs"] = missing
        if not certs_required or not missing:
            return score
        penalized = round(score * multiplier, 1)
        _alog(
            f"b1 cert_penalty part_id={part_id} supplier_id={supplier_id} "
            f"missing_certs={missing} multiplier={multiplier} "
            f"score_before={score} score_after={penalized}"
        )
        return penalized

    try:
        embedder = get_text_embedder()
    except Exception as e:
        print(f"  [B1] Embedder unavailable for {supplier_id}: {e}")
        profile_rows = _fetch_supplier_profile_rows(supplier_id)
        metadata_only = _score_profile_metadata_match(part, profile_rows, details_out) if profile_rows else None
        _alog(
            f"b1 fallback_metadata_only part_id={part_id} supplier_id={supplier_id} "
            f"profile_rows={len(profile_rows)} metadata_score={metadata_only}"
        )
        return _penalize(metadata_only)
    index = get_process_profile_index()

    material_norm = _normalize_material(part.material)
    expanded_processes = _expand_process_terms(part.process)
    process_norm = expanded_processes[0] if expanded_processes else _normalize_process(part.process)
    process_phrase = " ".join(expanded_processes[:5]).strip()
    recall_queries = [
        f"{material_norm} {process_norm} {part.tolerance or ''} {part.description}",
        f"{material_norm} machining tight tolerance",
        f"{process_norm} precision manufacturing",
    ]
    if process_phrase:
        recall_queries.append(f"{material_norm} {process_phrase} supplier capability")

    best_score = None
    semantic_attempts = 0
    semantic_hits = 0
    semantic_profile_processes: set[str] = set()
    semantic_profile_materials: set[str] = set()

    def _clean_token(v: str) -> str:
        return re.sub(r"\s+", " ", str(v or "")).strip()

    def _collect_semantic_profile_tokens(md: dict) -> None:
        if not isinstance(md, dict):
            return
        proc_keys = [
            "process_primary", "process_primary_name", "generic_process", "branded_process",
            "process_family", "process", "Process_Primary", "Process_Family",
        ]
        mat_keys = [
            "material_name", "material_class", "material_family", "material", "Material",
            "inference_material",
        ]
        for k in proc_keys:
            raw = md.get(k)
            if not raw:
                continue
            for tok in re.split(r"[,\u00b7/+|]", str(raw)):
                t = _clean_token(tok)
                if t:
                    semantic_profile_processes.add(t)
        for k in mat_keys:
            raw = md.get(k)
            if not raw:
                continue
            for tok in re.split(r"[,\u00b7/+|]", str(raw)):
                t = _clean_token(tok)
                if t:
                    semantic_profile_materials.add(t)

    for query_idx, query_text in enumerate(recall_queries, start=1):
        _alog(
            f"b1 semantic_query_start part_id={part_id} supplier_id={supplier_id} "
            f"query_idx={query_idx} text='{query_text[:180]}'"
        )
        try:
            vector = embedder.encode(query_text).tolist()
        except Exception as e:
            print(f"  [B1] encode failed for {supplier_id}: {e}")
            continue
        for profile_filter in _profile_filters(supplier_id):
            semantic_attempts += 1
            try:
                results = index.query(
                    vector=vector,
                    filter=profile_filter,
                    top_k=10,
                    include_metadata=True,
                )
            except Exception as e:
                print(f"  [B1] profile query failed for {supplier_id} filter={profile_filter}: {e}")
                continue
            match_count = len(results.matches or [])
            if match_count:
                semantic_hits += 1
            _alog(
                f"b1 semantic_query_result part_id={part_id} supplier_id={supplier_id} "
                f"query_idx={query_idx} filter={profile_filter} matches={match_count}"
            )
            if results.matches:
                top = results.matches[0].score * 100
                best_score = max(best_score or 0, top)
                for m in (results.matches or [])[:5]:
                    _collect_semantic_profile_tokens(getattr(m, "metadata", {}) or {})

    semantic_score = round(min(best_score, 100), 1) if best_score else None

    if details_out is not None:
        # Keep multiple vector-profile contributors so UI can show exactly what
        # from profile matching drove the score.
        if semantic_profile_processes:
            details_out["semantic_profile_processes"] = sorted(semantic_profile_processes)
        if semantic_profile_materials:
            details_out["semantic_profile_materials"] = sorted(semantic_profile_materials)
        # If metadata-row path couldn't provide profile lists, fallback to
        # semantic profile tokens so UI doesn't show empty drivers.
        if not details_out.get("profile_processes") and semantic_profile_processes:
            details_out["profile_processes"] = sorted(semantic_profile_processes)
        if not details_out.get("profile_materials") and semantic_profile_materials:
            details_out["profile_materials"] = sorted(semantic_profile_materials)

    profile_rows = _fetch_supplier_profile_rows(supplier_id)
    metadata_score = _score_profile_metadata_match(part, profile_rows, details_out) if profile_rows else None
    _alog(
        f"b1 summary part_id={part_id} supplier_id={supplier_id} "
        f"semantic_attempts={semantic_attempts} semantic_hits={semantic_hits} "
        f"profile_rows={len(profile_rows)} semantic_score={semantic_score} metadata_score={metadata_score}"
    )

    if semantic_score is None and metadata_score is None:
        _alog(f"b1 done part_id={part_id} supplier_id={supplier_id} result=None")
        return None
    if semantic_score is None:
        _alog(f"b1 done part_id={part_id} supplier_id={supplier_id} result={metadata_score} source=metadata_only")
        return _penalize(metadata_score)
    if metadata_score is None:
        _alog(f"b1 done part_id={part_id} supplier_id={supplier_id} result={semantic_score} source=semantic_only")
        return _penalize(semantic_score)

    # Blend embedding signal with deterministic profile checks.
    blended = (semantic_score * 0.65) + (metadata_score * 0.35)
    final_score = round(min(max(blended, 0.0), 100.0), 1)
    _alog(
        f"b1 done part_id={part_id} supplier_id={supplier_id} result={final_score} "
        f"source=blend semantic_weight=0.65 metadata_weight=0.35"
    )
    return _penalize(final_score)


async def score_b2(
    part: RFPPart,
    supplier_id: str,
    supplier_name: Optional[str] = None,
    recommended_processes: Optional[list[str]] = None,
    infer_source: str = "stated",
    details_out: dict | None = None,
) -> float:
    """
    Manufacturability fit from supplier history, scored against the process
    TrustBridge recommends (via _infer_recommended_processes) rather than
    whatever the customer stated. Falls back to part.process if not provided.
    If details_out is provided it is populated with matched history processes
    and materials for UI display.
    """
    history_rows = _fetch_supplier_history_rows(supplier_id, supplier_name)
    if not history_rows:
        if details_out is not None:
            details_out["history_matched_processes"] = []
            details_out["history_matched_materials"] = []
        return 55.0

    process_counts: Counter = Counter()
    material_counts: Counter = Counter()
    family_counts: Counter = Counter()

    for row in history_rows:
        proc = _normalize_process((
            _pick_meta(
                row,
                "Process_Primary",
                "process_primary",
                "process_p",
                "process_primary_name",
            )
            or _pick_meta_prefix(row, "process_p", "process_primary")
            or ""
        ).strip())
        if proc:
            process_counts[proc] += 1
        material = _normalize_material((
            _pick_meta(
                row,
                "Material",
                "material",
                "inference_material",
                "material_c",
                "material_r",
                "material_name",
            )
            or _pick_meta_prefix(row, "material", "inference_material")
            or ""
        ).strip())
        if material:
            material_counts[material] += 1
        family = (
            _pick_meta(row, "Part_Family", "part_family")
            or _pick_meta_prefix(row, "part_family")
            or ""
        ).strip()
        if family:
            family_counts[family] += 1

    if not process_counts:
        if details_out is not None:
            details_out["history_matched_processes"] = []
            details_out["history_matched_materials"] = []
        return 50.0

    if recommended_processes:
        required = [_normalize_process(p) for p in recommended_processes if p]
        required = [r for r in required if r] or _parse_process_tokens(part.process)
    else:
        required = _parse_process_tokens(part.process)

    if details_out is not None:
        matched_procs: list[str] = []
        for hist_proc in process_counts:
            norm_hist = _normalize_process(hist_proc)
            if required and any(
                _normalize_process(req) in norm_hist or norm_hist in _normalize_process(req)
                for req in required
            ):
                matched_procs.append(hist_proc)
        details_out["history_matched_processes"] = matched_procs

        targets = _expand_material_terms(part.material)
        matched_mats: list[str] = []
        for hist_mat in material_counts:
            compare = _normalize_material(hist_mat)
            if targets and any(t in compare or compare in t for t in targets):
                matched_mats.append(hist_mat)
            else:
                c_toks = {tok for tok in re.split(r"\s+", compare) if len(tok) >= 2}
                for t in (targets or []):
                    t_toks = {x for x in re.split(r"\s+", t) if len(x) >= 2}
                    if t_toks and c_toks and len(t_toks.intersection(c_toks)) / max(len(t_toks), 1) >= 0.5:
                        matched_mats.append(hist_mat)
                        break
        details_out["history_matched_materials"] = matched_mats

    exact_fit = (
        sum(_fuzzy_match_process(req, process_counts) for req in required) / max(len(required), 1)
        if required else 0.0
    )
    adjacent_fit = (
        sum(_adjacent_process_fit(req, process_counts) for req in required) / max(len(required), 1)
        if required else 0.0
    )
    material_fit = _material_fit(part.material, material_counts)
    family_hint = _infer_part_family(part)
    family_fit = _family_fit(family_hint, family_counts)
    process_breadth = min(len({_canonical_process(k) for k in process_counts if _canonical_process(k)}) / 6, 1.0)

    raw = (
        25.0
        + (exact_fit * 30.0)
        + (adjacent_fit * 20.0)
        + (material_fit * 10.0)
        + (family_fit * 15.0)
        + (process_breadth * 10.0)
    )
    base_score = round(min(raw, 100), 1)

    # AI refinement is bounded and never dominates B2.
    # B2 remains primarily deterministic from supplier history evidence.
    ai_delta = 0.0
    stated_tokens = _parse_process_tokens(part.process or "")
    stated_families = {
        _canonical_process(_normalize_process(s)) for s in stated_tokens if _canonical_process(_normalize_process(s))
    }
    inferred_tokens = [r for r in (recommended_processes or []) if r]
    inferred_families = {
        _canonical_process(_normalize_process(r)) for r in inferred_tokens if _canonical_process(_normalize_process(r))
    }
    family_overlap = bool(stated_families and inferred_families and stated_families.intersection(inferred_families))
    history_match_count = len(details_out.get("history_matched_processes") or []) if details_out is not None else 0

    if inferred_tokens:
        if family_overlap:
            ai_delta += 3.0 if infer_source == "gemini" else 2.0
        elif stated_tokens:
            ai_delta -= 1.5 if infer_source == "gemini" else 1.0

        if history_match_count >= 2 and family_overlap:
            ai_delta += 2.0
        if history_match_count == 0 and not family_overlap and stated_tokens:
            ai_delta -= 1.0

    # Confidence gating: when deterministic evidence is already strong,
    # shrink AI influence to keep results stable.
    deterministic_strong = (exact_fit >= 0.85 and material_fit >= 0.7) or base_score >= 82.0
    if deterministic_strong:
        ai_delta *= 0.4
    elif infer_source == "rules_low_confidence":
        ai_delta *= 0.5
    elif infer_source == "stated":
        ai_delta = 0.0

    ai_delta = round(max(-8.0, min(8.0, ai_delta)), 1)
    final_score = round(max(0.0, min(100.0, base_score + ai_delta)), 1)

    if details_out is not None:
        details_out["b2_base_score"] = base_score
        details_out["b2_ai_delta"] = ai_delta
        details_out["b2_final_score"] = final_score
        details_out["b2_infer_source"] = infer_source
        details_out["b2_family_overlap"] = family_overlap
        details_out["b2_history_process_match_count"] = history_match_count

    return final_score


# ── B2 process inference ──────────────────────────────────────────────────────

async def _gemini_infer_process(part: RFPPart) -> list[str] | None:
    """
    Layer 1: Ask Gemini for the optimal manufacturing process.
    Returns a list of 1-3 process names or None if the call fails.
    Uses a minimal prompt (~50 input / ~15 output tokens) on gemini-flash-lite.
    The inference_source is logged here and never forwarded to the frontend.
    """
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None

    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite").strip()
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{gemini_model}:generateContent"
    )
    prompt = (
        "You are a manufacturing process engineer.\n\n"
        "Part specification:\n"
        f"- Material: {part.material or 'not specified'}\n"
        f"- Stated process: {part.process or 'not specified'}\n"
        f"- Tolerance: {part.tolerance or 'not specified'}\n"
        f"- Quantity: {part.qty or 'not specified'}\n"
        f"- Description: {(part.description or '')[:200]}\n\n"
        "What is the optimal manufacturing process for this part based on its "
        "material, tolerances, quantity, and geometry?\n"
        "Reply with 1-3 process names only, comma separated. No explanation. "
        "No punctuation other than commas.\n"
        "Examples: \"CNC Milling\" or \"Die Casting, CNC Milling\" or \"Injection Molding\""
    )
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            for attempt in range(1, 3):
                try:
                    response = await client.post(
                        url,
                        headers={"x-goog-api-key": api_key},
                        json={
                            "contents": [{"parts": [{"text": prompt}]}],
                            "generationConfig": {"temperature": 0.0, "maxOutputTokens": 30},
                        },
                    )
                    response.raise_for_status()
                    data = response.json()
                    raw = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                    processes = [p.strip() for p in raw.split(",") if p.strip()]
                    if processes:
                        _alog(
                            f"b2_infer layer=gemini part_id={part.id} "
                            f"raw='{raw}' parsed={processes}"
                        )
                        return processes
                except Exception as e:
                    err = str(e)
                    transient = any(x in err for x in ("429", "503", "quota", "rate", "unavailable"))
                    if attempt >= 2 or not transient:
                        raise
                    await asyncio.sleep(1)
    except Exception as e:
        _alog(f"b2_infer layer=gemini part_id={part.id} failed error={repr(str(e)[:120])}")
    return None


def _rules_infer_process(part: RFPPart) -> tuple[list[str], bool]:
    """
    Layer 2: Deterministic rule-based fallback for process inference.
    Returns (recommended_processes, is_confident).
    is_confident=True when rules give an unambiguous answer.
    Rules are ordered by priority: tolerance > material > geometry > quantity.
    """
    tol = _extract_smallest_tolerance_inches(part)
    material = _normalize_material(part.material or "").lower()
    desc = (part.description or "").lower()

    qty: int | None = None
    try:
        qty_raw = str(part.qty or "").strip()
        if qty_raw and re.fullmatch(r"\d+", qty_raw):
            qty = int(qty_raw)
    except Exception:
        pass

    _metals = ["aluminum", "steel", "stainless", "titanium", "brass", "copper",
               "inconel", "nickel", "alloy", "iron", "zinc", "magnesium", "cobalt"]
    _polymers = ["polymer", "plastic", "nylon", "abs", "pom", "peek",
                 "polycarbonate", "polyethylene", "polypropylene", "acrylic",
                 "pet", "pla", "ultem", "hdpe", "ptfe"]
    _rubber = ["rubber", "silicone", "elastomer", "urethane", "epdm"]
    _composite = ["composite", "cfrp", "carbon fiber", "carbon-fiber",
                  "fiberglass", "kevlar", "gfrp", "prepreg"]

    is_metal = any(m in material for m in _metals)
    is_polymer = any(m in material for m in _polymers)
    is_rubber = any(m in material for m in _rubber)
    is_composite = any(m in material for m in _composite)

    # ── 1. Tolerance (physics — overrides everything) ────────────────────────
    if tol is not None:
        if tol < 0.0005:
            return ["EDM", "Grinding"], True
        if tol < 0.005 and is_metal:
            rotational = any(k in desc for k in ["cylindrical", "shaft", "rotational", "diameter", "turned", "lathe"])
            return (["CNC Turning"] if rotational else ["CNC Milling"]), True

    # ── 2. Material ──────────────────────────────────────────────────────────
    if is_rubber:
        return ["Compression Molding", "Injection Molding"], True

    if is_composite:
        return ["Autoclave Layup", "RTM", "Filament Winding"], True

    if is_polymer:
        if qty and qty > 200:
            return ["Injection Molding"], True
        if qty and qty < 20:
            return ["FDM", "SLA", "3D Printing"], True
        return ["Injection Molding", "FDM"], False

    # ── 3. Geometry from description ─────────────────────────────────────────
    if any(k in desc for k in ["thin wall", "sheet metal", "sheet", "gauge", "enclosure", "blanked", "stamped"]):
        if tol is None or tol > 0.005:
            return ["Sheet Metal Fabrication", "Laser Cutting", "Press Brake Bending"], True

    if any(k in desc for k in ["cylindrical", "shaft", "rotational", "turned", "lathe"]):
        return ["CNC Turning"], True

    if any(k in desc for k in ["weld", "welded", "fabricated weld", "structural assembly"]):
        return ["MIG/TIG Welding", "SMAW Welding"], True

    if any(k in desc for k in ["extruded", "extrusion", "profile section"]):
        if is_metal:
            return ["Aluminum Extrusion"], True
        return ["Plastic Extrusion"], True

    if any(k in desc for k in ["complex geometry", "organic shape", "lattice", "internal channel", "conformal cooling"]):
        if qty and qty < 50 and is_metal:
            return ["DMLS", "SLM", "Metal 3D Printing"], True

    if any(k in desc for k in ["forged", "forging", "near net shape"]):
        return ["Closed Die Forging", "Open Die Forging"], True

    # ── 4. Quantity + material economics ─────────────────────────────────────
    if qty and is_metal:
        if qty < 10:
            return ["CNC Machining"], False
        if qty > 1000 and (tol is None or tol > 0.010):
            if any(m in material for m in ["aluminum", "zinc", "magnesium"]):
                return ["Die Casting"], True
            if any(m in material for m in ["steel", "iron"]):
                return ["Sand Casting", "Closed Die Forging"], True

    return [], False


async def _infer_recommended_processes(part: RFPPart) -> tuple[list[str], str]:
    """
    Orchestrator for B2 process inference.
    Returns (recommended_processes, source) where source is one of:
      "gemini" | "rules" | "rules_low_confidence" | "stated"
    source is logged here and never sent to the frontend or the supplier.

    Priority:
      1. Gemini  — reasons about economics, compatibility, volume, edge cases
      2. Rules   — deterministic, covers clear tolerance/material/qty cases
      3. Stated  — no correction, B2 behaves as it did before this feature
    """
    # Layer 1: Gemini
    gemini_result = await _gemini_infer_process(part)
    if gemini_result:
        _alog(f"b2_infer source=gemini part_id={part.id} recommended={gemini_result}")
        return gemini_result, "gemini"

    # Layer 2: Rules
    rules_result, is_confident = _rules_infer_process(part)
    if rules_result and is_confident:
        _alog(f"b2_infer source=rules part_id={part.id} recommended={rules_result}")
        return rules_result, "rules"
    if rules_result:
        _alog(f"b2_infer source=rules_low_confidence part_id={part.id} recommended={rules_result}")
        return rules_result, "rules_low_confidence"

    # Layer 3: Stated process (no correction)
    stated = _parse_process_tokens(part.process)
    _alog(f"b2_infer source=stated part_id={part.id} recommended={stated}")
    return stated, "stated"


def _parse_process_tokens(process_str: str) -> list[str]:
    tokens = re.split(r"[+,\u00b7/]", process_str or "")
    out: list[str] = []
    for raw in tokens:
        txt = (raw or "").strip()
        if not txt:
            continue
        # Ignore parser noise like "3" from "3/5-axis CNC machining".
        if re.fullmatch(r"\d+(?:\.\d+)?", txt):
            continue
        norm = _normalize_process(txt)
        if not norm:
            continue
        if re.fullmatch(r"\d+(?:\.\d+)?", norm):
            continue
        if len(norm) <= 1:
            continue
        out.append(norm)
    return out

def _fuzzy_match_process(required: str, process_counts: Counter) -> float:
    req_lower = _normalize_process(required)
    best = 0.0
    for key, count in process_counts.items():
        key_lower = _normalize_process(key)
        if req_lower in key_lower or key_lower in req_lower:
            job_weight = min(count / 5, 1.0)
            best = max(best, job_weight)
    return best


def _canonical_process(value: str) -> str:
    text = (value or "").lower()
    process_map = {
        "machining": ["machining", "cnc", "milling", "turning", "lathe", "drilling", "grinding", "edm"],
        "sheet_metal": ["sheet metal", "laser", "punch", "bending", "forming", "press brake", "stamping"],
        "joining": ["weld", "braz", "solder", "join"],
        "casting": ["cast", "die cast", "investment cast"],
        "forging": ["forge"],
        "additive": ["3d printing", "additive", "sls", "slm", "fdm", "dmls", "metal additive manufacturing", "metal 3d printing"],
        "finishing": ["deburr", "anod", "coat", "paint", "plating", "finish", "polish", "blast"],
        "assembly": ["assembly", "assemble"],
    }
    for canonical, keywords in process_map.items():
        if any(keyword in text for keyword in keywords):
            return canonical
    return ""


def _adjacent_process_fit(required: str, process_counts: Counter) -> float:
    required_family = _canonical_process(required)
    if not required_family:
        return 0.0

    total = 0.0
    for key, count in process_counts.items():
        if _canonical_process(key) == required_family:
            total = max(total, min(count / 4, 1.0))
    return total


def _expand_material_terms(value: str) -> list[str]:
    base = _normalize_material(value)
    if not base:
        return []
    out: list[str] = []

    def add(v: str):
        norm = _normalize_material(v)
        if norm and norm not in out:
            out.append(norm)

    add(base)
    raw = (value or "").lower()
    if "al 7075" in raw or "7075" in raw:
        add("aluminum 7075")
        add("7075 t6")
    if "al 6061" in raw or "6061" in raw:
        add("aluminum 6061")
        add("6061 t6")
    if "ti-6al-4v" in raw or "6al-4v" in raw or "grade 5" in raw:
        add("titanium grade 5")
        add("titanium 6al4v")
    if "stainless" in raw or "ss" in raw:
        add("stainless steel")
    if "nylon 12" in raw or "pa12" in raw:
        add("nylon 12")
        add("pa12")
    return out


def _material_fit(material: str, material_counts: Counter) -> float:
    targets = _expand_material_terms(material)
    if not targets or not material_counts:
        return 0.0

    best = 0.0
    for key, count in material_counts.items():
        compare = _normalize_material(key)
        if any(t in compare or compare in t for t in targets):
            best = max(best, min(count / 4, 1.0))
            continue
        # Fallback token-overlap to catch "al 7075" vs "aluminum 7075".
        c_tokens = {t for t in re.split(r"\s+", compare) if len(t) >= 2}
        for t in targets:
            t_tokens = {x for x in re.split(r"\s+", t) if len(x) >= 2}
            if not t_tokens or not c_tokens:
                continue
            overlap = len(t_tokens.intersection(c_tokens)) / max(len(t_tokens), 1)
            if overlap >= 0.5:
                best = max(best, min(count / 5, 1.0) * 0.8)
                break
    return best


def _extract_profile_process_tokens(row: dict) -> list[str]:
    tokens: list[str] = []
    for key in (
        "Process_Primary",
        "process_primary",
        "Process_Secondary",
        "process_secondary",
        "Process",
        "process",
        "process_p",
        "process_s",
        "process_c",
        "Machine_Process",
        "machine_process",
        "generic_process",
        "Generic_Process",
        "branded_process",
        "Branded_Process",
        "process_family",
        "Process_Family",
        "specialization_1",
        "specialization_2",
        "specialization_3",
        "Specialization_1",
        "Specialization_2",
        "Specialization_3",
        "equipment_generic_process",
        "Equipment_Generic_Process",
        "equipment_process_type",
        "Equipment_Process_Type",
        "family",
        "Family",
    ):
        raw = str(row.get(key) or "").strip()
        if not raw:
            continue
        for token in _parse_process_tokens(raw):
            if token and token not in tokens:
                tokens.append(token)
    return tokens


def _extract_profile_material_tokens(row: dict) -> list[str]:
    tokens: list[str] = []
    for key in (
        "Material",
        "material",
        "Material_Primary",
        "material_primary",
        "Material_Name",
        "material_name",
        "inference_material",
        "material_c",
        "material_r",
        "material_generic_name",
        "Material_Generic_Name",
        "material_family",
        "Material_Family",
        "material_class",
        "Material_Class",
        "material_type",
        "Material_Type",
        "class",
        "Class",
        "type",
        "Type",
    ):
        raw = str(row.get(key) or "").strip()
        if not raw:
            continue
        norm = _normalize_material(raw)
        if norm and norm not in tokens:
            tokens.append(norm)
    return tokens


def _extract_profile_tolerance_floor_inches(row: dict) -> Optional[float]:
    for key in (
        "Tolerance_Min",
        "tolerance_min",
        "Min_Tolerance",
        "min_tolerance",
        "Tolerance_Capability",
        "tolerance_capability",
        "Tolerance",
        "tolerance",
        "tolerance_",
    ):
        raw = row.get(key)
        if raw in (None, ""):
            continue
        txt = str(raw).strip().lower()
        nums = re.findall(r"\d+(?:\.\d+)?", txt)
        if not nums:
            continue
        try:
            val = float(nums[0])
        except Exception:
            continue
        if val <= 0:
            continue
        if "mm" in txt:
            val = val / 25.4
        return val
    return None


def _score_profile_metadata_match(
    part: RFPPart,
    profile_rows: list[dict],
    details_out: dict | None = None,
) -> Optional[float]:
    if not profile_rows:
        return None

    req_processes = _expand_process_terms(part.process)
    req_process_families = {f for f in (_canonical_process(p) for p in req_processes) if f}
    req_material_norm = _normalize_material(part.material)
    req_material_tokens = {t for t in re.split(r"\s+", req_material_norm) if len(t) >= 3}
    req_tol = _extract_smallest_tolerance_inches(part)
    best_row_score = 0.0
    best_components = {"process": 0.0, "material": 0.0, "tol": 0.0}
    # Track what matched in the best-scoring row for UI display
    best_profile_processes: list[str] = []   # ALL supplier profile processes (best row)
    best_profile_materials: list[str] = []   # ALL supplier profile materials (best row)
    best_matched_processes: list[str] = []   # subset that matched RFP requirement
    best_matched_materials: list[str] = []   # subset that matched RFP requirement
    any_matched_materials: list[str] = []    # aggregated across rows (for robust UI evidence)
    best_tol_capable: bool | None = None
    best_tol_floor: float | None = None

    for row in profile_rows:
        process_tokens = _extract_profile_process_tokens(row)
        material_tokens = _extract_profile_material_tokens(row)
        if not process_tokens and not material_tokens:
            continue

        process_counter = Counter({p: 1 for p in process_tokens})
        material_counter = Counter({m: 1 for m in material_tokens})

        if req_processes:
            process_exact = sum(_fuzzy_match_process(req, process_counter) for req in req_processes) / max(len(req_processes), 1)
            process_adj = sum(_adjacent_process_fit(req, process_counter) for req in req_processes) / max(len(req_processes), 1)
            process_score = min(1.0, (process_exact * 0.75) + (process_adj * 0.25))

            # If explicit fuzzy match is weak, still grant partial credit for
            # same process family / close wording to avoid over-penalizing.
            if process_score < 0.55 and process_tokens:
                row_families = {f for f in (_canonical_process(p) for p in process_tokens) if f}
                if req_process_families and row_families and req_process_families.intersection(row_families):
                    process_score = max(process_score, 0.65)
                else:
                    req_joined = " ".join(req_processes)
                    row_joined = " ".join(process_tokens)
                    if req_joined and row_joined and (req_joined in row_joined or row_joined in req_joined):
                        process_score = max(process_score, 0.55)
        else:
            process_score = 0.5

        material_score = _material_fit(part.material, material_counter) if material_counter else 0.0
        if material_score < 0.5 and req_material_tokens and material_tokens:
            row_material_tokens = set()
            for mt in material_tokens:
                row_material_tokens.update({t for t in re.split(r"\s+", _normalize_material(mt)) if len(t) >= 3})
            overlap = len(req_material_tokens.intersection(row_material_tokens))
            if overlap:
                overlap_ratio = overlap / max(len(req_material_tokens), 1)
                if overlap_ratio >= 0.5:
                    material_score = max(material_score, 0.75)
                elif overlap_ratio >= 0.25:
                    material_score = max(material_score, 0.55)

        # Capture material matches across all rows; the best overall row is often
        # selected by process and may not carry the strongest material evidence.
        row_matched_materials = [
            mt for mt in material_tokens
            if any(
                t in _normalize_material(mt) or _normalize_material(mt) in t
                for t in req_material_tokens
            )
        ] if req_material_tokens else list(material_tokens)
        for mt in row_matched_materials:
            if mt and mt not in any_matched_materials:
                any_matched_materials.append(mt)

        tol_floor = _extract_profile_tolerance_floor_inches(row)
        if req_tol is None:
            tol_score = 0.5
        elif tol_floor is None:
            tol_score = 0.5
        elif req_tol >= tol_floor:
            tol_score = 1.0
        elif req_tol >= (tol_floor * 0.8):
            tol_score = 0.7
        else:
            tol_score = 0.2

        row_score = (process_score * 0.45) + (material_score * 0.35) + (tol_score * 0.20)
        if row_score > best_row_score:
            best_row_score = row_score
            best_components = {
                "process": round(process_score, 3),
                "material": round(material_score, 3),
                "tol": round(tol_score, 3),
            }
            # ALL tokens from the best profile row (supplier's full capability set)
            best_profile_processes = list(process_tokens)
            best_profile_materials = list(material_tokens)
            # Subset that directly match a requirement — use simple substring/family
            # check, NOT _fuzzy_match_process which requires count>=5 to reach 0.5
            def _proc_matches_req(tok: str) -> bool:
                t = _normalize_process(tok)
                for req in req_processes:
                    r = _normalize_process(req)
                    if t and r and (t in r or r in t):
                        return True
                    ct, cr = _canonical_process(t), _canonical_process(r)
                    if ct and cr and ct == cr:
                        return True
                return False
            best_matched_processes = (
                [tok for tok in process_tokens if _proc_matches_req(tok)]
                if req_processes else list(process_tokens)
            )
            best_matched_materials = [
                mt for mt in material_tokens
                if any(
                    t in _normalize_material(mt) or _normalize_material(mt) in t
                    for t in req_material_tokens
                )
            ] if req_material_tokens else list(material_tokens)
            if req_tol is not None and tol_floor is not None:
                best_tol_capable = req_tol >= tol_floor
                best_tol_floor = tol_floor
            else:
                best_tol_capable = None
                best_tol_floor = tol_floor

    final_score = round(min(max(best_row_score * 100.0, 0.0), 100.0), 1)
    _alog(
        f"b1 metadata_match part_id={part.id or 'unknown'} rows={len(profile_rows)} "
        f"score={final_score} components={best_components}"
    )
    if details_out is not None:
        details_out["profile_processes"] = best_profile_processes
        details_out["profile_materials"] = best_profile_materials
        details_out["matched_processes"] = best_matched_processes
        details_out["required_processes"] = list(req_processes)
        details_out["matched_materials"] = any_matched_materials or best_matched_materials
        details_out["required_material"] = req_material_norm
        details_out["tolerance_capable"] = best_tol_capable
        details_out["required_tol_in"] = req_tol
        details_out["profile_tol_in"] = best_tol_floor
    return final_score


def _geometry_basis(
    part_image_b64: Optional[str],
    overall_image_b64: Optional[str],
    candidate_images_b64: Optional[list[str]],
) -> str:
    count = 0
    if (part_image_b64 or "").strip():
        count += 1
    if (overall_image_b64 or "").strip():
        count += 1
    count += len([img for img in (candidate_images_b64 or []) if (img or "").strip()])
    if count <= 0:
        return "text_only"
    if count == 1:
        return "single_view_image"
    return "multi_view_image"


def _extract_smallest_tolerance_inches(part: RFPPart) -> Optional[float]:
    src = f"{part.tolerance or ''} {part.description or ''}".lower()
    if not src.strip():
        return None

    vals = []

    # Accept only explicit tolerance patterns:
    # 1) signed tolerance: +/-0.001, ±0.002 (unit optional)
    # 2) unit-tagged value: 0.005", 0.05 mm
    tol_pattern = r"(?:(?:\+/-|\+-)\s*(\d+(?:\.\d+)?)\s*(mm|in|inch|inches|\")?|(\d+(?:\.\d+)?)\s*(mm|in|inch|inches|\"))"
    for m in re.finditer(tol_pattern, src):
        try:
            raw_val = m.group(1) or m.group(3)
            v = float(raw_val)
        except Exception:
            continue
        unit = (m.group(2) or m.group(4) or "").strip()
        if v <= 0:
            continue
        if unit == "mm":
            vals.append(v / 25.4)
        else:
            vals.append(v)

    if not vals:
        return None
    return min(vals)


def _is_post_process(proc: str) -> bool:
    p = _normalize_process(proc)
    markers = ("grinding", "od grinding", "lap", "honing", "polish", "deburr", "finish")
    return any(marker in p for marker in markers)


def _estimate_precision_floor_inches(processes: set[str], has_post_process: bool) -> float:
    floor = 0.01  # conservative fallback
    for p in processes:
        proc = _normalize_process(p)
        if "edm" in proc:
            floor = min(floor, 0.0004)
        elif "grinding" in proc or "honing" in proc or "lap" in proc:
            floor = min(floor, 0.0005)
        elif "turning" in proc or "milling" in proc or "cnc" in proc:
            floor = min(floor, 0.0015)
        elif "sheet metal" in proc:
            floor = min(floor, 0.005)
        elif "3d printing" in proc:
            floor = min(floor, 0.01)
    if has_post_process:
        floor *= 0.7
    return max(0.0002, floor)


def _extract_largest_dimension_inches(part: RFPPart) -> Optional[float]:
    src = f"{part.description or ''} {part.tolerance or ''}".lower()
    if not src.strip():
        return None
    vals = []
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*(mm|in|inch|inches|\")", src):
        try:
            v = float(m.group(1))
        except Exception:
            continue
        unit = (m.group(2) or "").strip()
        vals.append(v / 25.4 if unit == "mm" else v)
    if not vals:
        return None
    return max(vals)


def _infer_machine_envelope_inches(rows: list[dict]) -> Optional[float]:
    keys = (
        "Machine_Max_Dimension",
        "machine_max_dimension",
        "Work_Envelope_Max",
        "work_envelope_max",
        "Max_Part_Size",
        "max_part_size",
    )
    vals = []
    for row in rows:
        for k in keys:
            raw = row.get(k)
            if raw in (None, ""):
                continue
            txt = str(raw).strip().lower()
            nums = re.findall(r"\d+(?:\.\d+)?", txt)
            if not nums:
                continue
            v = float(nums[0])
            if "mm" in txt:
                v = v / 25.4
            vals.append(v)
    if not vals:
        return None
    return max(vals)


def _count_machine_envelope_evidence(rows: list[dict]) -> int:
    keys = (
        "Machine_Max_Dimension",
        "machine_max_dimension",
        "Work_Envelope_Max",
        "work_envelope_max",
        "Max_Part_Size",
        "max_part_size",
    )
    count = 0
    for row in rows:
        has_value = False
        for k in keys:
            raw = row.get(k)
            if raw in (None, ""):
                continue
            txt = str(raw).strip().lower()
            if re.search(r"\d+(?:\.\d+)?", txt):
                has_value = True
                break
        if has_value:
            count += 1
    return count


def evaluate_feasibility_gate(part: RFPPart, supplier_id: str, supplier_name: Optional[str]) -> dict:
    reasons: list[str] = []
    dependency_tags: list[str] = []
    status = "pass"

    history_rows = _fetch_supplier_history_rows(supplier_id, supplier_name)
    profile_rows = _fetch_supplier_profile_rows(supplier_id)
    all_rows = [*history_rows, *profile_rows]
    corpus_evidence = len(all_rows)

    process_set: set[str] = set()
    material_counts: Counter = Counter()
    for row in all_rows:
        for token in _extract_profile_process_tokens(row):
            if token:
                process_set.add(token)
        for material in _extract_profile_material_tokens(row):
            if material:
                material_counts[material] += 1
    process_counter = Counter({p: 1 for p in process_set})
    envelope_evidence = _count_machine_envelope_evidence(profile_rows)

    _alog(
        f"gate_evidence supplier_id={supplier_id} part_id={part.id} corpus_rows={corpus_evidence} "
        f"history_rows={len(history_rows)} profile_rows={len(profile_rows)} "
        f"process_tokens={len(process_set)} material_tokens={len(material_counts)} "
        f"envelope_rows={envelope_evidence}"
    )

    # Gate hardening policy:
    # - hard_fail only for high-confidence impossible conditions
    # - all ambiguous/estimative mismatches should be conditional_pass + dependencies
    required_processes = _expand_process_terms(part.process)
    if required_processes:
        # Expanded process terms are alternatives/synonyms for the same request.
        # Gate should fail only when *none* of the expanded terms match corpus evidence.
        best_process_fit = 0.0
        for req in required_processes:
            fit = max(_fuzzy_match_process(req, process_counter), _adjacent_process_fit(req, process_counter))
            best_process_fit = max(best_process_fit, fit)
        if best_process_fit <= 0.0:
            requested_display = ", ".join(_parse_process_tokens(part.process)) or (part.process or "unknown process")
            # Process mismatch should not block full assessment:
            # similar parts can be manufacturable via alternate processes.
            # Keep it as conditional pass and let B1/B2/C score the evidence.
            status = "conditional_pass"
            reasons.append(f"Requested process not found in current corpus: {requested_display}")
            dependency_tags.append("process_validation_required")
            dependency_tags.append("alternate_process_review_required")

    material_fit = _material_fit(part.material, material_counts)
    if status != "hard_fail" and (part.material or "").strip() and material_fit < 0.25:
        status = "conditional_pass"
        reasons.append("Requested material not seen in supplier history/profile.")
        dependency_tags.append("material_procurement_required")

    has_post = any(_is_post_process(p) for p in process_set)
    req_tol = _extract_smallest_tolerance_inches(part)
    if status != "hard_fail" and req_tol is not None:
        floor = _estimate_precision_floor_inches(process_set, has_post_process=False)
        # Guard against parser-induced ultra-tight tolerance artifacts.
        if req_tol < 0.0002:
            status = "conditional_pass"
            reasons.append(
                f"Parsed tolerance is extremely tight ({req_tol:.6f} in); manual validation recommended."
            )
            dependency_tags.append("tolerance_parse_review_required")
        elif req_tol < floor:
            if has_post and req_tol >= (floor * 0.5):
                status = "conditional_pass"
                reasons.append("Tolerance may require post-process steps.")
                dependency_tags.append("post_process_required")
            else:
                status = "conditional_pass"
                reasons.append(f"Tolerance may be below current process floor estimate ({req_tol:.4f} in).")
                dependency_tags.append("tolerance_validation_required")

    largest_dim = _extract_largest_dimension_inches(part)
    envelope = _infer_machine_envelope_inches(profile_rows)
    if status != "hard_fail" and largest_dim is not None and envelope is not None and largest_dim > (envelope * 1.05):
        # Treat size as a hard blocker only on very high-confidence envelope breach.
        if envelope_evidence >= 3 and largest_dim > (envelope * 1.5):
            status = "hard_fail"
            reasons.append(f"Part size likely exceeds machine envelope ({largest_dim:.2f} in > {envelope:.2f} in).")
        else:
            status = "conditional_pass"
            reasons.append(f"Part size may exceed machine envelope ({largest_dim:.2f} in vs {envelope:.2f} in).")
            dependency_tags.append("size_validation_required")

    return {
        "gate_status": status,
        "gate_reasons": reasons,
        "dependency_tags": sorted(set(dependency_tags)),
    }


def _infer_part_family(part: RFPPart) -> str:
    text = f"{part.description} {part.process}".lower()
    family_map = {
        "bracket": ["bracket", "mount", "support"],
        "plate": ["plate", "panel"],
        "shaft": ["shaft", "pin", "axle", "rod"],
        "housing": ["housing", "enclosure", "casing", "cover"],
        "fastener": ["bolt", "nut", "screw", "fastener"],
        "sheet_metal": ["sheet", "chassis", "formed", "bent"],
    }
    for family, keywords in family_map.items():
        if any(keyword in text for keyword in keywords):
            return family
    return ""


def _family_fit(family_hint: str, family_counts: Counter) -> float:
    if not family_hint or not family_counts:
        return 0.0

    best = 0.0
    for key, count in family_counts.items():
        compare = _normalize_material(key)
        if family_hint in compare or compare in family_hint:
            best = max(best, min(count / 3, 1.0))
    return best


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, float(v)))


def _estimate_image_quality(pil_img) -> float:
    """
    Lightweight quality heuristic in [0, 1]:
    combines resolution, brightness balance, contrast, and sharpness.
    """
    import numpy as np

    w, h = pil_img.size
    gray = np.array(pil_img.convert("L"), dtype=np.float32)

    # Resolution score: saturates around ~900x900.
    res_score = _clamp01(((w * h) ** 0.5) / 900.0)

    mean_l = float(gray.mean()) / 255.0
    std_l = float(gray.std()) / 64.0

    # Best when not too dark/bright.
    brightness_score = _clamp01(1.0 - abs(mean_l - 0.5) / 0.5)
    contrast_score = _clamp01(std_l)

    # Sharpness proxy via gradient magnitude.
    gy, gx = np.gradient(gray)
    grad_mag = np.sqrt(gx * gx + gy * gy)
    sharp_score = _clamp01(float(np.percentile(grad_mag, 75)) / 25.0)

    quality = (
        (res_score * 0.30)
        + (brightness_score * 0.20)
        + (contrast_score * 0.20)
        + (sharp_score * 0.30)
    )
    return round(_clamp01(quality), 3)


def _local_image_file_exists(filename: str) -> bool:
    if not filename:
        return False

    candidates: list[Path] = []
    ingestion_path = os.getenv("INGESTION_PATH", "").strip()
    if ingestion_path:
        candidates.append(Path(ingestion_path) / "stored_parts")
    candidates.extend(
        [
            Path("stored_parts"),
            Path("Past projects v2") / "stored_parts",
            Path("Past projects new version") / "stored_parts",
        ]
    )

    basename = str(filename).replace("\\", "/").split("/")[-1].strip()
    if not basename:
        return False

    for folder in candidates:
        if folder.is_dir() and (folder / basename).is_file():
            return True
    return False


def _topk_weighted_score(similarities: list[float], weights: list[float]) -> float:
    if not similarities:
        return 0.0
    ordered = sorted((max(0.0, float(s)) for s in similarities), reverse=True)
    total = 0.0
    for i, w in enumerate(weights):
        if i < len(ordered):
            total += ordered[i] * w
    return min(100.0, round(total * 100.0, 1))


def _parse_weight_vector(raw: str, default: list[float]) -> list[float]:
    text = str(raw or "").strip()
    if not text:
        return default
    try:
        vals = [float(x.strip()) for x in text.split(",") if x.strip()]
        if not vals:
            return default
        s = sum(v for v in vals if v > 0)
        if s <= 0:
            return default
        return [max(0.0, v) / s for v in vals]
    except Exception:
        return default


def _topk_consistency_score(similarities: list[float]) -> float:
    """
    Smoother top-k score that reduces top-1 dominance:
    - weighted top-k component
    - mean top-k component
    - consistency factor based on tail/top1 ratio
    """
    ordered = sorted((max(0.0, float(s)) for s in similarities), reverse=True)
    if not ordered:
        return 0.0

    k = min(5, len(ordered))
    topk = ordered[:k]
    weights = _parse_weight_vector(
        os.getenv("C_TOPK_WEIGHTS", "").strip(),
        [0.45, 0.25, 0.15, 0.10, 0.05],
    )[:k]
    if len(weights) < k:
        rem = k - len(weights)
        weights.extend([0.0] * rem)
        s = sum(weights)
        weights = [w / s for w in weights] if s > 0 else [1.0 / k] * k

    weighted = sum(topk[i] * weights[i] for i in range(k))
    mean_topk = sum(topk) / float(k)
    base = (weighted * 0.8) + (mean_topk * 0.2)

    if k >= 3 and topk[0] > 0:
        tail_mean = sum(topk[1:]) / float(k - 1)
        tail_ratio = _clamp01(tail_mean / topk[0])
        consistency = 0.90 + (0.20 * tail_ratio)  # 0.90 .. 1.10
    else:
        consistency = 1.0

    return min(100.0, round(base * consistency * 100.0, 1))


def _top3_primary_score(similarities: list[float]) -> float:
    """
    Top-match primary historical scoring:
    - top1 drives score most (default 70%)
    - top2/top3 provide context (20%/10%)
    - with <3 matches, weights are ratio-normalized across available matches
    """
    ordered = sorted((max(0.0, float(s)) for s in similarities), reverse=True)
    if not ordered:
        return 0.0

    topn = ordered[:3]
    weights = _parse_weight_vector(
        os.getenv("C_TOP3_PRIMARY_WEIGHTS", "").strip(),
        [0.70, 0.20, 0.10],
    )[: len(topn)]
    weight_sum = sum(weights)
    if weight_sum <= 0:
        weights = [1.0 / float(len(topn))] * len(topn)
    else:
        weights = [w / weight_sum for w in weights]
    blended = sum(sim * weights[idx] for idx, sim in enumerate(topn))
    return min(100.0, round(blended * 100.0, 1))


def _pick_meta_local(data: dict, *keys: str):
    if not isinstance(data, dict):
        return ""
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    lower_map = {str(k).lower(): v for k, v in data.items()}
    for key in keys:
        value = lower_map.get(str(key).lower())
        if value not in (None, ""):
            return value
    return ""


def _outcome_multiplier(outcome_text: str) -> float:
    text = (outcome_text or "").strip().lower()
    if not text:
        return 1.00

    positive_terms = (
        "won",
        "success",
        "delivered",
        "approved",
        "on time",
        "repeat order",
        "accepted",
        "pass",
    )
    negative_terms = (
        "lost",
        "fail",
        "failed",
        "scrap",
        "rejected",
        "ncr",
        "non conformance",
        "rework",
        "late",
        "cancel",
    )

    if any(term in text for term in negative_terms):
        return 0.82
    if any(term in text for term in positive_terms):
        return 1.08
    return 1.00


def _token_overlap_ratio(a: str, b: str) -> float:
    ta = {t for t in re.split(r"\s+", (a or "").strip()) if len(t) >= 2}
    tb = {t for t in re.split(r"\s+", (b or "").strip()) if len(t) >= 2}
    if not ta or not tb:
        return 0.0
    return len(ta.intersection(tb)) / float(max(len(ta), len(tb), 1))


def _feedback_multiplier_from_meta(meta: dict) -> float:
    """
    Optional metadata-level multiplier in [0.95, 1.05].
    Defaults to neutral when no feedback signal exists in metadata.
    """
    if not isinstance(meta, dict):
        return 1.0

    # Pre-computed feedback signal from supplier RFP assessment subforms.
    raw_mult = _pick_meta_local(meta, "feedback_multiplier", "Feedback_Multiplier")
    try:
        if raw_mult not in (None, ""):
            return max(0.95, min(1.05, float(raw_mult)))
    except Exception:
        pass

    # Direct numeric feedback score path (0..100 expected).
    raw_score = _pick_meta_local(meta, "feedback_score", "Feedback_Score", "user_score", "User_Score")
    try:
        if raw_score not in (None, ""):
            val = float(raw_score)
            # Center at 50; cap impact to +/- 5%
            shift = max(-0.05, min(0.05, (val - 50.0) / 1000.0))
            return round(1.0 + shift, 3)
    except Exception:
        pass

    # Categorical rating fallback.
    raw_rating = str(_pick_meta_local(meta, "user_rating", "User_Rating", "feedback_rating", "Feedback_Rating") or "").strip().lower()
    if raw_rating in {"correct", "high", "good", "useful"}:
        return 1.03
    if raw_rating in {"incorrect", "bad", "not_useful", "irrelevant"}:
        return 0.97
    return 1.0


def _metadata_to_details(meta: dict) -> dict[str, str]:
    if not isinstance(meta, dict):
        return {}

    out: dict[str, str] = {}
    for key, value in meta.items():
        if value in (None, ""):
            continue
        try:
            if isinstance(value, (dict, list, tuple, set)):
                text = json.dumps(value, ensure_ascii=False)
            else:
                text = str(value).strip()
        except Exception:
            continue
        if not text:
            continue
        out[str(key)] = text
    return out


def _is_positive_feedback_rating(raw: str) -> bool:
    text = (raw or "").strip().lower()
    return text in {"correct", "high", "good", "useful", "relevant", "exact"}


def _is_negative_feedback_rating(raw: str) -> bool:
    text = (raw or "").strip().lower()
    return text in {"incorrect", "bad", "not_useful", "irrelevant", "partial", "low", "wrong"}


def _build_feedback_signal_map_from_rows(rows: list[dict]) -> dict[str, dict]:
    buckets: dict[str, dict] = {}
    for row in rows:
        for sr in list(row.get("Similar_Past_Projects") or []):
            vec_id = str(sr.get("Pinecone_Vector_ID") or "").strip()
            if not vec_id:
                continue
            b = buckets.setdefault(
                vec_id,
                {
                    "n": 0,
                    "pos": 0,
                    "neg": 0,
                    "scores": [],
                },
            )
            b["n"] += 1
            rating = str(sr.get("User_Rating") or "").strip()
            if _is_positive_feedback_rating(rating):
                b["pos"] += 1
            elif _is_negative_feedback_rating(rating):
                b["neg"] += 1
            try:
                raw_score = sr.get("User_Score")
                if raw_score not in (None, ""):
                    b["scores"].append(float(raw_score))
            except Exception:
                pass

    out: dict[str, dict] = {}
    for vec_id, b in buckets.items():
        n = int(b.get("n", 0) or 0)
        pos = int(b.get("pos", 0) or 0)
        neg = int(b.get("neg", 0) or 0)
        scores = [float(v) for v in (b.get("scores") or [])]

        score_shift = 0.0
        if scores:
            avg_score = sum(scores) / float(len(scores))
            score_shift = max(-0.05, min(0.05, (avg_score - 50.0) / 1000.0))
        else:
            avg_score = None

        rating_shift = max(-0.04, min(0.04, (pos - neg) * 0.01))
        mult = max(0.95, min(1.05, 1.0 + score_shift + rating_shift))
        out[vec_id] = {
            "feedback_multiplier": round(mult, 3),
            "feedback_samples": n,
            "feedback_positive": pos,
            "feedback_negative": neg,
            "feedback_score": (round(avg_score, 2) if avg_score is not None else None),
            "feedback_source": "zoho_subform",
        }
    return out


def _get_supplier_feedback_signal_map(supplier_id: str) -> dict[str, dict]:
    sid = (supplier_id or "").strip()
    if not sid:
        return {}

    ttl_sec = int(_env_float("C_FEEDBACK_CACHE_TTL_SEC", 180.0))
    now = time.time()
    cached = _SUPPLIER_FEEDBACK_SIGNAL_CACHE.get(sid)
    if cached and (now - float(cached.get("ts", 0.0))) <= ttl_sec:
        return dict(cached.get("data") or {})

    rows: list[dict] = []
    try:
        import requests
        from auth.zoho_auth import zoho_headers

        # List + local filter keeps this robust across scope differences.
        resp = requests.get(
            "https://www.zohoapis.com/crm/v2/RFP_Assessments",
            headers=zoho_headers(),
            params={"per_page": 200, "page": 1},
            timeout=8,
        )
        if resp.status_code == 200:
            for row in resp.json().get("data", []) or []:
                lookup = row.get("Supplier_Name")
                row_sid = ""
                if isinstance(lookup, dict):
                    row_sid = str(lookup.get("id") or "").strip()
                elif isinstance(lookup, str):
                    row_sid = lookup.strip()
                if row_sid == sid:
                    rows.append(row)
    except Exception as e:
        _alog(f"feedback_signal_fetch_failed supplier_id={sid} error={e}")
        _SUPPLIER_FEEDBACK_SIGNAL_CACHE[sid] = {"ts": now, "data": {}}
        return {}

    signal_map = _build_feedback_signal_map_from_rows(rows)
    _SUPPLIER_FEEDBACK_SIGNAL_CACHE[sid] = {"ts": now, "data": signal_map}
    _alog(
        f"feedback_signal_map supplier_id={sid} assessments={len(rows)} "
        f"vectors={len(signal_map)}"
    )
    return signal_map


def _confidence_from_matches(
    part: RFPPart,
    fused_sorted: list[float],
    matches_count: int,
    image_quality: float,
    has_image: bool,
) -> tuple[float, str]:
    top1 = fused_sorted[0] if fused_sorted else 0.0
    top2 = fused_sorted[1] if len(fused_sorted) > 1 else 0.0
    gap = max(0.0, top1 - top2)

    # Data completeness for the part spec itself.
    completeness = 0.0
    completeness += 1.0 if (part.material or "").strip() else 0.0
    completeness += 1.0 if (part.process or "").strip() else 0.0
    completeness += 1.0 if (part.description or "").strip() else 0.0
    completeness += 1.0 if (part.tolerance or "").strip() else 0.0
    completeness /= 4.0

    score = (
        20.0
        + (top1 * 40.0)
        + (gap * 20.0)
        + (min(matches_count, 10) / 10.0) * 10.0
        + (completeness * 20.0)
        + ((image_quality * 10.0) if has_image else 5.0)
    )
    score = round(min(score, 100.0), 1)
    band = "high" if score >= 75 else "medium" if score >= 55 else "low"
    return score, band


async def score_c(
    part: RFPPart,
    supplier_id: str,
    supplier_name: Optional[str] = None,
    part_image_b64: Optional[str] = None,
    overall_image_b64: Optional[str] = None,
    candidate_images_b64: Optional[list[str]] = None,
) -> tuple[Optional[float], list[MatchedJob], dict]:
    """
    Searches supplier past projects across direct Pinecone history records
    and Zoho-linked vector IDs, then scores against the part.
    """
    import base64
    import hashlib
    import io

    import numpy as np
    from PIL import Image

    from assessment.zoho_projects import fetch_supplier_past_projects

    index = get_historical_projects_index()
    feedback_signal_map = _get_supplier_feedback_signal_map(supplier_id)
    _alog(
        f"score_c start part_id={part.id} supplier_id={supplier_id} "
        f"part_image={bool((part_image_b64 or '').strip())} "
        f"overall_image={bool((overall_image_b64 or '').strip())} "
        f"candidate_images={len(candidate_images_b64 or [])}"
    )

    query_vectors: list[tuple[list[float], str, float]] = []
    seen_images = set()
    best_image_quality = 0.0
    embedder_backend = os.getenv("EMBEDDER_BACKEND", "clip").strip().lower()
    text_signal_mode = os.getenv("ENABLE_HISTORY_TEXT_SIGNAL", "auto").strip().lower()
    if text_signal_mode in {"1", "true", "yes", "on"}:
        text_signal_enabled = True
    elif text_signal_mode in {"0", "false", "no", "off"}:
        text_signal_enabled = False
    else:
        # Auto: keep text blend for CLIP space, disable for EfficientNet trials.
        text_signal_enabled = embedder_backend.startswith("clip")

    for raw in [part_image_b64, overall_image_b64] + list(candidate_images_b64 or []):
        image_b64 = (raw or "").strip()
        if not image_b64 or image_b64 in seen_images:
            continue
        seen_images.add(image_b64)
        try:
            img_bytes = base64.b64decode(image_b64)
            pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            vector = compute_clip_embedding_from_pil(pil_img)
            if vector is not None:
                q = _estimate_image_quality(pil_img)
                best_image_quality = max(best_image_quality, q)
                query_vectors.append((vector, "image", q))
        except Exception as e:
            print(f"  Image embed failed for {part.id}: {e}")

    _alog(
        f"score_c image_embed_summary part_id={part.id} supplier_id={supplier_id} "
        f"unique_images={len(seen_images)} image_query_vectors={sum(1 for _, m, _ in query_vectors if m == 'image')} "
        f"best_image_quality={round(best_image_quality,3)}"
    )

    if not query_vectors:
        query_text = f"{part.material} {part.process} {part.description}"
        vector = compute_clip_text_embedding(query_text)
        if vector is None:
            print(f"  [C] Text embed unavailable for {part.id} - skipping C score")
            _alog(f"score_c skip part_id={part.id} reason=no_image_and_no_text_vector")
            return None, [], {
                "c_text": None,
                "c_img": None,
                "image_quality": 0.0,
                "image_weight": 0.0,
                "match_confidence_score": 0.0,
                "match_confidence": "low",
            }
        query_vectors.append((vector, "text", 0.0))
        print(f"  Using CLIP text embedding for {part.id}")
    else:
        print(f"  Using {len(query_vectors)} image embedding(s) for {part.id}")
        if text_signal_enabled:
            text_vec = compute_clip_text_embedding(f"{part.material} {part.process} {part.description}")
            if text_vec is not None:
                query_vectors.append((text_vec, "text", 0.0))

    _alog(
        f"score_c query_mix part_id={part.id} supplier_id={supplier_id} "
        f"embedder_backend={embedder_backend} text_signal_enabled={text_signal_enabled} "
        f"image_queries={sum(1 for _, m, _ in query_vectors if m == 'image')} "
        f"text_queries={sum(1 for _, m, _ in query_vectors if m == 'text')}"
    )

    has_image_queries = any(mode == "image" for _, mode, _ in query_vectors)
    if has_image_queries:
        # Adaptive image-forward weighting.
        # If text signal is disabled (EfficientNet trial), heavily favor image evidence.
        if text_signal_enabled:
            image_weight = 0.40 + (0.45 * best_image_quality)
            if best_image_quality >= 0.50:
                image_weight = max(image_weight, 0.62)
            image_weight = min(image_weight, 0.85)
        else:
            image_weight = 0.75 + (0.20 * best_image_quality)
            image_weight = min(image_weight, 0.95)
    else:
        image_weight = 0.0
    text_weight = 1.0 - image_weight
    _alog(
        f"score_c weights part_id={part.id} supplier_id={supplier_id} "
        f"image_weight={round(image_weight,3)} text_weight={round(text_weight,3)}"
    )

    scored_by_id: dict[str, dict] = {}
    if supplier_name:
        print(
            f"  Querying Pinecone history for zoho_id={supplier_id} "
            f"and supplier_name variants={_supplier_name_variants(supplier_name)}"
        )

    direct_matches_count = 0
    direct_unique_ids: set[str] = set()
    for query_vector, mode, _q in query_vectors:
        direct_matches = _query_supplier_history(
            index, query_vector, supplier_id, supplier_name, top_k=20
        )
        direct_matches_count += len(direct_matches)
        for dm in direct_matches:
            direct_unique_ids.add(dm.id)
        for match in direct_matches:
            existing = scored_by_id.get(match.id)
            sim = float(match.score)
            feedback_meta = feedback_signal_map.get(match.id) or {}
            merged_meta = dict(match.metadata or {})
            if feedback_meta:
                merged_meta.update({k: v for k, v in feedback_meta.items() if v not in (None, "")})
            if not existing:
                existing = {
                    "metadata": merged_meta,
                    "sim_text": 0.0,
                    "sim_img": 0.0,
                }
                scored_by_id[match.id] = existing
            if mode == "image":
                existing["sim_img"] = max(existing["sim_img"], sim)
            else:
                existing["sim_text"] = max(existing["sim_text"], sim)
            if not existing.get("metadata"):
                existing["metadata"] = merged_meta
            job_material = _pick_meta(merged_meta, "Material", "material", "Material_Primary", "material_primary", "raw_material", "inference_material", "material_c", "material_r")
            material_overlap = _token_overlap_ratio(_normalize_material(part.material or ""), _normalize_material(job_material or ""))
            existing["sim_material"] = max(existing.get("sim_material", 0.0), material_overlap)
    print(
        f"  Direct Pinecone history matches for {supplier_id}: "
        f"unique={len(direct_unique_ids)}, retrieved={direct_matches_count}"
    )
    _alog(
        f"score_c direct_history part_id={part.id} supplier_id={supplier_id} "
        f"unique={len(direct_unique_ids)} retrieved={direct_matches_count}"
    )

    def _history_text_for_row(row: dict) -> str:
        fields = [
            _pick_meta(row, "Material", "material", "inference_material", "material_c", "material_r", "material_name"),
            _pick_meta(row, "Process_Primary", "process_primary", "process_p", "Process", "process", "process_secondary"),
            _pick_meta(row, "Part_Family", "part_family", "part_type", "part_name"),
            _pick_meta(row, "Name", "Project_Name", "project_name", "project"),
            _pick_meta(row, "Outcome", "outcome"),
            _pick_meta(row, "Features", "features"),
        ]
        return " ".join(str(f).strip() for f in fields if f).strip()

    def _history_row_key(row: dict, text: str) -> str | None:
        vec_id = str(_pick_meta(row, "Pinecone_Vector_ID", "pinecone_vector_id") or "").strip()
        if vec_id:
            return vec_id
        if not text:
            return None
        return "zoho:" + hashlib.sha1(text.encode("utf-8")).hexdigest()

    rows = fetch_supplier_past_projects(supplier_id)
    vector_ids = [
        row.get("Pinecone_Vector_ID")
        for row in rows
        if row.get("Pinecone_Vector_ID")
    ]
    stored_vectors = {}
    if vector_ids:
        try:
            fetch_result = index.fetch(ids=vector_ids)
            stored_vectors = fetch_result.vectors
        except Exception as e:
            print(f"  Pinecone fetch by ID failed: {e}")
            stored_vectors = {}

    fallback_rows: list[tuple[str, dict, np.ndarray]] = []
    for row in rows:
        row_text = _history_text_for_row(row)
        row_key = _history_row_key(row, row_text)
        if not row_key:
            continue
        if row_key in stored_vectors:
            continue
        row_vec = compute_clip_text_embedding(row_text)
        if row_vec is None:
            continue
        fallback_rows.append((row_key, row, np.array(row_vec)))

    for query_vector, mode, _q in query_vectors:
        q = np.array(query_vector)
        for vec_id, vec_data in stored_vectors.items():
            v = np.array(vec_data.values)
            similarity = float(np.dot(q, v))
            existing = scored_by_id.get(vec_id)
            feedback_meta = feedback_signal_map.get(vec_id) or {}
            merged_meta = dict(vec_data.metadata or {})
            if feedback_meta:
                merged_meta.update({k: v for k, v in feedback_meta.items() if v not in (None, "")})
            if not existing:
                existing = {"metadata": merged_meta, "sim_text": 0.0, "sim_img": 0.0}
                scored_by_id[vec_id] = existing
            if mode == "image":
                existing["sim_img"] = max(existing["sim_img"], similarity)
            else:
                existing["sim_text"] = max(existing["sim_text"], similarity)
            if not existing.get("metadata"):
                existing["metadata"] = merged_meta
            job_material = _pick_meta(merged_meta, "Material", "material", "Material_Primary", "material_primary", "raw_material", "inference_material", "material_c", "material_r")
            material_overlap = _token_overlap_ratio(_normalize_material(part.material or ""), _normalize_material(job_material or ""))
            existing["sim_material"] = max(existing.get("sim_material", 0.0), material_overlap)

        for row_key, row, row_vec in fallback_rows:
            similarity = float(np.dot(q, row_vec))
            existing = scored_by_id.get(row_key)
            row_vec_id = str(_pick_meta(row, "Pinecone_Vector_ID", "pinecone_vector_id") or "").strip()
            feedback_meta = feedback_signal_map.get(row_vec_id) or {}
            merged_meta = dict(row or {})
            if feedback_meta:
                merged_meta.update({k: v for k, v in feedback_meta.items() if v not in (None, "")})
            if not existing:
                existing = {"metadata": merged_meta, "sim_text": 0.0, "sim_img": 0.0}
                scored_by_id[row_key] = existing
            if mode == "image":
                existing["sim_img"] = max(existing["sim_img"], similarity)
            else:
                existing["sim_text"] = max(existing["sim_text"], similarity)
            if not existing.get("metadata"):
                existing["metadata"] = merged_meta
            job_material = _pick_meta(merged_meta, "Material", "material", "Material_Primary", "material_primary", "raw_material", "inference_material", "material_c", "material_r")
            material_overlap = _token_overlap_ratio(_normalize_material(part.material or ""), _normalize_material(job_material or ""))
            existing["sim_material"] = max(existing.get("sim_material", 0.0), material_overlap)

    if not scored_by_id:
        print(f"  No supplier history matches found in Zoho or Pinecone for {supplier_id}")
        _alog(f"score_c done part_id={part.id} supplier_id={supplier_id} c_score=None matches=0")
        return None, [], {
            "c_text": 0.0,
            "c_img": 0.0,
            "c_material": 0.0,
            "image_quality": round(best_image_quality, 3),
            "image_weight": round(image_weight, 3),
            "match_confidence_score": 0.0,
            "match_confidence": "low",
        }

    scored = []
    text_sims = []
    img_sims = []
    material_sims = []
    base_fused_sims = []
    outcome_adjusted = 0
    outcome_positive = 0
    outcome_negative = 0
    feedback_adjusted = 0
    for vec_id, payload in scored_by_id.items():
        sim_text = float(payload.get("sim_text", 0.0))
        sim_img = float(payload.get("sim_img", 0.0))
        sim_material = float(payload.get("sim_material", 0.0))
        if sim_text > 0 and sim_img > 0:
            fused_base = (text_weight * sim_text) + (image_weight * sim_img)
        elif sim_text > 0:
            fused_base = sim_text
        elif sim_img > 0:
            # Keep image-only hits but slightly conservative.
            fused_base = sim_img * max(0.65, image_weight)
        else:
            fused_base = 0.0

        if not has_image_queries:
            meta = payload.get("metadata") or {}
            job_process = _pick_meta(
                meta,
                "Process_Primary", "process_primary", "Process", "process",
                "Process_Secondary", "process_secondary", "process_p", "process_s", "process_c"
            )
            process_overlap = _token_overlap_ratio(
                _normalize_process(" ".join(_expand_process_terms(part.process or ""))),
                _normalize_process(job_process or "")
            )
            # Fallback mechanism using Pinecone metadata when CAD/image is missing
            metadata_score = (sim_material * 0.5) + (process_overlap * 0.5)
            fused_base = max(fused_base, metadata_score)

        fused_base = fused_base * (0.95 + 0.05 * sim_material)

        fused = fused_base
        base_fused_sims.append(fused_base)

        outcome_val = str(
            _pick_meta_local(
                payload.get("metadata") or {},
                "Outcome",
                "outcome",
                "Job_Outcome",
                "job_outcome",
                "Result",
                "result",
            )
            or ""
        ).strip()
        if _OUTCOME_AWARE_HISTORY and fused > 0:
            m = _outcome_multiplier(outcome_val)
            if m != 1.0:
                outcome_adjusted += 1
                if m > 1.0:
                    outcome_positive += 1
                else:
                    outcome_negative += 1
            fused = max(0.0, min(1.0, fused * m))

        # Optional human-feedback-driven nudging (bounded).
        feedback_enabled = os.getenv("C_FEEDBACK_MULTIPLIER_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
        fb_mult = _feedback_multiplier_from_meta(payload.get("metadata") or {}) if feedback_enabled else 1.0
        if fb_mult != 1.0:
            feedback_adjusted += 1
        fused = max(0.0, min(1.0, fused * fb_mult))

        text_sims.append(sim_text)
        img_sims.append(sim_img)
        material_sims.append(sim_material)
        scored.append((fused, sim_text, sim_img, vec_id, payload.get("metadata") or {}, fused_base))
    scored.sort(key=lambda item: item[0], reverse=True)
    if scored:
        top = scored[0]
        _alog(
            f"score_c top_match part_id={part.id} supplier_id={supplier_id} "
            f"vec_id={top[3]} fused={round(top[0],4)} sim_text={round(top[1],4)} sim_img={round(top[2],4)}"
        )
    _alog(
        f"score_c outcome_adjustment part_id={part.id} supplier_id={supplier_id} "
        f"enabled={_OUTCOME_AWARE_HISTORY} adjusted={outcome_adjusted} "
        f"positive={outcome_positive} negative={outcome_negative}"
    )

    fused_sorted = [s[0] for s in scored]
    base_sorted = sorted((max(0.0, float(v)) for v in base_fused_sims), reverse=True)
    c_base = _top3_primary_score(base_sorted)
    c_outcome = _top3_primary_score(fused_sorted)
    c_text = _top3_primary_score(text_sims)
    c_img = _top3_primary_score(img_sims)
    c_material = _top3_primary_score(material_sims)
    # Cap outcome/behavioral swing around base geometric/spec score.
    outcome_cap_enabled = os.getenv("C_OUTCOME_CAP_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
    outcome_delta_cap = _env_float("C_OUTCOME_DELTA_CAP", 8.0)
    if outcome_cap_enabled:
        lower = max(0.0, c_base - outcome_delta_cap)
        upper = min(100.0, c_base + outcome_delta_cap)
        c_after_cap = round(min(max(c_outcome, lower), upper), 1)
    else:
        c_after_cap = c_outcome

    _alog(
        f"score_c top3_primary part_id={part.id} supplier_id={supplier_id} "
        f"top_fused={[round(v,4) for v in fused_sorted[:3]]} "
        f"c_base={c_base} c_outcome={c_outcome} c_after_cap={c_after_cap} "
        f"outcome_cap_enabled={outcome_cap_enabled} outcome_delta_cap={round(outcome_delta_cap,2)} "
        f"feedback_adjusted={feedback_adjusted}"
    )

    # Observability for planned stabilizers (no scoring behavior change here).
    near_exact_threshold = _env_float("C_NEAR_EXACT_THRESHOLD", 0.90)
    near_exact_floor = _env_float("C_NEAR_EXACT_FLOOR", 92.0)
    near_exact_enabled = os.getenv("C_NEAR_EXACT_FLOOR_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
    top_fused = fused_sorted[0] if fused_sorted else 0.0
    top_base = scored[0][5] if scored else 0.0
    top_meta = scored[0][4] if scored else {}
    req_material_norm = _normalize_material(part.material or "")
    top_material_norm = _normalize_material(
        _pick_meta(
            top_meta,
            "Material",
            "material",
            "Material_Primary",
            "material_primary",
            "material_name",
            "material_c",
            "material_r",
        )
    )
    req_process_norm = _normalize_process(" ".join(_expand_process_terms(part.process or "")))
    top_process_norm = _normalize_process(
        _pick_meta(
            top_meta,
            "Process_Primary",
            "process_primary",
            "Process",
            "process",
            "Process_Secondary",
            "process_secondary",
            "process_p",
            "process_s",
            "process_c",
        )
    )
    geom_exact = top_base >= near_exact_threshold
    material_exact = _token_overlap_ratio(req_material_norm, top_material_norm) >= 0.6 if req_material_norm and top_material_norm else False
    process_exact = _token_overlap_ratio(req_process_norm, top_process_norm) >= 0.6 if req_process_norm and top_process_norm else False
    near_exact_trigger = bool(geom_exact and material_exact and process_exact)
    c_after_floor = max(c_after_cap, near_exact_floor) if (near_exact_enabled and near_exact_trigger) else c_after_cap
    near_exact_applied = bool(near_exact_enabled and near_exact_trigger and c_after_floor > c_after_cap)
    _alog(
        f"score_c near_exact part_id={part.id} supplier_id={supplier_id} "
        f"enabled={near_exact_enabled} trigger={near_exact_trigger} applied={near_exact_applied} "
        f"geom_exact={geom_exact} material_exact={material_exact} process_exact={process_exact} "
        f"threshold={round(near_exact_threshold,3)} floor={round(near_exact_floor,1)} "
        f"top_fused={round(top_fused,4)} top_base={round(top_base,4)} c_before={c_after_cap} c_after={c_after_floor}"
    )

    depth_enabled = os.getenv("C_DEPTH_DAMPENER_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
    depth_factor = 1.0
    if depth_enabled:
        count = len(scored)
        if count < 5:
            depth_factor = 0.90
        elif count < 15:
            depth_factor = 0.95
        else:
            depth_factor = 1.0
    c_after_depth = round(c_after_floor * depth_factor, 1)
    _alog(
        f"score_c depth_dampener part_id={part.id} supplier_id={supplier_id} "
        f"enabled={depth_enabled} factor={round(depth_factor,3)} "
        f"matches={len(scored)} c_before={c_after_floor} c_after={c_after_depth} applied={depth_enabled}"
    )

    feedback_enabled = os.getenv("C_FEEDBACK_MULTIPLIER_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
    feedback_multiplier = 1.0
    feedback_multiplier_source = "none"
    if feedback_enabled and scored:
        feedback_multiplier = float(
            _pick_meta_local(scored[0][4], "feedback_multiplier", "Feedback_Multiplier") or 1.0
        )
        feedback_multiplier_source = str(
            _pick_meta_local(scored[0][4], "feedback_source", "Feedback_Source") or "top_match"
        )
    _alog(
        f"score_c feedback_multiplier part_id={part.id} supplier_id={supplier_id} "
        f"enabled={feedback_enabled} multiplier={round(feedback_multiplier,3)} source={feedback_multiplier_source} "
        f"c_after_depth={c_after_depth}"
    )

    c_fused = round(c_after_depth * feedback_multiplier, 1)

    confidence_score, confidence_band = _confidence_from_matches(
        part=part,
        fused_sorted=fused_sorted,
        matches_count=len(scored),
        image_quality=best_image_quality,
        has_image=has_image_queries,
    )

    # Per-part explanations (succinct, deterministic).
    if near_exact_applied:
        strongest_positive_driver = "Near-exact historical match on geometry, material, and process."
    elif has_image_queries and top_fused >= 0.75:
        strongest_positive_driver = "Strong visual similarity to past supplier jobs."
    elif top_fused >= 0.65:
        strongest_positive_driver = "Good overall historical similarity across top matches."
    else:
        strongest_positive_driver = "Moderate historical similarity from available references."

    if not has_image_queries:
        main_penalty = "No part images available; C relied on text/spec matching."
    elif not material_exact:
        main_penalty = "Top visual matches did not strongly align on material."
    elif not process_exact:
        main_penalty = "Top visual matches did not strongly align on process."
    elif outcome_negative > outcome_positive:
        main_penalty = "Outcome history on top matches includes negative signals."
    else:
        main_penalty = "No major penalty detected."

    if len(scored) < 5:
        confidence_reason = "Low corpus depth for this supplier in current similarity neighborhood."
    elif confidence_band == "high":
        confidence_reason = "High confidence from strong top-match separation and data completeness."
    elif confidence_band == "medium":
        confidence_reason = "Medium confidence due to mixed similarity strength across top matches."
    else:
        confidence_reason = "Low confidence due to weak separation or sparse supporting evidence."

    matched_jobs: list[MatchedJob] = []
    seen = set()

    for fused_sim, sim_text, sim_img, vec_id, meta, _fused_base in scored[:5]:
        # Keep a stable machine ID for downstream CRM storage/re-hydration.
        # Prefer explicit IDs from metadata, otherwise fall back to Pinecone vector ID.
        # Never default to image filename as primary job id.
        job_id = (
            meta.get("job_id")
            or meta.get("pinecone_vector_id")
            or vec_id
            or meta.get("image_name")
        )
        if job_id in seen:
            continue

        seen.add(job_id)
        raw_image = (
            meta.get("image_url")
            or meta.get("image_path")
            or meta.get("image_pat")
            or meta.get("image_name")
            or ""
        )
        served_image = None
        if raw_image:
            raw_image = str(raw_image).strip()
            if raw_image.startswith("http"):
                served_image = raw_image
            elif "/api/assessment/attachment" in raw_image:
                served_image = raw_image
            else:
                record_id = _pick_meta(
                    meta,
                    "record_id",
                    "recordId",
                    "zoho_record_id",
                    "zoho_recordId",
                    "source_record_id",
                )
                attachment_id = _pick_meta(
                    meta,
                    "attachment_id",
                    "attachmentId",
                    "attachmentID",
                )
                if record_id and attachment_id:
                    served_image = f"/api/assessment/attachment?{urlencode({'record_id': record_id, 'attachment_id': attachment_id})}"
                else:
                    filename = raw_image.replace("\\", "/").split("/")[-1]
                    if _local_image_file_exists(filename):
                        served_image = f"/images/{filename}"
                    else:
                        served_image = None

        job_material = _pick_meta(
            meta,
            "Material",
            "material",
            "Material_Primary",
            "material_primary",
            "raw_material",
            "inference_material",
            "material_c",
            "material_r",
        )
        job_process = _pick_meta(
            meta,
            "Process_Primary",
            "process_primary",
            "Process",
            "process",
            "Process_Secondary",
            "process_secondary",
            "process_p",
            "process_s",
            "process_c",
        )
        material_overlap = _token_overlap_ratio(_normalize_material(part.material or ""), _normalize_material(job_material or ""))
        process_overlap = _token_overlap_ratio(
            _normalize_process(" ".join(_expand_process_terms(part.process or ""))),
            _normalize_process(job_process or ""),
        )
        why_bits = []
        if sim_img >= sim_text and sim_img > 0:
            why_bits.append("geometry/shape")
        elif sim_text > 0:
            why_bits.append("spec text")
        if material_overlap >= 0.55:
            why_bits.append("material")
        if process_overlap >= 0.55:
            why_bits.append("process")
        why_bits = why_bits or ["overall similarity"]
        why_matched = "Matched on " + ", ".join(why_bits[:3]) + "."

        outcome_value = _pick_meta(meta, "Outcome", "outcome")
        outcome_lower = str(outcome_value or "").strip().lower()
        if fused_sim < 0.45:
            risk_note = "Low similarity confidence; validate this reference manually."
        elif material_overlap < 0.35:
            risk_note = "Material mismatch risk on top match."
        elif process_overlap < 0.35:
            risk_note = "Process mismatch risk on top match."
        elif any(t in outcome_lower for t in ("fail", "rework", "ncr", "reject", "lost")):
            risk_note = "Past outcome contains quality/execution risk signals."
        else:
            risk_note = "No major risk signal from this match."

        matched_jobs.append(
            MatchedJob(
                job_id=job_id,
                similarity=round(fused_sim * 100, 1),
                project_id=_pick_meta(meta, "project_id"),
                project_name=_pick_meta(meta, "Project_Name", "project_name", "project"),
                part_name=_pick_meta(meta, "part_name", "Part_Name"),
                project_link=_normalize_link(_pick_meta(
                    meta,
                    "project_link",
                    "project_url",
                    "source_url",
                    "share_url",
                    "record_url",
                    "zoho_record_url",
                    "project_detail_url",
                )),
                part_family=(
                    _pick_meta(meta, "Part_Family", "part_family", "part_type")
                    or _pick_meta_prefix(meta, "part_family")
                ),
                material=job_material,
                process_primary=job_process,
                customer_industry=_pick_meta(meta, "Customer_Industry", "customer_industry"),
                finish=_pick_meta(meta, "Finish", "finish", "Surface_Finish", "surface_finish", "finish_type"),
                features=_pick_meta(meta, "Features", "features"),
                outcome=outcome_value,
                why_matched=why_matched,
                risk_note=risk_note,
                details=_metadata_to_details(meta),
                project_date=_pick_meta(meta, "Project_Date", "project_date", "project_da"),
                image_url=served_image,
                record_id=_pick_meta(meta, "source_record_id", "record_id", "zoho_record_id"),
                attachment_id=_pick_meta(meta, "attachment_id", "image_attachment_id"),
                attachment_module=_pick_meta(meta, "attachment_module", "module_api"),
            )
        )

    print(
        f"  C score for {part.id}: {c_fused} "
        f"(text={c_text}, img={c_img}, material={c_material}, q={round(best_image_quality,3)}, "
        f"w_img={round(image_weight,3)}, unique={len(direct_unique_ids)}, retrieved={direct_matches_count})"
    )
    _alog(
        f"score_c done part_id={part.id} supplier_id={supplier_id} c_score={c_fused} "
        f"matches={len(matched_jobs)} confidence={confidence_band}"
    )
    return c_fused, matched_jobs, {
        "c_text": c_text,
        "c_img": c_img,
        "c_material": c_material,
        "image_quality": round(best_image_quality, 3),
        "image_weight": round(image_weight, 3),
        "match_confidence_score": confidence_score,
        "match_confidence": confidence_band,
        "strongest_positive_driver": strongest_positive_driver,
        "main_penalty": main_penalty,
        "confidence_reason": confidence_reason,
    }


def compute_composite(
    b1: Optional[float],
    b2: float,
    c: Optional[float],
    state: str,
    match_confidence_score: Optional[float] = None,
) -> tuple[float, str]:
    w = _resolve_weights()
    score: float
    mode: str
    # Keep composite behavior aligned with score_c caller: both A and C states
    # are eligible for historical similarity scoring.
    if b1 is not None and c is not None and state in ("A", "C"):
        # Confidence-aware weighting:
        # keep current history-first blend for strong matches,
        # but reduce C dominance when historical visual evidence is weak.
        conf = float(match_confidence_score or 0.0)
        if conf < 45.0:
            wb1, wb2, wc = 0.45, 0.25, 0.30
        elif conf < 75.0:
            wb1, wb2, wc = 0.35, 0.20, 0.45
        else:
            wb1, wb2, wc = w["w_b1"], w["w_b2"], w["w_c"]
        score, mode = (b1 * wb1) + (b2 * wb2) + (c * wc), "full"
    elif b1 is not None and c is None:
        score, mode = (b1 * w["w_b1_only"]) + (b2 * w["w_b2_with_b1_only"]), "partial"
    elif b1 is None and c is not None:
        score, mode = (b2 * w["w_b2_only_no_b1"]) + (c * w["w_c_only_no_b1"]), "partial"
    else:
        score, mode = b2, "partial"
    return round(min(100.0, max(0.0, score)), 1), mode


def compute_overall_score(scored_parts: list[ScoredPart]) -> float:
    if not scored_parts:
        return 0.0
    return round(sum(p.composite for p in scored_parts) / len(scored_parts), 1)


def _pick_meta(data: dict, *keys: str):
    if not isinstance(data, dict):
        return ""

    # Exact key lookup first.
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value

    # Case-insensitive exact key fallback.
    lower_map = {str(k).lower(): v for k, v in data.items()}
    for key in keys:
        value = lower_map.get(str(key).lower())
        if value not in (None, ""):
            return value
    return ""


def _pick_meta_prefix(data: dict, *prefixes: str):
    if not isinstance(data, dict):
        return ""
    for k, v in data.items():
        if v in (None, ""):
            continue
        lk = str(k).lower()
        for p in prefixes:
            if lk.startswith(str(p).lower()):
                return v
    return ""


def _normalize_link(value: str) -> str:
    link = (value or "").strip()
    if not link:
        return ""
    if link.startswith("http://") or link.startswith("https://"):
        return link
    if link.startswith("www."):
        return f"https://{link}"
    return ""


def _normalize_supplier_name(name: str) -> str:
    normalized = (name or "").strip().lower()
    normalized = normalized.replace("&", " and ")
    normalized = re.sub(r"[^\w\s]", " ", normalized)
    normalized = re.sub(
        r"\b(private limited|pvt ltd|pvt limited|pvt|ltd|limited|llc|inc|corp|corporation|co)\b",
        " ",
        normalized,
    )
    normalized = re.sub(r"\btechnologies\b", "technology", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _supplier_name_variants(supplier_name: str | None) -> list[str]:
    raw = (supplier_name or "").strip()
    if not raw:
        return []

    variants: list[str] = []

    def add_variant(value: str):
        cleaned = (value or "").strip()
        if cleaned and cleaned not in variants:
            variants.append(cleaned)

    normalized = _normalize_supplier_name(raw)

    add_variant(raw)
    add_variant(raw.lower().strip())
    add_variant(normalized)

    if normalized:
        add_variant(normalized.replace(" technology ", " technologies "))
        add_variant(normalized.replace(" technologies ", " technology "))
        if normalized.endswith(" technology"):
            add_variant(normalized[:-11] + " technologies")
        if normalized.endswith(" technologies"):
            add_variant(normalized[:-13] + " technology")

        base_tokens = [
            token for token in normalized.split()
            if token not in {"technology", "technologies"}
        ]
        if base_tokens:
            add_variant(" ".join(base_tokens))

    return variants


def _history_filters(supplier_id: str, supplier_name: str | None = None) -> list[dict]:
    filters = [
        {"zoho_id": {"$eq": supplier_id}},
        {"account_lookup_id": {"$eq": supplier_id}},
        {"account_id": {"$eq": supplier_id}},
        {"supplier_id": {"$eq": supplier_id}},
    ]
    filters.extend(
        {"supplier_name": {"$eq": name_variant}}
        for name_variant in _supplier_name_variants(supplier_name)
    )
    # Support alternate supplier-name key seen in historical vectors.
    filters.extend(
        {"supplier_n": {"$eq": name_variant}}
        for name_variant in _supplier_name_variants(supplier_name)
    )
    return filters


def _profile_filters(supplier_id: str) -> list[dict]:
    sid = (supplier_id or "").strip()
    if not sid:
        return []
    return [
        {"account_lookup_id": {"$eq": sid}},
        {"account_id": {"$eq": sid}},
        {"supplier_id": {"$eq": sid}},
        {"zoho_id": {"$eq": sid}},
    ]


def _fetch_supplier_history_rows(supplier_id: str, supplier_name: str | None = None) -> list[dict]:
    from assessment.zoho_projects import fetch_supplier_past_projects

    rows = list(fetch_supplier_past_projects(supplier_id))
    _alog(
        f"history_rows start supplier_id={supplier_id} supplier_name={supplier_name or ''} "
        f"zoho_rows={len(rows)}"
    )
    seen_keys = {
        (
            _pick_meta(row, "Pinecone_Vector_ID", "pinecone_vector_id"),
            _pick_meta(row, "Part_Family", "part_family") or _pick_meta_prefix(row, "part_family"),
            _pick_meta(row, "Process_Primary", "process_primary", "process_p"),
            _pick_meta(row, "Project_Date", "project_date", "project_da"),
        )
        for row in rows
    }

    index = get_historical_projects_index()

    # Use the live embedder to produce a probe vector whose dimension matches
    # whatever model is currently loaded — avoids hardcoded-dimension drift.
    # Falls back to 512 zeros only if the embedder itself is unavailable;
    # the dimension-retry block below will recover even then.
    try:
        history_probe_vector = get_text_embedder().encode("supplier history metadata probe").tolist()
    except Exception:
        history_probe_vector = [0.0] * 512

    def _run_history_query(vector: list[float], history_filter: dict):
        # We only care about metadata here, not similarity order.
        # The vector is a probe so Pinecone accepts the call; the filter
        # is what actually selects the right supplier's rows.
        return index.query(
            vector=vector,
            filter=history_filter,
            top_k=100,
            include_metadata=True,
        )

    for supplier_filter in _history_filters(supplier_id, supplier_name):
        try:
            result = _run_history_query(history_probe_vector, supplier_filter)
            _alog(
                f"history_query supplier_id={supplier_id} filter={supplier_filter} "
                f"matches={len(result.matches or [])}"
            )
        except Exception as e:
            msg = str(e)
            # If Pinecone rejects the vector due to a dimension mismatch it
            # includes the expected dimension in the error message.
            # Parse it out and retry once with a zero-vector of the correct size.
            m = re.search(r"dimension of the index\s+(\d+)", msg, re.IGNORECASE)
            if m:
                expected_dim = int(m.group(1))
                _alog(
                    f"history_query_dim_retry supplier_id={supplier_id} "
                    f"filter={supplier_filter} expected_dim={expected_dim}"
                )
                try:
                    result = _run_history_query([0.0] * expected_dim, supplier_filter)
                except Exception as e2:
                    print(f"  Pinecone history metadata query failed for {supplier_filter}: {e2}")
                    _alog(
                        f"history_query_failed supplier_id={supplier_id} "
                        f"filter={supplier_filter} error={e2}"
                    )
                    continue
            else:
                print(f"  Pinecone history metadata query failed for {supplier_filter}: {e}")
                _alog(
                    f"history_query_failed supplier_id={supplier_id} filter={supplier_filter} "
                    f"error={e}"
                )
                continue

        for match in result.matches:
            meta = match.metadata or {}
            key = (
                _pick_meta(meta, "Pinecone_Vector_ID", "pinecone_vector_id"),
                _pick_meta(meta, "Part_Family", "part_family") or _pick_meta_prefix(meta, "part_family"),
                _pick_meta(meta, "Process_Primary", "process_primary", "process_p"),
                _pick_meta(meta, "Project_Date", "project_date", "project_da"),
            )
            if key in seen_keys:
                continue
            rows.append(meta)
            seen_keys.add(key)

    _alog(f"history_rows done supplier_id={supplier_id} total_rows={len(rows)}")
    return rows


def _fetch_supplier_profile_rows(supplier_id: str) -> list[dict]:
    # Cache entries store {"rows": [...], "ts": <unix timestamp>}.
    # We check age against SUPPLIER_PROFILE_CACHE_TTL_SEC (default 900 s / 15 min)
    # so a supplier who updates their Pinecone profile gets fresh data within
    # that window rather than being stuck with stale rows until server restart.
    ttl_sec = int(_env_float("SUPPLIER_PROFILE_CACHE_TTL_SEC", 900.0))
    now = time.time()
    cached = _SUPPLIER_PROFILE_ROWS_CACHE.get(supplier_id)
    if cached is not None and (now - float(cached.get("ts", 0.0))) <= ttl_sec:
        rows = cached["rows"]
        _alog(f"profile_rows cache_hit supplier_id={supplier_id} rows={len(rows)}")
        return rows
    # Cache miss or expired — fall through to fetch fresh rows from Pinecone.

    rows: list[dict] = []
    index = get_process_profile_index()
    # Build a query vector from the configured text embedder so the dimension
    # matches this index's embedding space (avoids hardcoded-dimension drift).
    try:
        query_vector = get_text_embedder().encode("supplier process profile metadata").tolist()
    except Exception:
        query_vector = [0.0] * 384

    def _run_query(vector: list[float], profile_filter: dict):
        return index.query(
            vector=vector,
            filter=profile_filter,
            top_k=120,
            include_metadata=True,
        )

    seen_ids: set[str] = set()
    for profile_filter in _profile_filters(supplier_id):
        try:
            result = _run_query(query_vector, profile_filter)
            _alog(
                f"profile_query supplier_id={supplier_id} filter={profile_filter} "
                f"matches={len(result.matches or [])}"
            )
        except Exception as e:
            # Retry once if Pinecone reports expected dimension (e.g. 384).
            msg = str(e)
            m = re.search(r"dimension of the index\s+(\d+)", msg, re.IGNORECASE)
            if m:
                expected_dim = int(m.group(1))
                try:
                    result = _run_query([0.0] * expected_dim, profile_filter)
                except Exception as e2:
                    print(f"  Process profile metadata query failed for {supplier_id} filter={profile_filter}: {e2}")
                    continue
            else:
                print(f"  Process profile metadata query failed for {supplier_id} filter={profile_filter}: {e}")
                continue

        for match in result.matches:
            mid = str(getattr(match, "id", "") or "").strip()
            if mid and mid in seen_ids:
                continue
            if mid:
                seen_ids.add(mid)
            if match.metadata:
                rows.append(match.metadata)
    # Write rows + current timestamp so the TTL check above can expire this entry.
    _SUPPLIER_PROFILE_ROWS_CACHE[supplier_id] = {"rows": rows, "ts": time.time()}
    _alog(f"profile_rows done supplier_id={supplier_id} rows={len(rows)}")
    return rows


def _query_supplier_history(
    index,
    query_vector: list[float],
    supplier_id: str,
    supplier_name: str | None,
    top_k: int,
):
    seen_ids = set()
    matches = []
    vec_dim = len(query_vector or [])

    for supplier_filter in _history_filters(supplier_id, supplier_name):
        try:
            result = index.query(
                vector=query_vector,
                filter=supplier_filter,
                top_k=top_k,
                include_metadata=True,
            )
            _alog(
                f"history_semantic_query supplier_id={supplier_id} filter={supplier_filter} "
                f"matches={len(result.matches or [])}"
            )
        except Exception as e:
            print(f"  Pinecone supplier history query failed for {supplier_filter}: {e}")
            _alog(
                f"history_semantic_query_failed supplier_id={supplier_id} "
                f"filter={supplier_filter} vector_dim={vec_dim} error={e}"
            )
            continue

        for match in result.matches:
            if match.id in seen_ids:
                continue
            seen_ids.add(match.id)
            matches.append(match)

    _alog(
        f"history_semantic_query_done supplier_id={supplier_id} vector_dim={vec_dim} "
        f"unique_matches={len(matches)}"
    )
    return matches


async def score_part(
    part: RFPPart,
    supplier_id: str,
    supplier_name: Optional[str],
    state: SupplierDataState,
    part_image_b64: Optional[str] = None,
    overall_image_b64: Optional[str] = None,
    candidate_images_b64: Optional[list[str]] = None,
    candidate_image_indices: Optional[list[int]] = None,
    certs_required: list[str] | None = None,
    supplier_certs: list[str] | None = None,
) -> ScoredPart:
    _alog(
        f"score_part start part_id={part.id} supplier_id={supplier_id} "
        f"state={state.state} candidate_images={len(candidate_images_b64 or [])}"
    )
    gate = evaluate_feasibility_gate(part, supplier_id, supplier_name)
    gate_status = gate.get("gate_status", "pass")
    gate_reasons = list(gate.get("gate_reasons") or [])
    dependency_tags = list(gate.get("dependency_tags") or [])
    geometry_basis = _geometry_basis(part_image_b64, overall_image_b64, candidate_images_b64)
    _alog(
        f"score_part gate part_id={part.id} status={gate_status} "
        f"reasons={gate_reasons} deps={dependency_tags}"
    )

    if gate_status == "hard_fail":
        _alog(f"score_part done part_id={part.id} hard_fail composite=0.0")
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
            strongest_positive_driver=None,
            main_penalty="Feasibility hard gate triggered.",
            confidence_reason="No scoring generated because part is currently infeasible.",
            gate_status=gate_status,
            gate_reasons=gate_reasons,
            dependency_tags=dependency_tags,
            geometry_basis=geometry_basis,
            composite=0.0,
            scoring_mode="partial",
            matched_jobs=[],
            image_candidate_indices=list(candidate_image_indices or []),
        )

    # Infer the recommended process before scoring so b2 scores against the
    # corrected spec. Source ("gemini"/"rules"/"stated") is logged only — not
    # forwarded to the frontend or the supplier.
    inferred_procs, infer_source = await _infer_recommended_processes(part)

    b1_details: dict = {}
    b2_details: dict = {}
    b1, b2 = await asyncio.gather(
        score_b1(part, supplier_id, certs_required=certs_required, supplier_certs=supplier_certs, details_out=b1_details),
        score_b2(
            part,
            supplier_id,
            supplier_name,
            recommended_processes=inferred_procs,
            infer_source=infer_source,
            details_out=b2_details,
        ),
    )
    _alog(
        f"score_part b_scores part_id={part.id} b1={b1} b2={b2} "
        f"b2_base={b2_details.get('b2_base_score')} b2_ai_delta={b2_details.get('b2_ai_delta')} "
        f"b2_infer_source={infer_source} b2_recommended={inferred_procs}"
    )

    b2_inferred_process = ", ".join(inferred_procs) if inferred_procs else None
    # Aligned = stated process and inferred process belong to the same canonical family
    stated_family = _canonical_process(_normalize_process(part.process or ""))
    inferred_families = {
        _canonical_process(_normalize_process(p)) for p in (inferred_procs or [])
    }
    b2_process_aligned: bool | None = (
        bool(stated_family and inferred_families and stated_family in inferred_families)
        if inferred_procs else None
    )

    if state.state in ("A", "C"):
        c_score, matched_jobs, c_debug = await score_c(
            part, supplier_id, supplier_name, part_image_b64, overall_image_b64, candidate_images_b64
        )
    else:
        c_score = None
        matched_jobs = []
        c_debug = {
            "c_text": None,
            "c_img": None,
            "image_quality": None,
            "image_weight": None,
            "match_confidence_score": 0.0,
            "match_confidence": "low",
            "strongest_positive_driver": None,
            "main_penalty": "Historical similarity unavailable for current supplier state.",
            "confidence_reason": "State does not permit historical image matching.",
        }

    composite, mode = compute_composite(
        b1,
        b2,
        c_score,
        state.state,
        match_confidence_score=c_debug.get("match_confidence_score"),
    )
    _alog(
        f"score_part weighting part_id={part.id} strategy={'history_first' if _HISTORY_FIRST_SCORING else 'balanced'} "
        f"state={state.state} mode={mode}"
    )
    _alog(
        f"score_part done part_id={part.id} mode={mode} composite={composite} "
        f"c={c_score} matched_jobs={len(matched_jobs)}"
    )

    return ScoredPart(
        part_id=part.id,
        description=part.description,
        b1=b1,
        b1_profile_processes=b1_details.get("profile_processes") or [],
        b1_profile_materials=b1_details.get("profile_materials") or [],
        b1_matched_processes=b1_details.get("matched_processes") or [],
        b1_required_processes=b1_details.get("required_processes") or [],
        b1_matched_materials=b1_details.get("matched_materials") or [],
        b1_tolerance_capable=b1_details.get("tolerance_capable"),
        b1_missing_certs=b1_details.get("missing_certs") or [],
        b2=b2,
        b2_base_score=b2_details.get("b2_base_score"),
        b2_ai_delta=b2_details.get("b2_ai_delta"),
        b2_infer_source=b2_details.get("b2_infer_source"),
        b2_inferred_process=b2_inferred_process,
        b2_process_aligned=b2_process_aligned,
        b2_history_matched_processes=b2_details.get("history_matched_processes") or [],
        b2_history_matched_materials=b2_details.get("history_matched_materials") or [],
        c=c_score,
        c_text=c_debug.get("c_text"),
        c_img=c_debug.get("c_img"),
        image_quality=c_debug.get("image_quality"),
        image_weight=c_debug.get("image_weight"),
        match_confidence=c_debug.get("match_confidence"),
        match_confidence_score=c_debug.get("match_confidence_score"),
        strongest_positive_driver=c_debug.get("strongest_positive_driver"),
        main_penalty=c_debug.get("main_penalty"),
        confidence_reason=c_debug.get("confidence_reason"),
        gate_status=gate_status,
        gate_reasons=gate_reasons,
        dependency_tags=dependency_tags,
        geometry_basis=geometry_basis,
        material=part.material or None,
        process=part.process or None,
        tolerance=part.tolerance or None,
        qty=part.qty,
        composite=composite,
        scoring_mode=mode,
        matched_jobs=matched_jobs,
        image_candidate_indices=list(candidate_image_indices or []),
    )

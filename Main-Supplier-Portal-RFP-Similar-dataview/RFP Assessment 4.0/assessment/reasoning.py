"""
Lightweight overall-fit reasoning generator.

Returns one short natural-language reason for why the overall fit score looks the way it does.
Uses Gemini when available, with deterministic fallback for reliability.
"""

from __future__ import annotations

import os
import re
import time
import uuid
import asyncio
import json
import httpx

from models import RFPSubmitRequest, ScoredPart

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite").strip()
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)


def _estimate_tokens(text: str) -> int:
    return max(0, int(round(len(str(text or "")) / 4)))


def _glog(event: str, **fields):
    payload = " ".join([f"{k}={fields[k]}" for k in sorted(fields.keys())])
    print(f"[gemini] event={event} {payload}".strip())


def _usage_counts_from_http_json(data: dict) -> tuple[int | None, int | None, int | None]:
    try:
        um = (data or {}).get("usageMetadata") or {}
        in_t = um.get("promptTokenCount")
        out_t = um.get("candidatesTokenCount")
        total_t = um.get("totalTokenCount")
        return (
            int(in_t) if in_t is not None else None,
            int(out_t) if out_t is not None else None,
            int(total_t) if total_t is not None else None,
        )
    except Exception:
        return None, None, None


def _avg(values: list[float | None]) -> float:
    nums = [float(v) for v in values if v is not None]
    if not nums:
        return 0.0
    return round(sum(nums) / len(nums), 1)


def _clean_one_line(text: str) -> str:
    v = (text or "").replace("```", "").strip()
    v = re.sub(r"^\s*[-*]\s*", "", v)
    v = re.sub(r"\s+", " ", v).strip()
    return v[:420]


def _fallback_reason(
    rfp: RFPSubmitRequest,
    scored_parts: list[ScoredPart],
    overall_score: float,
) -> str:
    b1 = _avg([p.b1 for p in scored_parts])
    b2 = _avg([p.b2 for p in scored_parts])
    c = _avg([p.c for p in scored_parts])
    dims = [("Requested Fit", b1), ("Manufacturability Fit", b2), ("Historical Similarity", c)]
    weakest = sorted(dims, key=lambda d: d[1])[0]
    strongest = sorted(dims, key=lambda d: d[1], reverse=True)[0]
    band = "strong" if overall_score >= 80 else "moderate" if overall_score >= 60 else "thin"

    # Try to anchor "why" to concrete scoring signals.
    penalties = [f"{p.part_id}: {p.main_penalty}" for p in scored_parts if (p.main_penalty or "").strip()]
    top_penalty = penalties[0] if penalties else ""
    materials = sorted({(p.material or "").strip() for p in scored_parts if (p.material or "").strip()})
    processes = sorted({(p.process or "").strip() for p in scored_parts if (p.process or "").strip()})
    scope = ", ".join((materials[:2] + processes[:2])) if (materials or processes) else (rfp.project or "this project")

    reason = (
        f"Overall Fit is {round(overall_score)} ({band}) because {strongest[0]} is relatively stronger "
        f"({strongest[1]}), but {weakest[0]} is the main drag ({weakest[1]}) for {scope}."
    )
    if top_penalty:
        reason += f" Primary risk signal: {top_penalty}."
    return _clean_one_line(reason)


def _build_prompt(
    rfp: RFPSubmitRequest,
    scored_parts: list[ScoredPart],
    overall_score: float,
) -> str:
    b1 = _avg([p.b1 for p in scored_parts])
    b2 = _avg([p.b2 for p in scored_parts])
    c = _avg([p.c for p in scored_parts])

    parts_brief = "\n".join(
        f"- {p.part_id}: b1={p.b1}, b2={p.b2}, c={p.c}, composite={p.composite}, "
        f"material={p.material or ''}, process={p.process or ''}, tolerance={p.tolerance or ''}, "
        f"penalty={p.main_penalty or ''}"
        for p in scored_parts[:6]
    )

    return f"""Write exactly one concise sentence (max 45 words) explaining why this supplier's overall fit score is what it is.

Rules:
- Be concrete and factual, not generic.
- Mention strongest and weakest scoring dimensions.
- Mention one specific risk driver when available.
- No markdown, no bullets, no labels.

Context:
Buyer={rfp.buyer}
Project={rfp.project}
Overall={round(overall_score)}
Averages: Requested Fit(B1)={b1}, Manufacturability Fit(B2)={b2}, Historical Similarity(C)={c}

Part signals:
{parts_brief}
"""


async def generate_fit_reason(
    rfp: RFPSubmitRequest,
    scored_parts: list[ScoredPart],
    overall_score: float,
) -> str:
    fallback = _fallback_reason(rfp, scored_parts, overall_score)
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return fallback

    prompt = _build_prompt(rfp, scored_parts, overall_score)
    req_id = f"fr_{uuid.uuid4().hex[:10]}"
    est_in = _estimate_tokens(prompt)
    try:
        _glog("request_start", request_id=req_id, flow="fit_reason_overall", model=GEMINI_MODEL, est_input_tokens=est_in)
        async with httpx.AsyncClient(timeout=8.0) as client:
            started = time.time()
            for attempt in range(1, 3):
                try:
                    response = await client.post(
                        f"{GEMINI_URL}?key={api_key}",
                        json={
                            "contents": [{"parts": [{"text": prompt}]}],
                            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 120},
                        },
                    )
                    response.raise_for_status()
                    data = response.json()
                    raw = data["candidates"][0]["content"]["parts"][0]["text"]
                    text = _clean_one_line(raw)
                    est_out = _estimate_tokens(raw)
                    in_t, out_t, total_t = _usage_counts_from_http_json(data)
                    _glog("request_ok", request_id=req_id, flow="fit_reason_overall", attempt=attempt, latency_ms=int((time.time()-started)*1000))
                    _glog(
                        "token_usage",
                        request_id=req_id,
                        flow="fit_reason_overall",
                        input_tokens=(in_t if in_t is not None else est_in),
                        output_tokens=(out_t if out_t is not None else est_out),
                        total_tokens=(total_t if total_t is not None else ((in_t if in_t is not None else est_in) + (out_t if out_t is not None else est_out))),
                    )
                    if not text:
                        return fallback
                    return text
                except Exception as e:
                    err = str(e)
                    transient = ("429" in err or "503" in err or "quota" in err.lower() or "rate" in err.lower() or "unavailable" in err.lower())
                    backoff = 1 if transient else 0
                    _glog("request_fail", request_id=req_id, flow="fit_reason_overall", attempt=attempt, transient=str(bool(transient)).lower(), backoff_s=backoff, error=repr(err[:220]))
                    if attempt >= 2 or not transient:
                        raise
                    await asyncio.sleep(backoff)
    except Exception as e:
        print(f"[fit_reason] Gemini call failed: {e}")
        return fallback


def _fallback_dimension_reason(
    dimension_label: str,
    dimension_value: float,
    weight: float,
    scored_parts: list[ScoredPart],
    dimension_key: str,
) -> str:
    if not scored_parts:
        return f"{dimension_label}: Score {round(dimension_value)} (weight {int(weight*100)}%). Gap: insufficient part-level evidence. Suggestion: add part specs and CAD/images for stronger confidence."
    sorted_parts = sorted(
        scored_parts,
        key=lambda p: float(getattr(p, dimension_key, 0.0) or 0.0),
    )
    low = sorted_parts[0]
    high = sorted_parts[-1]
    low_v = round(float(getattr(low, dimension_key, 0.0) or 0.0), 1)
    high_v = round(float(getattr(high, dimension_key, 0.0) or 0.0), 1)
    impact = round(float(dimension_value) * weight, 1)
    high_mat = (high.material or "").strip() or "unspecified material"
    high_proc = (high.process or "").strip() or "unspecified process"
    low_mat = (low.material or "").strip() or "unspecified material"
    low_proc = (low.process or "").strip() or "unspecified process"
    low_pen = (low.main_penalty or "").strip()
    gap = low_pen if low_pen else f"weaker alignment for {low.part_id} ({low_mat} / {low_proc})"
    if dimension_key == "b1":
        suggest = "confirm requested material/process/tolerance against registered profile before quoting"
    else:
        suggest = "de-risk manufacturability with process plan, fixture/inspection checks, and lead-time buffer"
    return _clean_one_line(
        f"{dimension_label}: Score {round(dimension_value)} (impact {impact}). "
        f"Strength: {high.part_id} aligned on {high_mat} / {high_proc} ({high_v}). "
        f"Gap: {gap}. Suggestion: {suggest}."
    )


async def _generate_dimension_reason(
    *,
    rfp: RFPSubmitRequest,
    scored_parts: list[ScoredPart],
    dimension_key: str,
    dimension_label: str,
    weight: float,
) -> str:
    vals = [float(getattr(p, dimension_key, 0.0) or 0.0) for p in scored_parts]
    avg_val = round(sum(vals) / len(vals), 1) if vals else 0.0
    fallback = _fallback_dimension_reason(dimension_label, avg_val, weight, scored_parts, dimension_key)
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return fallback
    parts_brief = "\n".join(
        f"- {p.part_id}: {dimension_key}={getattr(p, dimension_key, 0.0)}, material={p.material or ''}, process={p.process or ''}, tolerance={p.tolerance or ''}, penalty={p.main_penalty or ''}"
        for p in scored_parts[:6]
    )
    prompt = f"""Write a compact reasoning line for quoting (max 85 words) in this exact shape:
{dimension_label}: Score <n> (impact <n>). Strength: <what matched>. Gap: <what lacked>. Suggestion: <next action>.

Rules:
- Explicitly reference material/process/tolerance evidence.
- Mention one strongest and one weakest part-level signal.
- Gap must be concrete (missing or weak capability/history signal).
- Suggestion must be actionable for quote prep (qualification, validation, alternate process/material, lead-time risk control).
- No markdown, no bullets, no JSON.

Context:
Dimension={dimension_label}
Average={avg_val}
Weight in overall={int(weight*100)}%
Buyer={rfp.buyer}
Project={rfp.project}

Part signals:
{parts_brief}
"""
    req_id = f"frd_{dimension_key}_{uuid.uuid4().hex[:8]}"
    est_in = _estimate_tokens(prompt)
    try:
        _glog("request_start", request_id=req_id, flow=f"fit_reason_{dimension_key}", model=GEMINI_MODEL, est_input_tokens=est_in)
        async with httpx.AsyncClient(timeout=8.0) as client:
            started = time.time()
            for attempt in range(1, 3):
                try:
                    response = await client.post(
                        f"{GEMINI_URL}?key={api_key}",
                        json={
                            "contents": [{"parts": [{"text": prompt}]}],
                            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 120},
                        },
                    )
                    response.raise_for_status()
                    data = response.json()
                    raw = data["candidates"][0]["content"]["parts"][0]["text"]
                    text = _clean_one_line(raw)
                    _glog("request_ok", request_id=req_id, flow=f"fit_reason_{dimension_key}", attempt=attempt, latency_ms=int((time.time()-started)*1000))
                    est_out = _estimate_tokens(raw)
                    in_t, out_t, total_t = _usage_counts_from_http_json(data)
                    _glog(
                        "token_usage",
                        request_id=req_id,
                        flow=f"fit_reason_{dimension_key}",
                        input_tokens=(in_t if in_t is not None else est_in),
                        output_tokens=(out_t if out_t is not None else est_out),
                        total_tokens=(total_t if total_t is not None else ((in_t if in_t is not None else est_in) + (out_t if out_t is not None else est_out))),
                    )
                    return text or fallback
                except Exception as e:
                    err = str(e)
                    transient = ("429" in err or "503" in err or "quota" in err.lower() or "rate" in err.lower() or "unavailable" in err.lower())
                    backoff = 1 if transient else 0
                    _glog("request_fail", request_id=req_id, flow=f"fit_reason_{dimension_key}", attempt=attempt, transient=str(bool(transient)).lower(), backoff_s=backoff, error=repr(err[:220]))
                    if attempt >= 2 or not transient:
                        raise
                    await asyncio.sleep(backoff)
    except Exception as e:
        print(f"[fit_reason:{dimension_key}] Gemini call failed: {e}")
        return fallback


async def generate_requested_fit_reason(
    rfp: RFPSubmitRequest,
    scored_parts: list[ScoredPart],
) -> str:
    return await _generate_dimension_reason(
        rfp=rfp,
        scored_parts=scored_parts,
        dimension_key="b1",
        dimension_label="Requested Fit",
        weight=0.35,
    )


async def generate_manufacturability_fit_reason(
    rfp: RFPSubmitRequest,
    scored_parts: list[ScoredPart],
) -> str:
    return await _generate_dimension_reason(
        rfp=rfp,
        scored_parts=scored_parts,
        dimension_key="b2",
        dimension_label="Manufacturability Fit",
        weight=0.30,
    )


def _build_bundle_prompt(
    rfp: RFPSubmitRequest,
    scored_parts: list[ScoredPart],
    overall_score: float,
) -> str:
    b1 = _avg([p.b1 for p in scored_parts])
    b2 = _avg([p.b2 for p in scored_parts])
    c = _avg([p.c for p in scored_parts])
    dims = [("Requested Fit", b1), ("Manufacturability Fit", b2), ("Historical Similarity", c)]
    strongest = sorted(dims, key=lambda x: x[1], reverse=True)[0]
    weakest = sorted(dims, key=lambda x: x[1])[0]

    overall_lines = []
    requested_lines = []
    mfg_lines = []
    for p in scored_parts[:6]:
        overall_lines.append(
            f"- {p.part_id}: composite={p.composite}, b1={p.b1}, b2={p.b2}, c={p.c}, "
            f"penalty={p.main_penalty or 'none'}, confidence={p.confidence_reason or 'n/a'}"
        )
        requested_lines.append(
            f"- {p.part_id}: req_process={p.process or 'n/a'} | req_material={p.material or 'n/a'} | req_tol={p.tolerance or 'n/a'} | "
            f"profile_processes={', '.join(p.b1_profile_processes or []) or 'none'} | "
            f"matched_processes={', '.join(p.b1_matched_processes or []) or 'none'} | "
            f"profile_materials={', '.join(p.b1_profile_materials or []) or 'none'} | "
            f"matched_materials={', '.join(p.b1_matched_materials or []) or 'none'} | "
            f"tol_capable={p.b1_tolerance_capable} | missing_certs={', '.join(p.b1_missing_certs or []) or 'none'}"
        )
        mfg_lines.append(
            f"- {p.part_id}: customer_process={p.process or 'n/a'} | inferred_process={p.b2_inferred_process or 'n/a'} | "
            f"aligned={p.b2_process_aligned} | history_matched_processes={', '.join(p.b2_history_matched_processes or []) or 'none'} | "
            f"history_matched_materials={', '.join(p.b2_history_matched_materials or []) or 'none'} | "
            f"b2={p.b2} | penalty={p.main_penalty or 'none'}"
        )

    overall_section = "\n".join(overall_lines) if overall_lines else "- none"
    requested_section = "\n".join(requested_lines) if requested_lines else "- none"
    mfg_section = "\n".join(mfg_lines) if mfg_lines else "- none"

    return f"""You are a manufacturing quoting analyst.
Return strict JSON only, no markdown, no prose outside JSON.
Schema:
{{
  "overall_reason": "one sentence, max 45 words. Must mention strongest and weakest dimension with numbers.",
  "requested_fit_reason": "one line, max 85 words, exact format: Requested Fit: Score <n> (impact <n>). Strength: <specific matched process/material/tolerance>. Gap: <specific missing process/material/cert/tolerance>. Suggestion: <clear bid action>.",
  "manufacturability_fit_reason": "one line, max 85 words, exact format: Manufacturability Fit: Score <n> (impact <n>). Strength: <specific inferred-process/history evidence>. Gap: <specific alignment/history weakness>. Suggestion: <clear bid action>."
}}

Rules:
- Concrete and factual; avoid generic wording.
- Use the provided evidence only; do not invent facts.
- Mention part IDs where useful.
- Keep each field as one sentence.
- If evidence is missing, explicitly say "limited evidence".

Context:
Buyer={rfp.buyer}
Project={rfp.project}
Overall={round(overall_score)}
Averages: Requested Fit(B1)={b1}, Manufacturability Fit(B2)={b2}, Historical Similarity(C)={c}
Strongest dimension={strongest[0]} ({strongest[1]})
Weakest dimension={weakest[0]} ({weakest[1]})

Overall evidence:
{overall_section}

Requested Fit evidence:
{requested_section}

Manufacturability Fit evidence:
{mfg_section}
"""


def _parse_bundle_json(raw_text: str) -> dict:
    txt = (raw_text or "").strip().replace("```json", "").replace("```", "").strip()
    try:
        data = json.loads(txt)
    except Exception:
        m = re.search(r"\{.*\}", txt, flags=re.S)
        if not m:
            return {}
        try:
            data = json.loads(m.group(0))
        except Exception:
            return {}
    if not isinstance(data, dict):
        return {}
    return {
        "overall_reason": _clean_one_line(str(data.get("overall_reason", "") or "")),
        "requested_fit_reason": _clean_one_line(str(data.get("requested_fit_reason", "") or "")),
        "manufacturability_fit_reason": _clean_one_line(str(data.get("manufacturability_fit_reason", "") or "")),
    }


async def generate_fit_reasons_bundle(
    rfp: RFPSubmitRequest,
    scored_parts: list[ScoredPart],
    overall_score: float,
) -> tuple[str, str, str]:
    overall_fb = _fallback_reason(rfp, scored_parts, overall_score)
    req_fb = _fallback_dimension_reason("Requested Fit", _avg([p.b1 for p in scored_parts]), 0.35, scored_parts, "b1")
    mfg_fb = _fallback_dimension_reason("Manufacturability Fit", _avg([p.b2 for p in scored_parts]), 0.30, scored_parts, "b2")
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return overall_fb, req_fb, mfg_fb

    prompt = _build_bundle_prompt(rfp, scored_parts, overall_score)
    req_id = f"frb_{uuid.uuid4().hex[:10]}"
    est_in = _estimate_tokens(prompt)
    try:
        _glog("request_start", request_id=req_id, flow="fit_reason_bundle", model=GEMINI_MODEL, est_input_tokens=est_in)
        async with httpx.AsyncClient(timeout=10.0) as client:
            started = time.time()
            for attempt in range(1, 3):
                try:
                    response = await client.post(
                        f"{GEMINI_URL}?key={api_key}",
                        json={
                            "contents": [{"parts": [{"text": prompt}]}],
                            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 280},
                        },
                    )
                    response.raise_for_status()
                    data = response.json()
                    raw = data["candidates"][0]["content"]["parts"][0]["text"]
                    parsed = _parse_bundle_json(raw)
                    _glog("request_ok", request_id=req_id, flow="fit_reason_bundle", attempt=attempt, latency_ms=int((time.time()-started)*1000))
                    est_out = _estimate_tokens(raw)
                    in_t, out_t, total_t = _usage_counts_from_http_json(data)
                    _glog(
                        "token_usage",
                        request_id=req_id,
                        flow="fit_reason_bundle",
                        input_tokens=(in_t if in_t is not None else est_in),
                        output_tokens=(out_t if out_t is not None else est_out),
                        total_tokens=(total_t if total_t is not None else ((in_t if in_t is not None else est_in) + (out_t if out_t is not None else est_out))),
                    )
                    return (
                        parsed.get("overall_reason") or overall_fb,
                        parsed.get("requested_fit_reason") or req_fb,
                        parsed.get("manufacturability_fit_reason") or mfg_fb,
                    )
                except Exception as e:
                    err = str(e)
                    transient = ("429" in err or "503" in err or "quota" in err.lower() or "rate" in err.lower() or "unavailable" in err.lower())
                    backoff = 1 if transient else 0
                    _glog("request_fail", request_id=req_id, flow="fit_reason_bundle", attempt=attempt, transient=str(bool(transient)).lower(), backoff_s=backoff, error=repr(err[:220]))
                    if attempt >= 2 or not transient:
                        raise
                    await asyncio.sleep(backoff)
    except Exception as e:
        print(f"[fit_reason:bundle] Gemini call failed: {e}")
        return overall_fb, req_fb, mfg_fb

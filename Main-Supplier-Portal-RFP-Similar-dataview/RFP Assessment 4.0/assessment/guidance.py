"""
TrustBridge quote guidance generator.
Generates concise supplier bid advice after scoring.
Falls back to deterministic bid-strategy bullets if Gemini is unavailable.
"""

import os
import re
import time
import uuid
import asyncio

import httpx

from models import Flag, RFPSubmitRequest, ScoredPart

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


async def generate_guidance(
    rfp: RFPSubmitRequest,
    scored_parts: list[ScoredPart],
    flags: list[Flag],
) -> list[str]:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return _fallback_guidance(rfp, scored_parts, flags)

    prompt = _build_prompt(rfp, scored_parts, flags)
    req_id = f"gd_{uuid.uuid4().hex[:10]}"
    est_in = _estimate_tokens(prompt)

    try:
        _glog("request_start", request_id=req_id, flow="quote_guidance", model=GEMINI_MODEL, est_input_tokens=est_in)
        async with httpx.AsyncClient(timeout=20.0) as client:
            started = time.time()
            for attempt in range(1, 3):
                try:
                    response = await client.post(
                        f"{GEMINI_URL}?key={api_key}",
                        json={
                            "contents": [{"parts": [{"text": prompt}]}],
                            "generationConfig": {"temperature": 0.15, "maxOutputTokens": 180},
                        },
                    )
                    response.raise_for_status()
                    data = response.json()
                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    parsed = _parse_bullets(text)
                    _glog("request_ok", request_id=req_id, flow="quote_guidance", attempt=attempt, latency_ms=int((time.time()-started)*1000))
                    est_out = _estimate_tokens(text)
                    in_t, out_t, total_t = _usage_counts_from_http_json(data)
                    _glog(
                        "token_usage",
                        request_id=req_id,
                        flow="quote_guidance",
                        input_tokens=(in_t if in_t is not None else est_in),
                        output_tokens=(out_t if out_t is not None else est_out),
                        total_tokens=(total_t if total_t is not None else ((in_t if in_t is not None else est_in) + (out_t if out_t is not None else est_out))),
                    )
                    return parsed or _fallback_guidance(rfp, scored_parts, flags)
                except Exception as e:
                    err = str(e)
                    transient = ("429" in err or "503" in err or "quota" in err.lower() or "rate" in err.lower() or "unavailable" in err.lower())
                    backoff = 1 if transient else 0
                    _glog("request_fail", request_id=req_id, flow="quote_guidance", attempt=attempt, transient=str(bool(transient)).lower(), backoff_s=backoff, error=repr(err[:220]))
                    if attempt >= 2 or not transient:
                        raise
                    await asyncio.sleep(backoff)

    except Exception as e:
        print(f"[guidance] Gemini call failed: {e}")
        return _fallback_guidance(rfp, scored_parts, flags)


def _build_prompt(
    rfp: RFPSubmitRequest,
    scored_parts: list[ScoredPart],
    flags: list[Flag],
) -> str:
    top_parts = sorted(scored_parts, key=lambda p: float(p.composite or 0.0), reverse=True)[:2]
    parts_summary = "\n".join(
        f"  - {p.part_id} ({p.description}): composite={p.composite}, "
        f"Requested Fit={p.b1}, Manufacturability Fit={p.b2}, "
        f"Historical Similarity={p.c}, mode={p.scoring_mode}, "
        f"gate={p.gate_status}, dependencies={','.join(p.dependency_tags or []) or 'none'}"
        for p in top_parts
    )

    flags_text = "\n".join(f"  [{f.type.upper()}] {f.title}: {f.body}" for f in (flags or [])[:2]) or "  None"

    top_jobs = []
    for p in top_parts:
        for job in p.matched_jobs[:1]:
            top_jobs.append(
                f"  {job.job_id} | project={job.project_name or 'unknown'} | "
                f"{job.material or 'material unknown'} | {job.process_primary or 'process unknown'} | "
                f"similarity={job.similarity} | outcome={job.outcome or 'unknown'}"
            )
    jobs_text = "\n".join(top_jobs) if top_jobs else "  None available"

    return f"""You are helping a manufacturing supplier decide how to position and write a quote.

Use this scoring language exactly:
- Requested Fit = how closely the buyer's stated request matches the supplier's registered capability profile.
- Manufacturability Fit = what the supplier's actual process history suggests is the right way to make the part, even if the buyer's requested process is imperfect.
- Historical Similarity = how close the supplier's past projects are to this work across geometry and project specs.

RFP:
  Buyer: {rfp.buyer} ({rfp.location or 'location unknown'})
  Project: {rfp.project}
  Required certs: {', '.join(rfp.certs_required) if rfp.certs_required else 'none'}
  Delivery: {rfp.delivery or 'not specified'}
  Buyer priority: {rfp.priority_note or 'not specified'}

Part Scores:
{parts_summary}

Flags:
{flags_text}

Top Matched Past Jobs:
{jobs_text}

Generate exactly 4-5 actionable bid-strategy bullets.
Each bullet MUST be exactly one line (max 14 words).
No bullet may exceed one sentence.
Make them supplier quoting advice, not generic AI commentary.
Focus on:
- what to emphasize in the quote
- whether to quote straight, quote with premium, or qualify the offer
- where manufacturability insight should challenge the buyer's requested process
- what precedent from historical projects to cite
- what risks or disclosures to include

Reference part IDs and matched project/job IDs where relevant.
Return only a numbered list."""


def _parse_bullets(text: str) -> list[str]:
    if not text:
        return []

    normalized = text.replace("```", "").replace("â€¢", "*").replace("\u2022", "*").strip()
    lines = [ln.strip() for ln in normalized.split("\n")]

    bullets: list[str] = []
    for line in lines:
        if not line:
            continue

        lower_line = line.lower()
        if re.search(r"actionable bid[- ]strategy bullets", lower_line):
            continue
        if lower_line in {"quote strategy", "quote guidance", "guidance"}:
            continue

        if re.match(r"^\d+[\.\)]\s+", line) or re.match(r"^[-*]\s+", line):
            cleaned = re.sub(r"^\d+[\.\)]\s*", "", line)
            cleaned = re.sub(r"^[-*]\s*", "", cleaned)
            cleaned = re.sub(r"^\*+\s*", "", cleaned)
            cleaned = re.sub(r"\*+", "", cleaned).strip()
            if cleaned:
                bullets.append(cleaned)
            continue

        if bullets:
            continuation = re.sub(r"\*+", "", line).strip()
            if continuation:
                bullets[-1] = f"{bullets[-1]} {continuation}".strip()
            continue

        plain = re.sub(r"\*+", "", line).strip()
        if plain:
            bullets.append(plain)

    deduped: list[str] = []
    seen = set()
    for b in bullets:
        key = re.sub(r"\s+", " ", b).strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(b.strip())

    compacted: list[str] = []
    for b in deduped:
        one_liner = re.sub(r"\s+", " ", b).strip()
        # Keep guidance crisp in UI.
        if len(one_liner) > 120:
            one_liner = one_liner[:117].rstrip() + "..."
        compacted.append(one_liner)
    return compacted[:5]


def _fallback_guidance(
    rfp: RFPSubmitRequest,
    scored_parts: list[ScoredPart],
    flags: list[Flag],
) -> list[str]:
    bullets: list[str] = []

    strongest = sorted(scored_parts, key=lambda p: p.composite, reverse=True)
    if strongest:
        lead = strongest[0]
        if lead.composite >= 85:
            bullets.append(
                f"Lead with {lead.part_id}; strongest fit and confidence anchor."
            )

    weak_requested = [p.part_id for p in scored_parts if p.b1 is not None and p.b1 < 70]
    if weak_requested:
        bullets.append(
            f"Qualify process on {', '.join(weak_requested)}; state profile gaps and alternatives."
        )

    strong_manufacturing = [p.part_id for p in scored_parts if (p.b2 or 0) >= 80 and ((p.b1 or 100) < (p.b2 or 0))]
    if strong_manufacturing:
        bullets.append(
            f"For {', '.join(strong_manufacturing)}, price recommended route; show cost-quality advantage."
        )

    precedent_jobs = []
    for part in scored_parts:
        for job in part.matched_jobs[:1]:
            precedent_jobs.append((part.part_id, job.job_id, job.project_name))
    if precedent_jobs:
        references = ", ".join(
            f"{part_id} via {job_id}{f' ({project_name})' if project_name else ''}"
            for part_id, job_id, project_name in precedent_jobs[:2]
        )
        bullets.append(
            f"Cite precedent: {references}; use outcomes to de-risk delivery and quality."
        )

    warn_flags = [f for f in flags if f.type == "warn"]
    if warn_flags:
        bullets.append(
            f"Avoid unconditional quote; address {warn_flags[0].title.lower()} with mitigations."
        )

    if rfp.delivery:
        bullets.append(
            "Tie delivery to material readiness, route confirmation, and inspection scope."
        )

    return bullets[:5]

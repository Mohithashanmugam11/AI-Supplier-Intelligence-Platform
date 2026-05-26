# ------------------------------------------------------------
# inference.py - Gemini Vision with rate limit protection
# ------------------------------------------------------------

import os
import json
import re
import time
import uuid
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL   = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
GEMINI_JSON_CONFIG = types.GenerateContentConfig(
    response_mime_type="application/json",
    temperature=0.1,
    max_output_tokens=1200,
)

# Rate limit protection - Gemini free tier = 15 RPM
# We wait 5 seconds between calls = max 12/min, safe buffer
RATE_LIMIT_DELAY = 5

EXTRACTION_PROMPT = """Extract past-project manufacturing facts from one part image plus optional document text.
Return one JSON object only. Prefer text for named specs; image for geometry/features. Do not invent: use ""/null and lower confidence when uncertain.

Classify fast:
- part_family: TURNED=axisymmetric/lathe; MILLED=prismatic/pockets/flat machined; SHEET_METAL=cut/bent plate; MULTI_COMPONENT=assembly; cast/forged/stamped only with clear near-net clues.
- complexity: SIMPLE=single basic form; MODERATE=few features/one setup; COMPLEX=threads,pockets,datum stackups,multi-setup; HIGHLY_COMPLEX=5-axis/freeform/critical fits.
- tolerance: STANDARD=general commercial; PRECISION=tight fits/threads/bearing seats/inspection cues; HIGH_PRECISION=ground,optical,aero/medical critical fits.
- material/finish only if visible or stated. reasoning <=10 words. features max 8 concrete visible items.

JSON schema:
{"part_family":{"value":"TURNED|MILLED|SHEET_METAL|CAST|INJECTION_MOULDED|WELDED|FORGED|STAMPED|MULTI_COMPONENT|OTHER","detail":""},"material":{"value":"","reasoning":""},"process":{"primary":"","secondary":null},"finish":{"value":"","ra_estimate":null},"complexity_class":{"value":"SIMPLE|MODERATE|COMPLEX|HIGHLY_COMPLEX","reasoning":""},"tolerance_class":{"value":"STANDARD|PRECISION|HIGH_PRECISION","reasoning":""},"features":[],"overall_confidence":0.0}"""

TEXT_EXTRACTION_PROMPT = """Extract only explicit past-project/RFQ fields from the document. Return one JSON object only.
Rules: no guessing; missing=""; [] for no certs; normalize dates to YYYY-MM-DD if stated; project_overview <=25 words from explicit scope only.
contact_name=person, not company/title. company_name=organization. project_name=specific title, not generic RFP/Quote/Work Order.
Enums: company_size Small|Medium|Large|Enterprise; customer_industry Aerospace|Automotive|Medical|Industrial|Consumer|Energy|Defense|Other; part_family TURNED|MILLED|SHEET_METAL|CAST|INJECTION_MOULDED|WELDED|FORGED|STAMPED|MULTI_COMPONENT|OTHER.

JSON schema:
{"company_name":"","company_location":"","company_size":"","customer_name":"","contact_name":"","contact_email":"","contact_phone":"","project_name":"","project_overview":"","customer_industry":"","project_date":"YYYY-MM-DD","expected_annual_production_volume":"","mandatory_certifications":[],"certification_notes":"","part_name":"","part_family":"","part_detail":"","material":"","process_primary":"","process_secondary":"","surface_finish":"","tolerance_details":"","quantity":"","part_envelope":""}"""

_last_call_time = 0


def _estimate_tokens(text: str) -> int:
    # Lightweight approximation for observability: ~4 chars/token
    t = str(text or "")
    return max(0, int(round(len(t) / 4)))


def _gemini_log(event: str, **fields):
    payload = " ".join([f"{k}={fields[k]}" for k in sorted(fields.keys())])
    print(f"[gemini] event={event} {payload}".strip())


def _usage_counts_from_genai_response(response) -> tuple[int | None, int | None, int | None]:
    """
    Best-effort extraction of Gemini usage metadata from SDK response object.
    """
    try:
        um = getattr(response, "usage_metadata", None) or getattr(response, "usageMetadata", None)
        if um is None:
            return None, None, None
        in_t = getattr(um, "prompt_token_count", None) or getattr(um, "promptTokenCount", None)
        out_t = getattr(um, "candidates_token_count", None) or getattr(um, "candidatesTokenCount", None)
        total_t = getattr(um, "total_token_count", None) or getattr(um, "totalTokenCount", None)
        return (
            int(in_t) if in_t is not None else None,
            int(out_t) if out_t is not None else None,
            int(total_t) if total_t is not None else None,
        )
    except Exception:
        return None, None, None


def _clean_text(v: str) -> str:
    s = str(v or "").strip()
    if not s:
        return ""
    s = s.replace("**", "")
    s = s.replace("`", "")
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^\|\s*", "", s)
    s = re.sub(r"\s*\|$", "", s)
    return s


def _normalize_project_name(v: str, fallback: str = "") -> str:
    s = _clean_text(v)
    fb = _clean_text(fallback)
    if not s:
        return fb
    if re.match(r"^(issued|date)\s*:", s, flags=re.I):
        return fb
    if re.match(r"^#?\s*request for proposal", s, flags=re.I):
        return fb
    return s


def _is_person_name(s: str) -> bool:
    """Return True only if s looks like a real person's first+last name."""
    if not s or not (3 <= len(s) <= 60):
        return False
    if re.search(r"\d", s):
        return False
    words = s.split()
    if len(words) < 2:
        return False
    # all-caps strings are likely acronyms or company names
    if s == s.upper():
        return False
    # each word must start with a capital letter
    if not all(w[0].isupper() for w in words if w):
        return False
    # reject known non-person patterns
    BAD = re.compile(
        r"\b(inc|llc|ltd|corp|co\.|company|group|solutions|services|"
        r"technologies|industries|manufacturing|request|proposal|rfp|"
        r"quote|order|bone|tones|tone|logo|header|footer|watermark)\b",
        re.I,
    )
    if BAD.search(s):
        return False
    return True


def _normalize_contact_name(value: str) -> str:
    cleaned = _clean_text(value)
    return cleaned[:120] if cleaned and _is_person_name(cleaned) else ""


def _retry_backoff_seconds(err: str) -> int:
    err_l = (err or "").lower()
    if "429" in err_l or "quota" in err_l or "rate" in err_l:
        return 15
    if "503" in err_l or "unavailable" in err_l:
        return 5
    return 1

def run_inference(image_path: str, scores: dict, context_text: str = "") -> dict:
    global _last_call_time

    # Rate limit guard - enforce minimum gap between calls
    elapsed = time.time() - _last_call_time
    if elapsed < RATE_LIMIT_DELAY:
        wait = RATE_LIMIT_DELAY - elapsed
        print(f"  Rate limit pause: {wait:.1f}s")
        time.sleep(wait)

    try:
        result = gemini_extract(image_path, context_text=context_text)
        _last_call_time = time.time()
        return result
    except Exception as e:
        _last_call_time = time.time()
        print(f"  Gemini failed: {e} - using fallback")
        return rule_based_fallback(scores)


def run_text_inference(context_text: str = "") -> dict:
    """
    Text-only extraction path for PDF/Word-heavy uploads where no image/CAD exists.
    Uses Gemini when available; falls back to lightweight regex heuristics.
    """
    txt = (context_text or "").strip()
    if not txt:
        return _text_fallback("")

    global _last_call_time
    elapsed = time.time() - _last_call_time
    if elapsed < RATE_LIMIT_DELAY:
        time.sleep(RATE_LIMIT_DELAY - elapsed)

    try:
        if not GEMINI_API_KEY:
            return _text_fallback(txt)
        result = gemini_extract_text(txt)
        _last_call_time = time.time()
        return result
    except Exception:
        _last_call_time = time.time()
        return _text_fallback(txt)


def gemini_extract(image_path: str, context_text: str = "") -> dict:
    image_bytes = Path(image_path).read_bytes()
    ext = Path(image_path).suffix.lower().lstrip('.')
    mime_map = {
        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
        'png': 'image/png',  'webp': 'image/webp',
        'bmp': 'image/bmp'
    }
    mime_type = mime_map.get(ext, 'image/jpeg')

    prompt = EXTRACTION_PROMPT
    ctx = (context_text or "").strip()
    if ctx:
        prompt = f"{EXTRACTION_PROMPT}\n\nCONTEXT DOC:\n{ctx[:2000]}"

    req_id = f"gx_{uuid.uuid4().hex[:10]}"
    est_in = _estimate_tokens(prompt)
    _gemini_log(
        "request_start",
        request_id=req_id,
        flow="vision_extract",
        model=GEMINI_MODEL,
        est_input_tokens=est_in,
        image_bytes=len(image_bytes),
        mime_type=mime_type,
    )
    client = genai.Client(api_key=GEMINI_API_KEY)
    started = time.time()
    max_attempts = 2
    last_err = None
    response = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[
                    types.Part(text=prompt),
                    types.Part(inline_data=types.Blob(mime_type=mime_type, data=image_bytes)),
                ],
                config=GEMINI_JSON_CONFIG,
            )
            elapsed_ms = int((time.time() - started) * 1000)
            raw_text = (getattr(response, "text", "") or "")
            est_out = _estimate_tokens(raw_text)
            in_t, out_t, total_t = _usage_counts_from_genai_response(response)
            _gemini_log(
                "request_ok",
                request_id=req_id,
                flow="vision_extract",
                attempt=attempt,
                latency_ms=elapsed_ms,
                input_tokens=(in_t if in_t is not None else est_in),
                output_tokens=(out_t if out_t is not None else est_out),
                total_tokens=(total_t if total_t is not None else ((in_t if in_t is not None else est_in) + (out_t if out_t is not None else est_out))),
            )
            break
        except Exception as e:
            last_err = e
            err = str(e)
            transient = ("429" in err or "503" in err or "quota" in err.lower() or "rate" in err.lower() or "unavailable" in err.lower())
            backoff = _retry_backoff_seconds(err) if transient else 0
            _gemini_log(
                "request_fail",
                request_id=req_id,
                flow="vision_extract",
                attempt=attempt,
                transient=str(bool(transient)).lower(),
                backoff_s=backoff,
                error=repr(err[:240]),
            )
            if attempt >= max_attempts or not transient:
                break
            time.sleep(backoff)
    if response is None:
        _gemini_log(
            "request_final_fail",
            request_id=req_id,
            flow="vision_extract",
            est_input_tokens=est_in,
            error=repr(str(last_err)[:240]) if last_err else "unknown",
        )
        raise last_err or RuntimeError("Gemini generate_content failed")

    raw = (getattr(response, "text", "") or "").strip()
    raw = re.sub(r'^```(?:json)?\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)
    raw = raw.strip()

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        _gemini_log(
            "parse_fail",
            request_id=req_id,
            flow="vision_extract",
            error=repr(str(e)[:240]),
        )
        return rule_based_fallback(scores)

    conf = float(parsed.get("overall_confidence", 0.9))

    return {
        "part_family": {
            "value":      parsed["part_family"]["value"],
            "detail":     parsed["part_family"].get("detail", ""),
            "confidence": conf,
        },
        "material": {
            "value":      parsed["material"]["value"],
            "reasoning":  parsed["material"].get("reasoning", ""),
            "confidence": conf,
        },
        "process": {
            "primary":    parsed["process"]["primary"],
            "secondary":  parsed["process"].get("secondary") or "-",
            "confidence": conf,
        },
        "finish": {
            "value":      parsed["finish"]["value"],
            "ra_estimate":parsed["finish"].get("ra_estimate") or "-",
            "confidence": conf,
        },
        "complexity_class": {
            "value":     parsed.get("complexity_class", {}).get("value", ""),
            "reasoning": parsed.get("complexity_class", {}).get("reasoning", ""),
        },
        "tolerance_class": {
            "value":     parsed.get("tolerance_class", {}).get("value", ""),
            "reasoning": parsed.get("tolerance_class", {}).get("reasoning", ""),
        },
        "features": parsed.get("features", []),
        "notes":    parsed.get("notes"),
        "source":   "gemini",
    }


def gemini_extract_text(context_text: str) -> dict:
    txt = (context_text or "").strip()[:18000]
    req_id = f"gt_{uuid.uuid4().hex[:10]}"
    est_in = _estimate_tokens(f"{TEXT_EXTRACTION_PROMPT}\n\nDocument Text:\n{txt}")
    _gemini_log(
        "request_start",
        request_id=req_id,
        flow="text_extract",
        model=GEMINI_MODEL,
        est_input_tokens=est_in,
        text_chars=len(txt),
    )
    client = genai.Client(api_key=GEMINI_API_KEY)
    started = time.time()
    max_attempts = 2
    last_err = None
    response = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[
                    types.Part(text=TEXT_EXTRACTION_PROMPT),
                    types.Part(text=f"Document Text:\n{txt}"),
                ],
                config=GEMINI_JSON_CONFIG,
            )
            elapsed_ms = int((time.time() - started) * 1000)
            raw_text = (getattr(response, "text", "") or "")
            est_out = _estimate_tokens(raw_text)
            in_t, out_t, total_t = _usage_counts_from_genai_response(response)
            _gemini_log(
                "request_ok",
                request_id=req_id,
                flow="text_extract",
                attempt=attempt,
                latency_ms=elapsed_ms,
                input_tokens=(in_t if in_t is not None else est_in),
                output_tokens=(out_t if out_t is not None else est_out),
                total_tokens=(total_t if total_t is not None else ((in_t if in_t is not None else est_in) + (out_t if out_t is not None else est_out))),
            )
            break
        except Exception as e:
            last_err = e
            err = str(e)
            transient = ("429" in err or "503" in err or "quota" in err.lower() or "rate" in err.lower() or "unavailable" in err.lower())
            backoff = _retry_backoff_seconds(err) if transient else 0
            _gemini_log(
                "request_fail",
                request_id=req_id,
                flow="text_extract",
                attempt=attempt,
                transient=str(bool(transient)).lower(),
                backoff_s=backoff,
                error=repr(err[:240]),
            )
            if attempt >= max_attempts or not transient:
                break
            time.sleep(backoff)
    if response is None:
        _gemini_log(
            "request_final_fail",
            request_id=req_id,
            flow="text_extract",
            est_input_tokens=est_in,
            error=repr(str(last_err)[:240]) if last_err else "unknown",
        )
        raise last_err or RuntimeError("Gemini text generate_content failed")

    raw = (response.text or "").strip()
    raw = re.sub(r'^```(?:json)?\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)
    try:
        parsed = json.loads(raw or "{}")
    except json.JSONDecodeError as e:
        _gemini_log(
            "parse_fail",
            request_id=req_id,
            flow="text_extract",
            error=repr(str(e)[:240]),
        )
        return _text_fallback(txt)

    certs = parsed.get("mandatory_certifications", [])
    if isinstance(certs, str):
        certs = [c.strip() for c in certs.split(",") if c.strip()]
    if not isinstance(certs, list):
        certs = []

    customer_name = _clean_text(parsed.get("customer_name", ""))
    company_name = _clean_text(parsed.get("company_name", ""))
    if len(company_name.split()) >= 14 or len(company_name) > 120:
        company_name = customer_name
    project_name = _normalize_project_name(parsed.get("project_name", ""), customer_name)

    return {
        "company_name": company_name,
        "company_location": _clean_text(parsed.get("company_location", "")),
        "company_size": _clean_text(parsed.get("company_size", "")),
        "customer_name": customer_name,
        "contact_name": _normalize_contact_name(parsed.get("contact_name", "")),
        "contact_email": _clean_text(parsed.get("contact_email", "")).lower(),
        "contact_phone": _clean_text(parsed.get("contact_phone", "")),
        "project_name": project_name,
        "project_overview": _clean_text(parsed.get("project_overview", "")),
        "customer_industry": _clean_text(parsed.get("customer_industry", "")),
        "project_date": _clean_text(parsed.get("project_date", "")),
        "expected_annual_production_volume": _clean_text(parsed.get("expected_annual_production_volume", "")),
        "mandatory_certifications": certs,
        "certification_notes": _clean_text(parsed.get("certification_notes", "")),
        "part_name": _clean_text(parsed.get("part_name", "")),
        "part_family": _clean_text(parsed.get("part_family", "")),
        "part_detail": _clean_text(parsed.get("part_detail", "")),
        "material": _clean_text(parsed.get("material", "")),
        "process_primary": _clean_text(parsed.get("process_primary", "")),
        "process_secondary": _clean_text(parsed.get("process_secondary", "")),
        "surface_finish": _clean_text(parsed.get("surface_finish", "")),
        "tolerance_details": _clean_text(parsed.get("tolerance_details", "")),
        "quantity": _clean_text(parsed.get("quantity", "")),
        "part_envelope": _clean_text(parsed.get("part_envelope", "")),
        "source": "gemini_text",
    }


def _text_fallback(context_text: str) -> dict:
    txt = (context_text or "").strip()
    lines = [ln.strip() for ln in txt.splitlines() if ln.strip()]
    joined = " ".join(lines)
    lower = joined.lower()

    def _m(pat):
        m = re.search(pat, joined, flags=re.I)
        return (m.group(1).strip() if m else "")

    project_name = ""
    for ln in lines[:30]:
        if 6 <= len(ln) <= 120 and not re.search(r"\b(rfp|request for proposal|quote|quotation|work order)\b", ln, re.I):
            project_name = ln
            break

    industry = ""
    for key, label in [
        ("aerospace", "Aerospace"),
        ("medical", "Medical"),
        ("automotive", "Automotive"),
        ("industrial", "Industrial"),
        ("consumer", "Consumer"),
        ("energy", "Energy"),
        ("defense", "Defense"),
        ("defence", "Defense"),
    ]:
        if key in lower:
            industry = label
            break

    cert_map = [
        ("iso 9001", "ISO 9001"),
        ("as9100", "AS9100"),
        ("iatf 16949", "IATF 16949"),
        ("iso 13485", "ISO 13485"),
        ("iso 14001", "ISO 14001"),
        ("iso 45001", "ISO 45001 / OHSAS 18001"),
        ("ohsas 18001", "ISO 45001 / OHSAS 18001"),
        ("iso 50001", "ISO 50001"),
        ("itar", "ITAR Registration"),
        ("rohs", "RoHS Compliance"),
        ("reach", "REACH Compliance"),
        ("nadcap", "NADCAP"),
        ("fda", "FDA Registration / GMP"),
        ("gmp", "FDA Registration / GMP"),
        ("iso/ts 22163", "ISO/TS 22163 (IRIS)"),
        ("iris", "ISO/TS 22163 (IRIS)"),
        ("ce marking", "CE Marking"),
        ("csa", "CSA Certification"),
        ("iso/iec 27001", "ISO/IEC 27001"),
    ]
    certs = []
    for needle, label in cert_map:
        if needle in lower and label not in certs:
            certs.append(label)

    qty = _m(r"\b(?:qty|quantity|volume)\s*[:\-]?\s*([0-9][0-9, ]{0,20}(?:pcs|pieces|ea|units)?)")
    material = _m(r"\b(?:material|matl)\s*[:\-]?\s*([A-Za-z0-9 \-\/\.,]{3,80})")
    process = _m(r"\b(?:process|manufacturing process)\s*[:\-]?\s*([A-Za-z0-9 \-\/\.,]{3,80})")
    finish = _m(r"\b(?:finish|surface finish)\s*[:\-]?\s*([A-Za-z0-9 \-\/\.,umraRA]{2,100})")
    tol = _m(r"\b(?:tolerance|tol)\s*[:\-]?\s*([A-Za-z0-9 +/-\+\-\.\"um\/]{2,120})")

    company_name = _m(r"\b(?:company name|supplier name|vendor|account name)\s*[:\-]?\s*([^\n\r]{2,120})")
    customer_name = _m(r"\b(?:customer name|buyer|client)\s*[:\-]?\s*([^\n\r]{2,120})")
    contact_name = _m(r"\b(?:contact name|attention|attn)\s*[:\-]?\s*([^\n\r]{2,120})")
    contact_email = _m(r"\b(?:contact email|email)\s*[:\-]?\s*([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})")
    if not contact_email:
        m_email = re.search(r"([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})", joined)
        contact_email = (m_email.group(1).strip().lower() if m_email else "")
    contact_phone = _m(r"\b(?:contact (?:phone|number)|phone|mobile|tel)\s*[:\-]?\s*([\+\d][\d\-\(\) ]{6,30})")
    company_location = _m(r"\b(?:company location|location|address)\s*[:\-]?\s*([^\n\r]{3,140})")
    project_date = _m(r"\b(?:project date|date)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})")

    return {
        "company_name": _clean_text(company_name)[:120],
        "company_location": company_location[:140],
        "company_size": "",
        "customer_name": _clean_text(customer_name)[:120],
        "contact_name": _normalize_contact_name(contact_name),
        "contact_email": contact_email[:120],
        "contact_phone": contact_phone[:40],
        "project_name": _normalize_project_name(project_name, customer_name)[:120],
        "project_overview": joined[:900],
        "customer_industry": industry,
        "project_date": project_date[:10],
        "expected_annual_production_volume": qty[:80],
        "mandatory_certifications": certs,
        "certification_notes": "",
        "part_name": project_name[:120],
        "part_family": "",
        "part_detail": "",
        "material": material[:80],
        "process_primary": process[:80],
        "process_secondary": "",
        "surface_finish": finish[:120],
        "tolerance_details": tol[:120],
        "quantity": qty[:60],
        "part_envelope": "",
        "source": "text_fallback",
    }


def rule_based_fallback(scores: dict) -> dict:
    circ = scores.get("circularity", 0)
    sym  = scores.get("symmetry_score", 0)
    ar   = scores.get("aspect_ratio", 1)
    conv = scores.get("convexity", 1)
    fc   = scores.get("feature_complexity", 0)
    ref  = scores.get("reflectivity", 0)
    sd   = scores.get("surface_std_dev", 0)
    mb   = scores.get("mean_brightness", 128)

    if circ > 0.75 and sym > 0.80:  fam, fconf = "TURNED", 0.65
    elif ar > 2.5 and sym > 0.65:   fam, fconf = "TURNED", 0.60
    elif conv < 0.70 and fc > 0.55: fam, fconf = "MILLED", 0.60
    elif fc > 0.45 and conv < 0.85: fam, fconf = "MILLED", 0.55
    else:                            fam, fconf = "OTHER",  0.40

    if mb > 200 and sd < 40:         mat, mconf = "Plastic / Nylon", 0.65
    elif ref > 0.20 and mb > 155:    mat, mconf = "Stainless Steel", 0.60
    elif mb > 100 and mb < 185:      mat, mconf = "Aluminum Alloy",  0.50
    else:                            mat, mconf = "Steel / Alloy",   0.40

    return {
        "part_family":     {"value": fam,           "detail": "", "confidence": fconf},
        "material":        {"value": mat,           "reasoning": "rule-based fallback", "confidence": mconf},
        "process":         {"primary": "CNC Milling","secondary": "-", "confidence": 0.40},
        "finish":          {"value": "As-Machined", "ra_estimate": "-", "confidence": 0.40},
        "complexity_class":{"value": "", "reasoning": ""},
        "tolerance_class": {"value": "", "reasoning": ""},
        "features":        [],
        "notes":           "Gemini unavailable - rule-based fallback. Do NOT push this to Pinecone without manual correction.",
        "source":          "fallback",
    }


def print_inference(inf: dict):
    src = inf.get("source", "?")
    print(f"\n  INFERRED PROPERTIES  [{src.upper()}]")
    print(f"  {'-'*45}")
    pf = inf['part_family']
    print(f"  Part Family   : {pf['value']}  ({int(pf['confidence']*100)}% conf)")
    if pf.get('detail'): print(f"                  {pf['detail']}")
    mat = inf['material']
    print(f"  Material      : {mat['value']}  ({int(mat['confidence']*100)}% conf)")
    if mat.get('reasoning'): print(f"                  {mat['reasoning']}")
    proc = inf['process']
    print(f"  Primary Proc  : {proc['primary']}  ({int(proc['confidence']*100)}% conf)")
    print(f"  Secondary     : {proc['secondary']}")
    fin = inf['finish']
    print(f"  Finish        : {fin['value']}  - {fin['ra_estimate']}  ({int(fin['confidence']*100)}% conf)")
    if inf.get('features'):
        for f in inf['features']: print(f"    . {f}")
    if inf.get('notes'): print(f"\n  Notes: {inf['notes']}")

"""
TrustBridge — RFP Router
POST /api/rfp/parse  — Gemini extracts structured fields from raw RFP text
POST /api/rfp/submit — validates and returns RFP with a generated id
Nothing stored anywhere.
"""

import os
import re
import json
import uuid
import base64
import io
import asyncio
from pathlib import Path
from collections import deque
from datetime import datetime, timezone
import httpx
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import List
from models import RFPSubmitRequest
from assessment.visual_extractor import file_to_images_b64

router = APIRouter()
RECENT_RFPS = deque(maxlen=200)
MAX_UPLOAD_FILES = int(os.getenv("MAX_UPLOAD_FILES", "10"))
MAX_PARSE_EXTRACTED_IMAGES = int(os.getenv("MAX_PARSE_EXTRACTED_IMAGES", "20"))

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite").strip()
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)
PARSE_PROMPT_MAX_CHARS = int(os.getenv("RFP_PARSE_PROMPT_MAX_CHARS", "22000"))
PDF_CHUNK_ENABLE_THRESHOLD_PAGES = int(os.getenv("PDF_CHUNK_ENABLE_THRESHOLD_PAGES", "25"))
PDF_CHUNK_PAGE_SIZE = max(1, int(os.getenv("PDF_CHUNK_PAGE_SIZE", "10")))
PDF_CHUNK_MIN_SUCCESS = max(1, int(os.getenv("PDF_CHUNK_MIN_SUCCESS", "1")))
PDF_CHUNK_RETRY_PROMPT_MAX_CHARS = int(
    os.getenv("PDF_CHUNK_RETRY_PROMPT_MAX_CHARS", str(max(4000, PARSE_PROMPT_MAX_CHARS // 2)))
)


def _estimate_tokens(text: str) -> int:
    return max(0, int(round(len(str(text or "")) / 4)))


def _trim_prompt_text(text: str, limit: int = PARSE_PROMPT_MAX_CHARS) -> str:
    raw = str(text or "").strip()
    if len(raw) <= limit:
        return raw
    # Preserve both opening context and trailing requirement-heavy sections.
    head = int(limit * 0.65)
    tail = max(0, limit - head - 64)
    return f"{raw[:head]}\n\n[...TRUNCATED FOR TOKEN CONTROL...]\n\n{raw[-tail:]}"


def _choose_isometric_cad_view(images_b64: list[str]) -> str | None:
    """
    Use CAD isometric view for processing.
    visual_extractor currently emits: [front-iso, side-iso, top],
    so index 0 is the default isometric view.
    """
    if not images_b64:
        return None
    return images_b64[0]


def _cap_images(images: list[str], limit: int) -> list[str]:
    if limit <= 0 or len(images) <= limit:
        return images
    print(f"[parse-file] Image payload capped: {len(images)} -> {limit}")
    return images[:limit]


class ParseRequest(BaseModel):
    text: str


def _extract_buyer_from_text(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""

    patterns = [
        r"(?im)^\s*(buyer|company|customer|client company name)\s*[:\-]\s*([^\n\r]{2,120})\s*$",
        r"(?im)^\s*from\s+([A-Z][A-Za-z0-9&.,'()\- ]{2,120})\s*$",
    ]
    for pattern in patterns:
        m = re.search(pattern, raw)
        if m:
            candidate = (m.group(2) if m.lastindex and m.lastindex >= 2 else m.group(1)).strip()
            candidate = re.sub(r"\s{2,}", " ", candidate)
            if candidate and "client company name" not in candidate.lower():
                return candidate
    return ""


def _extract_email_from_text(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    m = re.search(r"([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})", raw, flags=re.I)
    return (m.group(1) or "").strip() if m else ""


def _extract_pdf_text_with_fallback(raw_bytes: bytes) -> str:
    """
    Extract text from PDF robustly:
    1) pypdf (fast for text-based PDFs)
    2) PyMuPDF fallback (handles many PDFs where pypdf returns little/no text)
    3) pdfplumber fallback (often better for table-heavy PDFs)
    """
    text_chunks: list[str] = []

    # Primary: pypdf
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(raw_bytes))
        text_chunks.extend((page.extract_text() or "") for page in reader.pages)
        joined = "\n".join(text_chunks).strip()
        if len(joined) >= 40:
            return joined
    except Exception as e:
        print(f"[parse-file] pypdf extraction fallback triggered: {e}")

    # Fallback: PyMuPDF text extraction
    try:
        import fitz  # pymupdf
        doc = fitz.open(stream=raw_bytes, filetype="pdf")
        fitz_chunks = []
        for page in doc:
            fitz_chunks.append(page.get_text("text") or "")
        joined = "\n".join(fitz_chunks).strip()
        if len(joined) >= 40:
            return joined
    except Exception as e:
        print(f"[parse-file] PyMuPDF extraction failed: {e}")

    # Fallback: pdfplumber text extraction (table/layout friendly)
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
            plumber_chunks = [(page.extract_text() or "") for page in pdf.pages]
        joined = "\n".join(plumber_chunks).strip()
        if len(joined) >= 40:
            return joined
    except Exception as e:
        print(f"[parse-file] pdfplumber extraction failed: {e}")

    return ""


def _extract_pdf_pages_text_with_fallback(raw_bytes: bytes, filename: str = "") -> tuple[list[str], str]:
    """
    Return per-page extracted text and source extractor label.
    Tries pypdf -> PyMuPDF -> pdfplumber and keeps page alignment.
    """
    page_texts: list[str] = []
    source = ""

    # Primary: pypdf (per-page)
    try:
        import pypdf

        reader = pypdf.PdfReader(io.BytesIO(raw_bytes))
        page_texts = [(page.extract_text() or "") for page in reader.pages]
        total_chars = sum(len(t or "") for t in page_texts)
        print(
            f"[parse-file][pdf] extractor=pypdf file={filename or '-'} "
            f"pages={len(page_texts)} chars={total_chars}"
        )
        if total_chars >= 40:
            return page_texts, "pypdf"
    except Exception as e:
        print(f"[parse-file][pdf] extractor=pypdf failed file={filename or '-'} err={e}")

    # Fallback: PyMuPDF (per-page)
    try:
        import fitz  # pymupdf

        doc = fitz.open(stream=raw_bytes, filetype="pdf")
        page_texts = [(page.get_text("text") or "") for page in doc]
        total_chars = sum(len(t or "") for t in page_texts)
        print(
            f"[parse-file][pdf] extractor=pymupdf file={filename or '-'} "
            f"pages={len(page_texts)} chars={total_chars}"
        )
        if total_chars >= 40:
            return page_texts, "pymupdf"
    except Exception as e:
        print(f"[parse-file][pdf] extractor=pymupdf failed file={filename or '-'} err={e}")

    # Fallback: pdfplumber (per-page)
    try:
        import pdfplumber

        with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
            page_texts = [(page.extract_text() or "") for page in pdf.pages]
        total_chars = sum(len(t or "") for t in page_texts)
        print(
            f"[parse-file][pdf] extractor=pdfplumber file={filename or '-'} "
            f"pages={len(page_texts)} chars={total_chars}"
        )
        return page_texts, "pdfplumber"
    except Exception as e:
        print(f"[parse-file][pdf] extractor=pdfplumber failed file={filename or '-'} err={e}")

    return [], source


def _page_chunks(page_texts: list[str], size: int) -> list[tuple[int, int, str]]:
    """
    Build 1-based page chunk tuples: (start_page, end_page, text).
    """
    out: list[tuple[int, int, str]] = []
    if not page_texts:
        return out
    n = len(page_texts)
    step = max(1, int(size or 1))
    for start in range(0, n, step):
        end = min(start + step, n)
        chunk_text = "\n\n".join((page_texts[start:end] or [])).strip()
        out.append((start + 1, end, chunk_text))
    return out


def _norm_part_key(part: dict) -> str:
    def n(v: str) -> str:
        txt = str(v or "").strip().lower()
        txt = re.sub(r"\s+", " ", txt)
        return txt
    return "|".join(
        [
            n(part.get("description", "")),
            n(part.get("material", "")),
            n(part.get("process", "")),
            n(part.get("tolerance", "")),
        ]
    )


def _merge_parsed_payloads(chunks: list[dict]) -> dict:
    merged = _empty_parse()
    if not chunks:
        return merged

    scalar_fields = [
        "contact_name",
        "contact_email",
        "contact_phone",
        "buyer",
        "company_name",
        "company_location",
        "company_size",
        "company_industry",
        "location",
        "project_name",
        "project_description",
        "other_project_requirements",
        "expected_annual_production_volume",
        "certification_notes",
        "customer_account_name",
        "customer_industry",
        "project_date",
        "project",
        "geo_preference",
        "delivery",
        "priority_note",
    ]

    for field in scalar_fields:
        best = ""
        for ch in chunks:
            v = str((ch or {}).get(field, "") or "").strip()
            if len(v) > len(best):
                best = v
        merged[field] = best

    certs_required: list[str] = []
    mandatory: list[str] = []
    seen_c = set()
    seen_m = set()
    for ch in chunks:
        for c in (ch.get("certs_required") or []):
            txt = str(c or "").strip()
            k = txt.lower()
            if txt and k not in seen_c:
                seen_c.add(k)
                certs_required.append(txt)
        for c in (ch.get("mandatory_certifications") or []):
            txt = str(c or "").strip()
            k = txt.lower()
            if txt and k not in seen_m:
                seen_m.add(k)
                mandatory.append(txt)
    merged["certs_required"] = certs_required
    merged["mandatory_certifications"] = mandatory

    merged_parts: list[dict] = []
    seen_parts = set()
    part_idx = 1
    for ch in chunks:
        for part in (ch.get("parts") or []):
            if not isinstance(part, dict):
                continue
            key = _norm_part_key(part)
            if key in seen_parts:
                continue
            seen_parts.add(key)
            row = {
                "id": str(part.get("id") or f"P-{part_idx:03d}").strip() or f"P-{part_idx:03d}",
                "description": str(part.get("description") or "").strip(),
                "material": str(part.get("material") or "").strip(),
                "process": str(part.get("process") or "").strip(),
                "tolerance": str(part.get("tolerance") or "").strip(),
                "qty": part.get("qty", 1),
            }
            merged_parts.append(row)
            part_idx += 1
    merged["parts"] = merged_parts
    return _sanitize_parse_payload(merged)


def _looks_like_email_thread(text: str) -> bool:
    raw = (text or "").lower()
    if not raw:
        return False
    signals = 0
    for pat in (
        r"^\s*from\s*:",
        r"^\s*to\s*:",
        r"^\s*cc\s*:",
        r"^\s*subject\s*:",
        r"^\s*sent\s*:",
        r"^\s*date\s*:",
        r"^\s*regards\b",
        r"^\s*best regards\b",
        r"^\s*thanks\b",
        r"^[-_]{2,}\s*original message\s*[-_]{2,}",
    ):
        if re.search(pat, raw, flags=re.I | re.M):
            signals += 1
    return signals >= 2


def _clean_email_thread_text(text: str) -> str:
    """
    Remove common email-thread noise while preserving RFQ content.
    Keeps lines containing manufacturing/project signal even if near headers.
    """
    raw = (text or "").replace("\r\n", "\n")
    if not raw.strip():
        return ""

    keep_hard = re.compile(
        r"(part\s*name|material|process|quantity|qty|finish|tolerance|delivery|lead\s*time|"
        r"drawing|rev\b|rfq|rfp|po[-\s]?\d+|price|setup\s*cost|inspection|volume|units?/year|"
        r"outcome|lesson\s*learned|project)",
        re.I,
    )
    drop_line = re.compile(
        r"^\s*(from|to|cc|bcc|subject|sent|date)\s*:\s*.*$|"
        r"^\s*(hi|hello|dear)\b.*$|"
        r"^\s*(regards|best regards|thanks|thank you)\b.*$|"
        r"^\s*[-_]{2,}\s*original message\s*[-_]{2,}\s*$|"
        r"^\s*this e-?mail.*(confidential|privileged).*$|"
        r"^\s*please consider the environment before printing.*$",
        re.I,
    )

    lines = [ln.rstrip() for ln in raw.split("\n")]
    cleaned: list[str] = []
    for ln in lines:
        s = ln.strip()
        if not s:
            cleaned.append("")
            continue
        if keep_hard.search(s):
            cleaned.append(s)
            continue
        if drop_line.search(s):
            continue
        # Remove obvious standalone email addresses/phone signatures.
        if re.fullmatch(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", s, flags=re.I):
            continue
        if re.fullmatch(r"[\+\(]?[0-9\-\(\)\s]{7,}$", s):
            continue
        cleaned.append(s)

    # Compress repeated blank lines.
    out: list[str] = []
    last_blank = False
    for ln in cleaned:
        blank = not ln.strip()
        if blank and last_blank:
            continue
        out.append(ln)
        last_blank = blank
    return "\n".join(out).strip()


@router.post("/parse-file")
async def parse_rfp_file(files: List[UploadFile] = File(None), text: str = Form(None)):
    """
    Accepts one or more files and optional text. For each file, extract text and images, then merge with provided text.
    """
    all_text = []
    extracted_images = []
    extracted_image_sources = []
    cad_extracted_images = []
    non_cad_extracted_images = []
    cad_primary_images = []
    uploaded_images = []
    cad_file_status = []
    segment_texts: list[str] = []
    large_pdf_chunks: list[dict] = []
    chunk_mode_enabled = False

    if not files and not text:
        return _empty_parse()
    if files and len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_UPLOAD_FILES} files allowed per upload.")

    if text and text.strip():
        provided = text.strip()
        if _looks_like_email_thread(provided):
            cleaned = _clean_email_thread_text(provided)
            if cleaned:
                provided = cleaned
                print(f"[parse-file] Email-thread cleanup applied to provided text ({len(provided)} chars)")
        all_text.append(provided)
        segment_texts.append(provided)
        print(f"[parse-file] Added provided text ({len(provided)} chars)")

    if files:
        image_exts = {"jpg", "jpeg", "png", "webp", "bmp", "avif"}
        cad_exts = {"step", "stp", "iges", "igs", "stl", "obj", "ply", "glb", "gltf", "3mf"}
        doc_exts = {"doc", "docx", "txt", "md", "rtf", "csv", "tsv", "json"}
        for file in files:
            ext = Path(file.filename or "").suffix.lstrip(".").lower()
            raw_bytes = await file.read()
            print(f"[parse-file] Received: {file.filename} ({len(raw_bytes)} bytes) ext={ext}")

            # Route only visual-bearing files through image extractor.
            if ext in image_exts or ext in cad_exts or ext == "pdf":
                file_images = file_to_images_b64(raw_bytes, file.filename)
            else:
                file_images = []
            is_cad_ext = ext in cad_exts
            if is_cad_ext:
                geometry_available = ext != "3mf" and len(file_images) > 0
                cad_file_status.append({
                    "filename": file.filename,
                    "extension": ext,
                    "images_extracted": len(file_images),
                    "cad_parse_mode": "mesh" if geometry_available else ("preview_only_or_unavailable" if ext == "3mf" else "failed"),
                    "geometry_available": bool(geometry_available),
                    "geometry_source": "mesh" if geometry_available else ("3mf_preview_or_none" if ext == "3mf" else "none"),
                })
            # For CAD uploads:
            # - keep all rendered views for UI preview (typically 3 views)
            # - separately track one isometric view for scoring/overall image default
            if is_cad_ext and file_images:
                iso = _choose_isometric_cad_view(file_images)
                if iso:
                    cad_primary_images.append(iso)
                print(f"[parse-file] CAD views for {file.filename}: {len(file_images)} (using isometric for processing)")
            if ext in image_exts:
                uploaded_images.extend(file_images)
                print(f"[parse-file] Captured {len(file_images)} uploaded image(s) from {file.filename}")
            else:
                extracted_images.extend(file_images)
                if ext in cad_exts:
                    cad_extracted_images.extend(file_images)
                    extracted_image_sources.extend(["cad"] * len(file_images))
                else:
                    non_cad_extracted_images.extend(file_images)
                    extracted_image_sources.extend(["doc"] * len(file_images))
                print(f"[parse-file] Extracted {len(file_images)} images from {file.filename}")

            # Extract text from file when supported
            extracted_text = ""
            try:
                if ext == 'txt':
                    extracted_text = raw_bytes.decode('utf-8', errors='ignore')

                elif ext == 'pdf':
                    page_texts, extractor_name = _extract_pdf_pages_text_with_fallback(raw_bytes, file.filename or "")
                    page_count = len(page_texts)
                    extracted_text = "\n".join(page_texts).strip()
                    if extracted_text:
                        print(
                            f"[parse-file] PDF extracted chars={len(extracted_text)} "
                            f"pages={page_count} extractor={extractor_name or 'unknown'}"
                        )
                    else:
                        print(
                            f"[parse-file] PDF extracted 0 chars pages={page_count} "
                            "(likely scanned/image-only PDF)"
                        )

                    if page_count >= PDF_CHUNK_ENABLE_THRESHOLD_PAGES:
                        chunk_mode_enabled = True
                        chunks = _page_chunks(page_texts, PDF_CHUNK_PAGE_SIZE)
                        non_empty_chunks = 0
                        for cidx, (p_start, p_end, ctext) in enumerate(chunks, start=1):
                            if not ctext.strip():
                                print(
                                    f"[parse-file][chunk] skip_empty file={file.filename} "
                                    f"chunk={cidx}/{len(chunks)} pages={p_start}-{p_end}"
                                )
                                continue
                            non_empty_chunks += 1
                            large_pdf_chunks.append(
                                {
                                    "filename": file.filename or "",
                                    "chunk_index": cidx,
                                    "chunk_total": len(chunks),
                                    "page_start": p_start,
                                    "page_end": p_end,
                                    "text": ctext,
                                }
                            )
                        print(
                            f"[parse-file][chunk] large_pdf_detected file={file.filename} "
                            f"pages={page_count} threshold={PDF_CHUNK_ENABLE_THRESHOLD_PAGES} "
                            f"chunks_total={len(chunks)} chunks_non_empty={non_empty_chunks} "
                            f"chunk_size_pages={PDF_CHUNK_PAGE_SIZE}"
                        )

                elif ext == 'docx':
                    import io
                    import docx
                    doc = docx.Document(io.BytesIO(raw_bytes))
                    extracted_text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
                    print(f"[parse-file] DOCX extracted {len(extracted_text)} chars")

                elif ext not in (image_exts | cad_exts | {"pdf"} | doc_exts):
                    print(f"[parse-file] Unsupported ext: {ext}")

            except Exception as e:
                print(f"[parse-file] Text extraction failed for {file.filename}: {e}")

            if extracted_text.strip():
                normalized = extracted_text.strip()
                if _looks_like_email_thread(normalized):
                    cleaned = _clean_email_thread_text(normalized)
                    if cleaned:
                        print(
                            f"[parse-file] Email-thread cleanup applied for {file.filename} "
                            f"({len(normalized)} -> {len(cleaned)} chars)"
                        )
                        normalized = cleaned
                all_text.append(normalized)
                segment_texts.append(normalized)

    if not all_text:
        print(f"[parse-file] No text extracted from uploaded files")
        prioritized_extracted = (
            (cad_extracted_images + non_cad_extracted_images)
            if cad_extracted_images
            else extracted_images
        )
        prioritized_sources = (
            (["cad"] * len(cad_extracted_images)) + (["doc"] * len(non_cad_extracted_images))
            if cad_extracted_images
            else extracted_image_sources
        )
        print(
            f"[parse-file] Image routing: CAD={len(cad_extracted_images)} "
            f"nonCAD={len(non_cad_extracted_images)} prioritized={len(prioritized_extracted)}"
        )
        if len(cad_extracted_images) == 0 and len(non_cad_extracted_images) == 0:
            print(
                "[parse-file][warn] No extracted images were routed. "
                "This usually means uploads were text-only, unsupported formats, "
                "or image extraction/rendering returned empty output."
            )
        empty = _empty_parse()
        capped_prioritized = _cap_images(prioritized_extracted, MAX_PARSE_EXTRACTED_IMAGES)
        capped_all = _cap_images(extracted_images, MAX_PARSE_EXTRACTED_IMAGES)
        empty["uploaded_images_b64"] = uploaded_images
        empty["extracted_images_b64"] = capped_prioritized
        empty["extracted_image_sources"] = prioritized_sources
        empty["extracted_images_all_b64"] = capped_all
        empty["cad_extracted_images_b64"] = _cap_images(cad_extracted_images, MAX_PARSE_EXTRACTED_IMAGES)
        empty["overall_image_b64"] = (uploaded_images or cad_primary_images or capped_prioritized or [None])[0]
        empty["cad_file_status"] = cad_file_status
        empty["geometry_available"] = any((s.get("geometry_available") for s in cad_file_status))
        return empty

    combined_text = "\n\n".join(all_text)
    print(
        f"[parse-file] Combined text length: {len(combined_text)} "
        f"chunk_mode_candidate={chunk_mode_enabled} chunk_segments={len(large_pdf_chunks)}"
    )

    parsed = None
    chunk_diagnostics = {
        "chunk_mode": False,
        "chunk_count": 0,
        "chunks_succeeded": 0,
        "chunks_failed": 0,
        "warnings": [],
    }

    if chunk_mode_enabled and large_pdf_chunks:
        chunk_diagnostics["chunk_mode"] = True
        chunk_diagnostics["chunk_count"] = len(large_pdf_chunks)
        base_context = "\n\n".join([s for s in segment_texts if s and s.strip()])[:8000]
        parsed_chunks: list[dict] = []
        for idx, chunk in enumerate(large_pdf_chunks, start=1):
            prefix = (
                f"[FILE: {chunk['filename']} | PAGES {chunk['page_start']}-{chunk['page_end']}]\n"
                if chunk.get("filename")
                else f"[PAGES {chunk['page_start']}-{chunk['page_end']}]\n"
            )
            chunk_text = f"{prefix}{chunk.get('text', '')}".strip()
            request_text = (
                f"{base_context}\n\n{chunk_text}" if base_context else chunk_text
            )
            print(
                f"[parse-file][chunk] parse_start idx={idx}/{len(large_pdf_chunks)} "
                f"file={chunk.get('filename') or '-'} pages={chunk.get('page_start')}-{chunk.get('page_end')} "
                f"chars={len(request_text)}"
            )
            try:
                parsed_chunk = await parse_rfp(ParseRequest(text=request_text))
                meaningful = bool(
                    (parsed_chunk.get("parts") or [])
                    or parsed_chunk.get("buyer")
                    or parsed_chunk.get("project")
                    or parsed_chunk.get("project_description")
                )
                if meaningful:
                    parsed_chunks.append(parsed_chunk)
                    chunk_diagnostics["chunks_succeeded"] += 1
                else:
                    chunk_diagnostics["chunks_failed"] += 1
                    chunk_diagnostics["warnings"].append(
                        f"Chunk {idx} returned empty parsed data for pages {chunk.get('page_start')}-{chunk.get('page_end')}"
                    )
                print(
                    f"[parse-file][chunk] parse_ok idx={idx}/{len(large_pdf_chunks)} "
                    f"parts={len(parsed_chunk.get('parts') or [])} "
                    f"buyer={'yes' if parsed_chunk.get('buyer') else 'no'} "
                    f"meaningful={str(meaningful).lower()}"
                )
            except Exception as e:
                print(
                    f"[parse-file][chunk] parse_fail idx={idx}/{len(large_pdf_chunks)} "
                    f"pages={chunk.get('page_start')}-{chunk.get('page_end')} err={e}"
                )
                chunk_diagnostics["chunks_failed"] += 1
                chunk_diagnostics["warnings"].append(
                    f"Chunk {idx} failed for pages {chunk.get('page_start')}-{chunk.get('page_end')}"
                )
                # Retry once with a tighter prompt cap.
                try:
                    raw = chunk_text
                    retry_text = _trim_prompt_text(raw, PDF_CHUNK_RETRY_PROMPT_MAX_CHARS)
                    print(
                        f"[parse-file][chunk] retry_start idx={idx}/{len(large_pdf_chunks)} "
                        f"retry_chars={len(retry_text)}"
                    )
                    parsed_chunk = await parse_rfp(ParseRequest(text=retry_text))
                    meaningful = bool(
                        (parsed_chunk.get("parts") or [])
                        or parsed_chunk.get("buyer")
                        or parsed_chunk.get("project")
                        or parsed_chunk.get("project_description")
                    )
                    if meaningful:
                        parsed_chunks.append(parsed_chunk)
                        chunk_diagnostics["chunks_succeeded"] += 1
                        chunk_diagnostics["chunks_failed"] = max(0, chunk_diagnostics["chunks_failed"] - 1)
                    print(
                        f"[parse-file][chunk] retry_ok idx={idx}/{len(large_pdf_chunks)} "
                        f"parts={len(parsed_chunk.get('parts') or [])} "
                        f"meaningful={str(meaningful).lower()}"
                    )
                except Exception as retry_e:
                    print(
                        f"[parse-file][chunk] retry_fail idx={idx}/{len(large_pdf_chunks)} err={retry_e}"
                    )

        if chunk_diagnostics["chunks_succeeded"] >= PDF_CHUNK_MIN_SUCCESS:
            parsed = _merge_parsed_payloads(parsed_chunks)
            print(
                f"[parse-file][chunk] merge_ok chunks_succeeded={chunk_diagnostics['chunks_succeeded']} "
                f"chunks_failed={chunk_diagnostics['chunks_failed']} parts={len(parsed.get('parts') or [])}"
            )
        else:
            print(
                f"[parse-file][chunk] merge_fallback insufficient_success "
                f"succeeded={chunk_diagnostics['chunks_succeeded']} required={PDF_CHUNK_MIN_SUCCESS} "
                "falling_back_to_single_pass=true"
            )

    if parsed is None:
        parsed = await parse_rfp(ParseRequest(text=combined_text))

    if isinstance(parsed, dict):
        prioritized_extracted = (
            (cad_extracted_images + non_cad_extracted_images)
            if cad_extracted_images
            else extracted_images
        )
        prioritized_sources = (
            (["cad"] * len(cad_extracted_images)) + (["doc"] * len(non_cad_extracted_images))
            if cad_extracted_images
            else extracted_image_sources
        )
        print(
            f"[parse-file] Image routing: CAD={len(cad_extracted_images)} "
            f"nonCAD={len(non_cad_extracted_images)} prioritized={len(prioritized_extracted)}"
        )
        if len(cad_extracted_images) == 0 and len(non_cad_extracted_images) == 0:
            print(
                "[parse-file][warn] No extracted images were routed. "
                "Assessment can still run from text/uploaded images, "
                "but visual matching may be weaker."
            )
        capped_prioritized = _cap_images(prioritized_extracted, MAX_PARSE_EXTRACTED_IMAGES)
        capped_all = _cap_images(extracted_images, MAX_PARSE_EXTRACTED_IMAGES)
        parsed["uploaded_images_b64"] = uploaded_images
        parsed["extracted_images_b64"] = capped_prioritized
        parsed["extracted_image_sources"] = prioritized_sources
        parsed["extracted_images_all_b64"] = capped_all
        parsed["cad_extracted_images_b64"] = _cap_images(cad_extracted_images, MAX_PARSE_EXTRACTED_IMAGES)
        parsed["overall_image_b64"] = (uploaded_images or cad_primary_images or capped_prioritized or [None])[0]
        parsed["cad_file_status"] = cad_file_status
        parsed["geometry_available"] = any((s.get("geometry_available") for s in cad_file_status))
        parsed["chunk_mode"] = bool(chunk_diagnostics.get("chunk_mode"))
        parsed["chunk_count"] = int(chunk_diagnostics.get("chunk_count") or 0)
        parsed["chunks_succeeded"] = int(chunk_diagnostics.get("chunks_succeeded") or 0)
        parsed["chunks_failed"] = int(chunk_diagnostics.get("chunks_failed") or 0)
        parsed["warnings"] = list(chunk_diagnostics.get("warnings") or [])
    return parsed

@router.post("/parse")
async def parse_rfp(payload: ParseRequest):
    """
    Sends raw RFP text to Gemini and extracts structured fields.
    Returns: buyer, location, project, certs_required, delivery,
             priority_note, parts (list of part dicts).
    Falls back to empty structure if Gemini unavailable.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[parse] No GEMINI_API_KEY set — returning empty parse")
        return _empty_parse()

    prompt_text = _trim_prompt_text(payload.text)
    prompt = f"""Extract structured procurement data from this RFP.
Return ONLY valid JSON. No markdown, no comments.

Rules:
- If a value is missing, use empty string "" or [] for arrays.
- Never copy field labels/placeholders as values.
- buyer must be the real requesting company name.
- Ignore email noise: From/To/CC/Subject/Sent, greetings/sign-offs, legal disclaimers.

Output schema (exact keys):
{{
  "contact_name": "",
  "contact_email": "",
  "contact_phone": "",
  "buyer": "",
  "company_name": "",
  "company_location": "",
  "company_size": "",
  "company_industry": "",
  "location": "",
  "geo_preference": "",
  "project": "",
  "project_name": "",
  "project_description": "",
  "other_project_requirements": "",
  "expected_annual_production_volume": "",
  "mandatory_certifications": [],
  "certification_notes": "",
  "customer_account_name": "",
  "customer_industry": "",
  "project_date": "",
  "certs_required": [],
  "delivery": "",
  "priority_note": "",
  "parts": [{{"id":"","description":"","material":"","process":"","tolerance":"","qty":1}}]
}}

RFP TEXT:
{prompt_text}"""
    print(
        f"[parse] prompt_tokens_est={_estimate_tokens(prompt)} "
        f"rfp_text_chars={len(payload.text or '')} prompt_text_chars={len(prompt_text)}"
    )

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            last_exc = None
            for attempt, delay_s in enumerate((0.0, 1.5, 3.0, 6.0), start=1):
                if delay_s > 0:
                    await asyncio.sleep(delay_s)
                try:
                    res = await client.post(
                        GEMINI_URL,
                        headers={"x-goog-api-key": api_key},
                        json={
                            "contents": [{"parts": [{"text": prompt}]}],
                            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2048},
                        },
                    )
                    if res.status_code in (429, 503):
                        raise httpx.HTTPStatusError(
                            f"Gemini transient status {res.status_code}",
                            request=res.request,
                            response=res,
                        )
                    res.raise_for_status()
                    data = res.json()
                    raw  = data["candidates"][0]["content"]["parts"][0]["text"]
                    print(f"[parse] Gemini raw response: {raw[:300]}")
                    clean = re.sub(r"```json|```", "", raw).strip()
                    try:
                        parsed = _sanitize_parse_payload(json.loads(clean))
                        if not parsed.get("buyer"):
                            parsed["buyer"] = _extract_buyer_from_text(payload.text)
                        if not parsed.get("contact_email"):
                            parsed["contact_email"] = _extract_email_from_text(payload.text)
                        return parsed
                    except json.JSONDecodeError:
                        print(f"[parse] JSON truncated, attempting repair")
                        repaired = _repair_truncated_json(clean)
                        if not repaired.get("buyer"):
                            repaired["buyer"] = _extract_buyer_from_text(payload.text)
                        if not repaired.get("contact_email"):
                            repaired["contact_email"] = _extract_email_from_text(payload.text)
                        return repaired
                except Exception as e:
                    last_exc = e
                    transient = False
                    status = None
                    if isinstance(e, httpx.HTTPStatusError):
                        status = e.response.status_code if e.response is not None else None
                        transient = status in (429, 503)
                    if not transient and attempt >= 2:
                        # Non-transient errors usually won't recover with retries.
                        break
                    if transient:
                        print(f"[parse] Gemini retry {attempt}/4 after transient status={status}")
            if last_exc:
                raise last_exc

    except Exception as e:
        print(f"[parse] Gemini failed: {e}")
        fallback = _empty_parse()
        fallback["buyer"] = _extract_buyer_from_text(payload.text)
        fallback["contact_email"] = _extract_email_from_text(payload.text)
        return fallback


def _repair_truncated_json(raw: str) -> dict:
    """
    Gemini sometimes truncates mid-string if output is long.
    Try to salvage the top-level fields that did parse cleanly
    by progressively closing the JSON and retrying.
    """
    # Try closing common truncation points
    attempts = [
        raw + '"]}',       # truncated inside a part string
        raw + '"}]}',      # truncated inside a part object
        raw + '"}]}\n',
        raw + '"}',        # truncated inside a top-level string
        raw + '"}}\n',
    ]
    for attempt in attempts:
        try:
            result = json.loads(attempt)
            print(f"[parse] JSON repaired successfully")
            # Clean up the last part which may be malformed
            if "parts" in result and result["parts"]:
                last = result["parts"][-1]
                # Remove part if it has no id or description (truncated)
                if not last.get("id") or not last.get("description"):
                    result["parts"] = result["parts"][:-1]
            return _sanitize_parse_payload(result)
        except json.JSONDecodeError:
            continue

    # Last resort — extract just the top-level string fields with regex
    print("[parse] JSON repair failed, extracting fields with regex")
    result = _empty_parse()
    for field in [
        "contact_name",
        "contact_email",
        "contact_phone",
        "buyer",
        "company_name",
        "company_location",
        "company_size",
        "company_industry",
        "location",
        "geo_preference",
        "project_name",
        "project",
        "project_description",
        "other_project_requirements",
        "expected_annual_production_volume",
        "certification_notes",
        "customer_account_name",
        "customer_industry",
        "project_date",
        "delivery",
        "priority_note",
    ]:
        m = re.search(rf'"{field}"\s*:\s*"([^"]*)"', raw)
        if m:
            result[field] = m.group(1)
    return _sanitize_parse_payload(result)


def _sanitize_parse_payload(payload: dict) -> dict:
    """
    Remove placeholder/template strings that Gemini may echo from the prompt.
    """
    cleaned = dict(_empty_parse())
    cleaned.update(payload or {})

    placeholder_values = {
        "company name",
        "client company name",
        "client company",
        "buyer",
        "customer",
        "n/a",
        "city, state",
        "project or rfq title",
        "delivery date as string",
        "buyer priority or notes",
        "material spec",
        "manufacturing process",
        "part name/description",
        "part id e.g. p-001",
    }

    def sanitize_text(value):
        if value is None:
            return ""
        text = str(value).strip()
        if not text:
            return ""
        if text.lower() in placeholder_values:
            return ""
        return text

    cleaned["buyer"] = sanitize_text(cleaned.get("buyer"))
    cleaned["contact_name"] = sanitize_text(cleaned.get("contact_name"))
    cleaned["contact_email"] = sanitize_text(cleaned.get("contact_email"))
    cleaned["contact_phone"] = sanitize_text(cleaned.get("contact_phone"))
    cleaned["company_name"] = sanitize_text(cleaned.get("company_name"))
    cleaned["company_location"] = sanitize_text(cleaned.get("company_location"))
    cleaned["company_size"] = sanitize_text(cleaned.get("company_size"))
    cleaned["company_industry"] = sanitize_text(cleaned.get("company_industry"))
    cleaned["location"] = sanitize_text(cleaned.get("location"))
    cleaned["geo_preference"] = sanitize_text(cleaned.get("geo_preference"))
    cleaned["project_name"] = sanitize_text(cleaned.get("project_name"))
    cleaned["project"] = sanitize_text(cleaned.get("project"))
    cleaned["project_description"] = sanitize_text(cleaned.get("project_description"))
    cleaned["other_project_requirements"] = sanitize_text(cleaned.get("other_project_requirements"))
    cleaned["expected_annual_production_volume"] = sanitize_text(cleaned.get("expected_annual_production_volume"))
    cleaned["certification_notes"] = sanitize_text(cleaned.get("certification_notes"))
    cleaned["customer_account_name"] = sanitize_text(cleaned.get("customer_account_name"))
    cleaned["customer_industry"] = sanitize_text(cleaned.get("customer_industry"))
    cleaned["project_date"] = sanitize_text(cleaned.get("project_date"))
    cleaned["delivery"] = sanitize_text(cleaned.get("delivery"))
    cleaned["priority_note"] = sanitize_text(cleaned.get("priority_note"))

    certs = cleaned.get("certs_required")
    if not isinstance(certs, list):
        certs = []
    cleaned["certs_required"] = [sanitize_text(c) for c in certs if sanitize_text(c)]
    mandatory_certs = cleaned.get("mandatory_certifications")
    if not isinstance(mandatory_certs, list):
        mandatory_certs = []
    cleaned["mandatory_certifications"] = [sanitize_text(c) for c in mandatory_certs if sanitize_text(c)]

    parts = cleaned.get("parts")
    if not isinstance(parts, list):
        parts = []
    safe_parts = []
    for idx, part in enumerate(parts):
        if not isinstance(part, dict):
            continue
        safe_parts.append({
            "id": sanitize_text(part.get("id")) or f"P-{idx+1:03d}",
            "description": sanitize_text(part.get("description")),
            "material": sanitize_text(part.get("material")),
            "process": sanitize_text(part.get("process")),
            "tolerance": sanitize_text(part.get("tolerance")),
            "qty": part.get("qty", 1),
        })
    cleaned["parts"] = safe_parts
    # If buyer is still generic/placeholder, leave to caller fallback logic.
    return cleaned


def _empty_parse():
    return {
        "contact_name": "",
        "contact_email": "",
        "contact_phone": "",
        "buyer": "",
        "company_name": "",
        "company_location": "",
        "company_size": "",
        "company_industry": "",
        "location": "",
        "project_name": "",
        "project_description": "",
        "other_project_requirements": "",
        "expected_annual_production_volume": "",
        "mandatory_certifications": [],
        "certification_notes": "",
        "customer_account_name": "",
        "customer_industry": "",
        "project_date": "",
        "project": "",
        "geo_preference": "",
        "certs_required": [], "delivery": "",
        "priority_note": "", "parts": []
    }


@router.post("/submit")
async def submit_rfp(payload: RFPSubmitRequest):
    """
    Accepts the RFP from the UI, assigns an id, returns it immediately.
    No database write — id is just used to tie the assessment response
    back to the correct RFP in the same session.
    """
    rfp_id = f"RFP-{uuid.uuid4().hex[:6].upper()}"
    created_at = datetime.now(timezone.utc).isoformat()

    parts_payload = []
    for part in (payload.parts or []):
        part_row = part.model_dump()
        attachments = list(part_row.get("attachments") or [])
        cad_files = list(part_row.get("cad_files") or [])
        for cad in cad_files:
            if isinstance(cad, dict):
                cad.setdefault("kind", "cad")
                attachments.append(cad)
        part_row["attachments"] = attachments
        parts_payload.append(part_row)

    # In-memory recent queue for dashboard landing feed.
    # This keeps the workflow live without introducing database coupling yet.
    RECENT_RFPS.appendleft({
        "rfp_id": rfp_id,
        "buyer": payload.buyer,
        "project": payload.project,
        "location": payload.location or "",
        "geo_preference": payload.geo_preference or "",
        "geo_constraint_multi": list(payload.geo_constraint_multi or []),
        "supplier_id": payload.supplier_id,
        "supplier_name": payload.supplier_name or "",
        "parts_count": len(payload.parts or []),
        "attachments_count": sum(len(p.get("attachments") or []) for p in parts_payload),
        "created_at": created_at,
        "status": "new",
    })

    return {
        "rfp_id":         rfp_id,
        "id":             rfp_id,
        "supplier_id":    payload.supplier_id,
        "supplier_name":  payload.supplier_name,
        "supplier_certs": payload.supplier_certs,
        "buyer":          payload.buyer,
        "location":       payload.location,
        "project":        payload.project,
        "certs_required": payload.certs_required,
        "cert_requirements_multi": payload.cert_requirements_multi,
        "certification_preferences": payload.certification_preferences,
        "geo_preference": payload.geo_preference,
        "geo_constraint_multi": payload.geo_constraint_multi,
        "delivery":       payload.delivery,
        "priority_note":  payload.priority_note,
        "parts":          parts_payload,
    }


@router.get("/recent")
async def recent_rfps(supplier_id: str | None = None, limit: int = 20):
    """
    Lightweight dashboard feed for recently submitted RFPs.
    Currently in-memory (per running backend process).
    """
    safe_limit = max(1, min(limit, 100))
    rows = list(RECENT_RFPS)
    if supplier_id:
        rows = [row for row in rows if row.get("supplier_id") == supplier_id]
    return {"items": rows[:safe_limit]}

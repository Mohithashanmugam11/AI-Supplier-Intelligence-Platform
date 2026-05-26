# ─────────────────────────────────────────────────────────────
# server_push_patch.py
#
# Drop this /push route into your existing server.py (app.py).
# It replaces whatever /push handler you had before.
#
# This patch fixes the Pinecone upsert by:
#   1. Accepting the 512-dim clip_vector from the frontend payload
#   2. Calling the corrected upsert_part() with clip_vector
#   3. Mapping all field names to match the CSV / index schema
#   4. Saving image to stored_parts/ and storing the path
# ─────────────────────────────────────────────────────────────

import os, base64, uuid
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from pinecone_store import get_index, upsert_part   # your fixed file

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pinecone connection (cached at startup) ─────────────────
_index = None

def get_pinecone_index():
    global _index
    if _index is None:
        _index = get_index()
    return _index


# ── Pydantic schema for each part in the /push payload ──────
class PushPart(BaseModel):
    part_id:          str
    company_name:     Optional[str] = ""
    zoho_id:          Optional[str] = ""
    filename:         Optional[str] = ""

    # Image — sent as base64 from the frontend
    image_b64:        Optional[str] = None
    image_ext:        Optional[str] = ".jpg"

    # 512-dim CLIP vector (computed by /analyze, passed back here)
    clip_vector:      List[float]

    # AI inference fields
    inference_source: Optional[str] = "gemini"
    part_family:      Optional[str] = ""
    part_family_detail: Optional[str] = ""
    part_family_conf: Optional[float] = 0.0
    material:         Optional[str] = ""
    material_reasoning: Optional[str] = ""
    material_conf:    Optional[float] = 0.0
    process:          Optional[str] = ""          # process_primary
    process_secondary: Optional[str] = ""
    process_conf:     Optional[float] = 0.0
    finish:           Optional[str] = ""
    finish_ra:        Optional[str] = "—"
    finish_conf:      Optional[float] = 0.0
    complexity_class: Optional[str] = ""
    tolerance_class:  Optional[str] = ""
    features:         Optional[List[str]] = []
    notes:            Optional[str] = ""

    # Geometric scores (for metadata)
    circularity:      Optional[float] = 0.0
    symmetry:         Optional[float] = 0.0
    hole_count:       Optional[int]   = 0
    complexity:       Optional[float] = 0.0
    aspect_ratio:     Optional[float] = 0.0

    # Project / outcome fields
    project_name:     Optional[str] = ""
    outcome:          Optional[str] = ""
    what_worked:      Optional[str] = ""
    what_didnt:       Optional[str] = ""
    ncr_description:  Optional[str] = ""
    customer_industry: Optional[str] = ""
    project_date:     Optional[str] = ""
    overview:         Optional[str] = ""
    share_with_tb:    Optional[bool] = True
    quoting_lesson:   Optional[str] = ""


class PushPayload(BaseModel):
    parts: List[PushPart]


STORED_PARTS_DIR = "stored_parts"
os.makedirs(STORED_PARTS_DIR, exist_ok=True)


@app.post("/push")
async def push_parts(payload: PushPayload):
    """
    Upsert one or more parts into Pinecone.
    Called by the frontend ProjectsTab after the user clicks 'Save to Corpus'.
    """
    index   = get_pinecone_index()
    results = []

    for part in payload.parts:
        try:
            # ── 1. Save image to disk ──────────────────────────────────────
            image_path = ""
            if part.image_b64:
                ext       = part.image_ext or ".jpg"
                fname     = f"{part.part_id}{ext}"
                disk_path = os.path.join(STORED_PARTS_DIR, fname)
                with open(disk_path, "wb") as f:
                    f.write(base64.b64decode(part.image_b64))
                image_path = disk_path
                print(f"  Saved image → {disk_path}")
            elif part.filename:
                image_path = os.path.join(STORED_PARTS_DIR, part.filename)

            # ── 2. Validate clip_vector length ─────────────────────────────
            if len(part.clip_vector) != 512:
                # Pad or truncate gracefully rather than hard-failing
                cv = (part.clip_vector + [0.0] * 512)[:512]
                print(f"  ⚠ clip_vector had {len(part.clip_vector)} dims — padded to 512")
            else:
                cv = part.clip_vector

            # ── 3. Build inference dict ────────────────────────────────────
            inference = {
                "part_family":        part.part_family,
                "part_family_conf":   part.part_family_conf,
                "part_family_detail": part.part_family_detail,
                "material":           part.material,
                "material_conf":      part.material_conf,
                "material_reasoning": part.material_reasoning,
                "process_primary":    part.process,          # frontend sends as "process"
                "process_secondary":  part.process_secondary,
                "process_conf":       part.process_conf,
                "finish":             part.finish,
                "finish_ra":          part.finish_ra,
                "finish_conf":        part.finish_conf,
                "complexity_class":   part.complexity_class,
                "tolerance_class":    part.tolerance_class,
                "features":           part.features,
                "notes":              part.notes,
                "inference_source":   part.inference_source,
            }

            # ── 4. Build geo_scores dict ───────────────────────────────────
            geo_scores = {
                "circularity":        part.circularity,
                "symmetry_score":     part.symmetry,
                "hole_count":         part.hole_count,
                "feature_complexity": part.complexity,
                "aspect_ratio":       part.aspect_ratio,
            }

            # ── 5. Upsert into Pinecone ────────────────────────────────────
            upsert_part(
                index         = index,
                part_id       = part.part_id,
                clip_vector   = cv,
                inference     = inference,
                geo_scores    = geo_scores,
                image_path    = image_path,
                supplier_name = part.company_name,
                zoho_id       = part.zoho_id,
                source_type   = "HISTORICAL_PROJECT",
                project_name  = part.project_name,
                outcome       = part.outcome,
                what_worked   = part.what_worked,
                what_didnt    = part.what_didnt,
                quoting_lesson= part.quoting_lesson,
                ncr_description=part.ncr_description,
                customer_industry=part.customer_industry,
                project_date  = part.project_date,
                share_with_tb = part.share_with_tb,
                complexity_class=part.complexity_class,
                tolerance_class= part.tolerance_class,
            )

            results.append({"part_id": part.part_id, "ok": True})

        except Exception as e:
            print(f"  ✕ Failed to upsert {part.part_id}: {e}")
            results.append({"part_id": part.part_id, "ok": False, "error": str(e)})

    pushed = sum(1 for r in results if r["ok"])
    return {"ok": pushed > 0, "pushed": pushed, "total": len(results), "results": results}
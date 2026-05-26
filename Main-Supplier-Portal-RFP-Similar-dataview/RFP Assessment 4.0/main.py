"""
TrustBridge — FastAPI Backend
Run with: uvicorn main:app --reload --port 8000
"""

from dotenv import load_dotenv
load_dotenv()

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="TrustBridge API", version="0.2.0")
app.mount("/static", StaticFiles(directory="frontend"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Serve part images from ingestion folder ───────────────────────────────────
_ingestion_path = os.getenv(
    "INGESTION_PATH",
    r"C:\Users\sanik\OneDrive\Desktop\Vulcury LLC\Trustbridge\Trustbridge 2.0\Past projects new version"
)
_images_dir = os.path.join(_ingestion_path, "stored_parts")

if os.path.isdir(_images_dir):
    app.mount("/images", StaticFiles(directory=_images_dir), name="part_images")
    print(f"✓ Serving part images from {_images_dir}")
else:
    print(f"⚠ Images dir not found: {_images_dir}")

# ── Routers ───────────────────────────────────────────────────────────────────
from rfp.router        import router as rfp_router
from assessment.router import router as assessment_router
from auth.zoho_auth    import router as auth_router
from auth.otp import router as otp_router

app.include_router(auth_router,       prefix="/auth",           tags=["Auth"])
app.include_router(rfp_router,        prefix="/api/rfp",        tags=["RFP"])
app.include_router(assessment_router, prefix="/api/assessment", tags=["Assessment"])
app.include_router(otp_router, prefix="/auth", tags=["Auth"])

# ── UI ────────────────────────────────────────────────────────────────────────
@app.get("/")
@app.get("/react")
@app.get("/react/")
def serve_react():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    ui_path = os.path.join(base_dir, "frontend", "index.html")

    if not os.path.isfile(ui_path):
        raise RuntimeError(f"React index file not found: {ui_path}")

    return FileResponse(ui_path)


@app.get("/public.png")
def serve_logo():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    logo_path = os.path.join(base_dir, "public.png")

    if not os.path.isfile(logo_path):
        raise RuntimeError(f"Logo file not found: {logo_path}")

    return FileResponse(logo_path)

# backward compat: keep existing UI route
@app.get("/ui")
def serve_ui():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    ui_path = os.path.join(base_dir, "ui.html")

    if not os.path.isfile(ui_path):
        raise RuntimeError(f"UI file not found: {ui_path}")

    return FileResponse(ui_path)

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    from deps import get_historical_projects_index
    pinecone_ok = False
    try:
        get_historical_projects_index().describe_index_stats()
        pinecone_ok = True
    except Exception:
        pass
    return {
        "status":   "ok",
        "pinecone": pinecone_ok,
        "gemini":   bool(os.environ.get("GEMINI_API_KEY")),
    }

# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    import asyncio
    clip_warmup = os.getenv("CLIP_WARMUP", "true").strip().lower() in {"1", "true", "yes", "on"}
    if not clip_warmup:
        print("[startup] CLIP warmup skipped (CLIP_WARMUP=false)")
        return
    print("[startup] Pre-loading CLIP model...")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _load_clip)
    print("[startup] CLIP model ready")

def _load_clip():
    try:
        from clip_embedder import _load
        _load()
    except Exception as e:
        print(f"[startup] CLIP pre-load failed: {e}")

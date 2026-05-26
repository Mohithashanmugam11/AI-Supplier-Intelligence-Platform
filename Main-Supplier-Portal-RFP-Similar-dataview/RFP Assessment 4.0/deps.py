"""
TrustBridge — Shared dependencies
Pinecone indexes and embedders only. No database.
"""

import os
from functools import lru_cache
import sys
from pinecone import Pinecone



_ingestion_path = os.getenv("INGESTION_PATH","../Past Projects new version")
if _ingestion_path not in sys.path:
    sys.path.insert(0, _ingestion_path)

# ── Pinecone ──────────────────────────────────────────────────────────────────

@lru_cache()
def get_pinecone() -> Pinecone:
    return Pinecone(api_key=os.environ["PINECONE_API_KEY"])


def get_process_profile_index():
    """384-dim SentenceTransformer index — supplier capability profiles."""
    pc = get_pinecone()
    return pc.Index(os.environ.get("PINECONE_PROFILE_INDEX", "process-profiles2"))


def get_historical_projects_index():
    """512-dim CLIP index — supplier past project images."""
    pc = get_pinecone()
    return pc.Index(os.environ.get("PINECONE_HISTORY_INDEX", "supplier-historical-projects"))


# ── Embedders ─────────────────────────────────────────────────────────────────

@lru_cache()
def get_text_embedder():
    """384-dim model — used for B1 capability matching.
    Import is intentionally lazy: sentence_transformers pulls in torch (~300MB),
    so we defer until the first actual B1 scoring call rather than loading at startup.
    """
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer("all-MiniLM-L6-v2")
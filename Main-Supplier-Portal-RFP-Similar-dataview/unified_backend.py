"""
Backward-compatible shim.

Preferred entrypoint:
  uvicorn unified.backend.app:app --reload --port 8000
Legacy entrypoint still works:
  uvicorn unified_backend:app --reload --port 8000
"""

from unified.backend.app import app

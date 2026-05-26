8# Trustbridge Unified Workspace

This is the clean merged workspace, kept outside legacy module folders.

## Structure

- `backend/` unified API entrypoint
- `frontend/` unified React app (final wireframe integration target)
- `docs/` merge docs and endpoint maps

## Legacy Modules (unchanged)

- `../Past projects v2`
- `../RFP Assessment 4.0`

## Run Backend

From repo root:

```bash
uvicorn unified.backend.app:app --reload --port 8000
```

## Run Frontend

```bash
cd unified/frontend
npm install
npm run dev
```

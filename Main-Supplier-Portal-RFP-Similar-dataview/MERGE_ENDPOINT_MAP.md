# Trustbridge Module Merge: Endpoint Map (Step 1)

This file maps the existing endpoints from:
- `Past projects v2` (supplier knowledge base + ingestion)
- `RFP Assessment 4.0` (RFP intake + assessment)

Goal: merge both modules into one runtime without changing UI wireframe behavior.

## Unified Rule

- Keep existing paths stable where possible (no frontend breakage).
- Expose both modules from a single backend app process.
- Do not remove old endpoints in step 1.

## Auth Endpoints

Legacy and RFP modules both expose the same auth paths. Unified backend uses the legacy auth handlers as source of truth:

- `POST /auth/lookup`
- `POST /auth/send-otp`
- `POST /auth/verify-otp`

## RFP Assessment 4.0 Endpoints

Mounted as-is:

- `POST /api/rfp/parse-file`
- `POST /api/rfp/parse`
- `POST /api/rfp/submit`
- `GET /api/rfp/recent`

- `POST /api/assessment/run`
- `GET /api/assessment/recent`
- `POST /api/assessment/no-bid`
- `GET /api/assessment/corpus-health`
- `GET /api/assessment/result`
- `GET /api/assessment/attachment`

## Past Projects v2 Endpoints

Mounted as-is:

- `GET /projects`
- `GET /process-profiles`
- `POST /extract-pdf`
- `POST /analyze-cad`
- `POST /analyze`
- `POST /push`
- `POST /zoho-sync`
- `POST /zoho-sync-lessons`
- `GET /zoho-lessons`
- `GET /zoho-proxy-image`
- `GET /zoho-attachment-image`
- `GET /health`

## Frontend API Usage (Current)

`RFP Assessment 4.0/frontend/src/App.jsx` uses:
- `/auth/*`
- `/api/rfp/*`
- `/api/assessment/*`

`Past projects v2/frontend/src/App.jsx` and `components/ProjectsTab.jsx` use:
- `/auth/*`
- `/projects`
- `/process-profiles`
- `/zoho-lessons`
- `/zoho-sync-lessons`
- `/extract-pdf`
- `/analyze-cad`
- `/analyze`
- `/push`
- `/zoho-sync`

## Next Step (Step 2)

Build a single unified React app shell (wireframe-preserving) that calls this unified endpoint surface.

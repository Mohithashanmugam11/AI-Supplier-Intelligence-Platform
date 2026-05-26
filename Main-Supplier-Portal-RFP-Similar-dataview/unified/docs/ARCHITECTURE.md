# Unified Architecture

## Objective

Create a clean merged workspace outside legacy module folders.

## New Standard Paths

- Backend: `unified/backend/app.py`
- Frontend: `unified/frontend/*`
- Docs: `unified/docs/*`

## Legacy Modules (Read/Reuse Only)

- `Past projects v2`
- `RFP Assessment 4.0`

## Endpoint Strategy

- Keep old routes stable while frontend is migrated.
- Use one backend process (`unified.backend.app`) to expose both route sets.
- Migrate frontend screen-by-screen to the new `unified/frontend` app.

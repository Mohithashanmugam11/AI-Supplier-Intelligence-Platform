-- TrustBridge — Supabase Schema
-- Run this in the Supabase SQL editor to set up all tables.

-- ── Suppliers ──────────────────────────────────────────────────────────────
create table if not exists suppliers (
    id               text primary key,           -- e.g. "SUP-001"
    name             text not null,
    location         text,
    certifications   text[]    default '{}',      -- ["AS9100D", "ISO 9001:2015"]
    process_mix      jsonb     default '{}',      -- {"5-Axis CNC Milling": 18, ...}
    onboarding_state text      default 'pending', -- pending | profile_complete | active
    created_at       timestamptz default now()
);

-- ── RFPs ──────────────────────────────────────────────────────────────────
create table if not exists rfps (
    id              text primary key,           -- e.g. "RFP-4A2F1B"
    supplier_id     text references suppliers(id),
    buyer           text not null,
    location        text,
    project         text not null,
    certs_required  text[]    default '{}',
    delivery        text,
    priority_note   text,
    parts           jsonb     not null,          -- list of RFPPart dicts
    status          text      default 'pending', -- pending | assessed
    created_at      timestamptz default now()
);

-- ── Assessments ───────────────────────────────────────────────────────────
create table if not exists assessments (
    id                   bigserial primary key,
    rfp_id               text references rfps(id),
    supplier_id          text references suppliers(id),
    overall_score        numeric(5,2),
    scoring_mode         text,                   -- A | C (B is blocked before insert)
    parts                jsonb     default '[]', -- list of ScoredPart dicts
    flags                jsonb     default '[]', -- list of Flag dicts
    guidance             jsonb     default '[]', -- list of strings
    matched_jobs_summary jsonb     default '[]', -- top matched jobs
    created_at           timestamptz default now(),

    -- Allow re-running assessment — keep history, latest is highest id
    unique (rfp_id, supplier_id, created_at)
);

-- ── Indexes ───────────────────────────────────────────────────────────────
create index if not exists rfps_supplier_idx        on rfps(supplier_id);
create index if not exists assessments_rfp_idx      on assessments(rfp_id);
create index if not exists assessments_supplier_idx on assessments(supplier_id);
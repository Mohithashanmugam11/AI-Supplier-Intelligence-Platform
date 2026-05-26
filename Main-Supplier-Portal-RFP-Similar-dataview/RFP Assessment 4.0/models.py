"""
TrustBridge — Pydantic models
No database references. Everything lives in memory per request.
"""

from __future__ import annotations
from typing import Optional, Literal, Union
from pydantic import BaseModel, Field


# ── RFP models ────────────────────────────────────────────────────────────────

class RFPPart(BaseModel):
    class Attachment(BaseModel):
        kind: Literal["image", "cad", "file"] = "file"
        name: Optional[str] = None
        mime_type: Optional[str] = None
        file_b64: Optional[str] = None
        url: Optional[str] = None

    id: str
    description: str
    material: str
    process: str
    tolerance: Optional[str] = None
    qty: Union[int, str] = 1
    image_b64: Optional[str] = None
    attachments: list[Attachment] = Field(default_factory=list)
    cad_files: list[Attachment] = Field(default_factory=list)


class RFPSubmitRequest(BaseModel):
    supplier_id: str
    supplier_name: Optional[str] = None
    supplier_email: Optional[str] = None
    supplier_certs: list[str] = Field(default_factory=list)  # passed from UI, no DB needed
    buyer: str
    location: Optional[str] = None
    project: str
    certs_required: list[str] = Field(default_factory=list)
    cert_requirements_multi: list[str] = Field(default_factory=list)
    geo_constraint_multi: list[str] = Field(default_factory=list)
    certification_preferences: Optional[str] = None
    geo_preference: Optional[str] = None
    delivery: Optional[str] = None
    priority_note: Optional[str] = None
    parts: list[RFPPart]
    overall_image_b64: Optional[str] = None
    extracted_images_b64: list[str] = Field(default_factory=list)
    extracted_image_sources: list[str] = Field(default_factory=list)
    # Intake enrichment fields (do not affect scoring logic)
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    company_name: Optional[str] = None
    company_industry: Optional[str] = None
    company_location: Optional[str] = None
    company_size: Optional[str] = None
    project_description: Optional[str] = None
    other_project_requirements: Optional[str] = None
    expected_annual_production_volume: Optional[str] = None
    mandatory_certifications: list[str] = Field(default_factory=list)
    certification_notes: Optional[str] = None
    customer_account_name: Optional[str] = None
    customer_industry: Optional[str] = None
    project_date: Optional[str] = None
    # Existing Zoho assessment row id for upsert-on-rerun behavior.
    assessment_record_id: Optional[str] = None


# ── Supplier state ────────────────────────────────────────────────────────────

SupplierState = Literal["A", "B", "C"]

class SupplierDataState(BaseModel):
    state: SupplierState
    has_profile: bool
    has_history: bool


# ── Scoring models ────────────────────────────────────────────────────────────

class MatchedJob(BaseModel):
    job_id: str
    similarity: float
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    part_name: Optional[str] = None
    project_link: Optional[str] = None
    part_family: Optional[str] = None
    material: Optional[str] = None
    process_primary: Optional[str] = None
    customer_industry: Optional[str] = None
    finish: Optional[str] = None
    features: Optional[str] = None
    outcome: Optional[str] = None
    why_matched: Optional[str] = None
    risk_note: Optional[str] = None
    details: dict[str, str] = Field(default_factory=dict)
    project_date: Optional[str] = None
    image_url: Optional[str] = None
    record_id: Optional[str] = None
    attachment_id: Optional[str] = None
    attachment_module: Optional[str] = None


class ScoredPart(BaseModel):
    part_id: str
    description: str
    b1: Optional[float] = None
    b1_profile_processes: list[str] = Field(default_factory=list)    # ALL processes in supplier's best profile row
    b1_profile_materials: list[str] = Field(default_factory=list)   # ALL materials in supplier's best profile row
    b1_matched_processes: list[str] = Field(default_factory=list)   # profile processes that matched required
    b1_required_processes: list[str] = Field(default_factory=list)  # what the RFP required
    b1_matched_materials: list[str] = Field(default_factory=list)   # profile materials that matched
    b1_tolerance_capable: Optional[bool] = None                     # True if profile can hit required tolerance
    b1_missing_certs: list[str] = Field(default_factory=list)       # required certs not held by supplier
    b2: Optional[float] = None
    b2_base_score: Optional[float] = None
    b2_ai_delta: Optional[float] = None
    b2_infer_source: Optional[str] = None
    b2_inferred_process: Optional[str] = None   # process TrustBridge recommends (from Gemini or rules)
    b2_process_aligned: Optional[bool] = None   # True if stated process matches inferred
    b2_history_matched_processes: list[str] = Field(default_factory=list)
    b2_history_matched_materials: list[str] = Field(default_factory=list)
    c: Optional[float] = None
    c_text: Optional[float] = None
    c_img: Optional[float] = None
    image_quality: Optional[float] = None
    image_weight: Optional[float] = None
    match_confidence: Optional[Literal["low", "medium", "high"]] = None
    match_confidence_score: Optional[float] = None
    strongest_positive_driver: Optional[str] = None
    main_penalty: Optional[str] = None
    confidence_reason: Optional[str] = None
    gate_status: Literal["pass", "conditional_pass", "hard_fail"] = "pass"
    gate_reasons: list[str] = Field(default_factory=list)
    dependency_tags: list[str] = Field(default_factory=list)
    geometry_basis: Optional[Literal["text_only", "single_view_image", "multi_view_image"]] = None
    material: Optional[str] = None
    process: Optional[str] = None
    tolerance: Optional[str] = None
    qty: Optional[Union[int, str]] = None
    composite: float
    scoring_mode: Literal["full", "partial"]
    matched_jobs: list[MatchedJob] = Field(default_factory=list)
    image_candidate_indices: list[int] = Field(default_factory=list)


class Flag(BaseModel):
    type: Literal["pass", "warn", "info"]
    title: str
    body: str
    part_id: Optional[str] = None


class AssessmentResult(BaseModel):
    rfp_id: str
    supplier_id: str
    overall_score: float
    scoring_mode: SupplierState
    parts: list[ScoredPart]
    flags: list[Flag]
    guidance: list[str]
    fit_reason: Optional[str] = None
    requested_fit_reason: Optional[str] = None
    manufacturability_fit_reason: Optional[str] = None
    matched_jobs_summary: list[MatchedJob] = Field(default_factory=list)
    buyer: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    company_name: Optional[str] = None
    company_location: Optional[str] = None
    company_size: Optional[str] = None
    customer_account_name: Optional[str] = None
    customer_industry: Optional[str] = None
    project_date: Optional[str] = None
    expected_annual_production_volume: Optional[str] = None
    mandatory_certifications: Optional[str] = None
    certification_notes: Optional[str] = None
    project_description: Optional[str] = None
    other_project_requirements: Optional[str] = None
    project: Optional[str] = None
    certs_required: list[str] = Field(default_factory=list)
    geo_preference: Optional[str] = None
    delivery: Optional[str] = None
    priority_note: Optional[str] = None

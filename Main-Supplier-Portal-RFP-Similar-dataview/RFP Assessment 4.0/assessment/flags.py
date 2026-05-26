"""
TrustBridge — Flag Generator
Rule-based flags. Supplier certs come from the request payload — no database.
"""

from models import ScoredPart, Flag, RFPSubmitRequest, SupplierDataState
from assessment.geo_match import evaluate_geo_match

B1_GAP_THRESHOLD = 70.0
C_THIN_THRESHOLD = 75.0


async def generate_flags(
    scored_parts: list[ScoredPart],
    rfp: RFPSubmitRequest,
    state: SupplierDataState,
) -> list[Flag]:

    flags: list[Flag] = []

    # ── State C warning — always first ───────────────────────────────────────
    if state.state == "C":
        flags.append(Flag(
            type="warn",
            title="Project history not yet ingested",
            body=(
                "C score is unavailable — no past project images ingested yet. "
                "Assessment is based on your capability profile only. "
                "Upload past projects via the ingestion tool for a full assessment."
            ),
        ))

    # ── Per-part flags ────────────────────────────────────────────────────────
    for part in scored_parts:
        if part.gate_status == "hard_fail":
            body = "; ".join(part.gate_reasons) if part.gate_reasons else "Part failed feasibility gate."
            flags.append(Flag(
                type="warn",
                part_id=part.part_id,
                title=f"Feasibility fail — {part.part_id}",
                body=body,
            ))
            continue

        if part.gate_status == "conditional_pass":
            dep = ", ".join(part.dependency_tags) if part.dependency_tags else "additional dependency"
            reason = "; ".join(part.gate_reasons) if part.gate_reasons else "Conditional feasibility."
            flags.append(Flag(
                type="warn",
                part_id=part.part_id,
                title=f"Conditional feasibility — {part.part_id}",
                body=f"{reason} Dependencies: {dep}.",
            ))

        if part.b1 is not None and part.b1 < B1_GAP_THRESHOLD:
            flags.append(Flag(
                type="warn",
                part_id=part.part_id,
                title=f"Capability gap — {part.part_id}",
                body=(
                    f"{part.description} requires a material/process combination "
                    f"not strongly represented in your capability profile (B1: {part.b1})."
                ),
            ))

        if part.c is not None and part.c < C_THIN_THRESHOLD:
            flags.append(Flag(
                type="warn",
                part_id=part.part_id,
                title=f"Thin project history — {part.part_id}",
                body=(
                    f"Few historical jobs closely match {part.description}. "
                    f"Flag lead time risk before committing to dates."
                ),
            ))

        # Surface past NCRs from matched jobs
        for job in part.matched_jobs:
            if job.outcome and "ncr" in job.outcome.lower():
                flags.append(Flag(
                    type="warn",
                    part_id=part.part_id,
                    title="Past NCR on matched job — disclose proactively",
                    body=(
                        f"Job {job.job_id} had an NCR (outcome: {job.outcome}). "
                        f"Proactive disclosure builds trust — explain the resolution."
                    ),
                ))

    # ── Cert check — supplier_certs from request payload ─────────────────────
    supplier_certs = rfp.supplier_certs or []
    required_certs = rfp.certs_required or []

    if required_certs:
        missing = [c for c in required_certs if c not in supplier_certs]
        if not missing:
            flags.append(Flag(
                type="pass",
                title="All certifications matched",
                body=f"You hold {', '.join(required_certs)} — all certifications required by this RFP.",
            ))
        else:
            flags.append(Flag(
                type="warn",
                title=f"Missing certifications: {', '.join(missing)}",
                body=(
                    f"This RFP requires {', '.join(required_certs)}. "
                    f"You are missing: {', '.join(missing)}."
                ),
            ))

    # ── Strong match pass flag ────────────────────────────────────────────────
    strong = [p for p in scored_parts if p.composite >= 88]
    if strong:
        ids = ", ".join(p.part_id for p in strong)
        flags.append(Flag(
            type="pass",
            title=f"Strong precedent — {ids}",
            body=(
                f"{len(strong)} part(s) score above 88 — "
                f"strong historical precedent to anchor your quote."
            ),
        ))

    # ── Geo Preference Check ──────────────────────────────────────────────────
    flags.append(Flag(
        type="info",
        title="DEBUG: Geo Values Received",
        body=f"Company Location: '{rfp.company_location}' | Geo Preference: '{rfp.geo_preference}'"
    ))
    
    if rfp.company_location and rfp.geo_preference:
        geo_res = await evaluate_geo_match(rfp.company_location, rfp.geo_preference)
        if geo_res == "match":
            flags.append(Flag(
                type="pass",
                title="Geo preference matched",
                body=f"Your location ({rfp.company_location}) aligns with the buyer's preference ({rfp.geo_preference}).",
            ))
        elif geo_res == "partial":
            flags.append(Flag(
                type="info",
                title="Partial geo match",
                body=f"Your location ({rfp.company_location}) partially meets the buyer's preference ({rfp.geo_preference}).",
            ))
        elif geo_res == "no_match":
            flags.append(Flag(
                type="info",
                title="Location difference",
                body=f"Your location ({rfp.company_location}) differs from the buyer's preference ({rfp.geo_preference}).",
            ))

    return flags

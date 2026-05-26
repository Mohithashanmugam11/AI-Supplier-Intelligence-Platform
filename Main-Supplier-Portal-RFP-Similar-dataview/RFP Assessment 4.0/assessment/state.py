"""
TrustBridge supplier data state checks.

State A: profile exists
State C: no profile, but assessment still runs so Pinecone history can be tried directly
"""

import asyncio
import os
import re

from deps import get_historical_projects_index, get_process_profile_index, get_text_embedder
from models import SupplierDataState


async def get_supplier_data_state(
    supplier_id: str, supplier_name: str | None = None
) -> SupplierDataState:
    """
    Only check whether the supplier capability profile exists.
    Historical project availability is determined by the real Pinecone search path
    during scoring instead of a fragile dummy-vector pre-check.
    """
    profile_index = get_process_profile_index()
    query_timeout_sec = max(0.5, float(os.getenv("STATE_PROFILE_QUERY_TIMEOUT_SEC", "3.0")))
    try:
        profile_probe_vector = get_text_embedder().encode("supplier process profile metadata").tolist()
    except Exception:
        profile_probe_vector = [0.0] * 384

    profile_filters = [
        {"account_lookup_id": {"$eq": supplier_id}},
        {"account_id": {"$eq": supplier_id}},
        {"supplier_id": {"$eq": supplier_id}},
        {"zoho_id": {"$eq": supplier_id}},
    ]
    history_filters = [
        {"zoho_id": {"$eq": supplier_id}},
        {"account_lookup_id": {"$eq": supplier_id}},
        {"account_id": {"$eq": supplier_id}},
        {"supplier_id": {"$eq": supplier_id}},
    ]
    if supplier_name and str(supplier_name).strip():
        history_filters.append({"supplier_name": {"$eq": str(supplier_name).strip()}})
        history_filters.append({"supplier_name": {"$eq": str(supplier_name).strip().lower()}})
        history_filters.append({"supplier_n": {"$eq": str(supplier_name).strip()}})
        history_filters.append({"supplier_n": {"$eq": str(supplier_name).strip().lower()}})

    has_profile = False
    for profile_filter in profile_filters:
        try:
            profile_result = await asyncio.wait_for(
                asyncio.to_thread(
                    profile_index.query,
                    vector=profile_probe_vector,
                    filter=profile_filter,
                    top_k=1,
                    include_metadata=False,
                ),
                timeout=query_timeout_sec,
            )
            print(
                f"  Supplier profile state query supplier_id={supplier_id} "
                f"filter={profile_filter} matches={len(profile_result.matches)}"
            )
            if len(profile_result.matches) > 0:
                has_profile = True
                break
        except Exception as e:
            msg = str(e)
            m = re.search(r"dimension of the index\s+(\d+)", msg, re.IGNORECASE)
            if m:
                expected_dim = int(m.group(1))
                try:
                    profile_result = await asyncio.wait_for(
                        asyncio.to_thread(
                            profile_index.query,
                            vector=[0.0] * expected_dim,
                            filter=profile_filter,
                            top_k=1,
                            include_metadata=False,
                        ),
                        timeout=query_timeout_sec,
                    )
                    print(
                        f"  Supplier profile state dimension-retry supplier_id={supplier_id} "
                        f"filter={profile_filter} expected_dim={expected_dim} "
                        f"matches={len(profile_result.matches)}"
                    )
                    if len(profile_result.matches) > 0:
                        has_profile = True
                        break
                    continue
                except Exception as e2:
                    print(
                        f"  Supplier profile state dimension-retry failed for {supplier_id} "
                        f"filter={profile_filter}: {e2}"
                    )
                    continue
            print(f"  Supplier profile state query failed for {supplier_id} filter={profile_filter}: {e}")

    state = "A" if has_profile else "C"
    has_history = False
    history_index = get_historical_projects_index()
    try:
        history_probe_vector = get_text_embedder().encode("supplier history metadata").tolist()
    except Exception:
        history_probe_vector = [0.0] * 512
    for history_filter in history_filters:
        try:
            history_result = await asyncio.wait_for(
                asyncio.to_thread(
                    history_index.query,
                    vector=history_probe_vector,
                    filter=history_filter,
                    top_k=1,
                    include_metadata=False,
                ),
                timeout=query_timeout_sec,
            )
            if len(history_result.matches) > 0:
                has_history = True
                break
        except Exception as e:
            msg = str(e)
            m = re.search(r"dimension of the index\s+(\d+)", msg, re.IGNORECASE)
            if m:
                expected_dim = int(m.group(1))
                try:
                    history_result = await asyncio.wait_for(
                        asyncio.to_thread(
                            history_index.query,
                            vector=[0.0] * expected_dim,
                            filter=history_filter,
                            top_k=1,
                            include_metadata=False,
                        ),
                        timeout=query_timeout_sec,
                    )
                    if len(history_result.matches) > 0:
                        has_history = True
                        break
                    continue
                except Exception:
                    continue
            continue

    print(
        f"  Supplier state for {supplier_id}: state={state}, "
        f"has_profile={has_profile}, has_history={has_history}, supplier_name={supplier_name or ''}"
    )

    return SupplierDataState(
        state=state,
        has_profile=has_profile,
        has_history=has_history,
    )

# ─────────────────────────────────────────────────────────────
# pinecone_store.py
# Upserts part geometric vectors + metadata into Pinecone.
# Assumes you already have a Pinecone index called:
#   "part-geometric-index"   (dimension=15, metric=euclidean)
# ─────────────────────────────────────────────────────────────

from pinecone import Pinecone, ServerlessSpec
from geometry import build_geometric_vector


# ── Config — fill these in ──
PINECONE_API_KEY  = "pcsk_7PMjfe_NgdYoehHbU9QJ2Fkfh6nRrafFyiY6BgAu3sRygHK9L2d6Zvp9Sco1RScPWKgRUr"
INDEX_NAME        = "supplier-historical-projects"
VECTOR_DIMENSION  = 15


def get_index():
    """Connect to Pinecone and return the index."""
    pc = Pinecone(api_key=PINECONE_API_KEY)

    # Create index if it doesn't exist yet
    existing = [i.name for i in pc.list_indexes()]
    if INDEX_NAME not in existing:
        print(f"Creating index '{INDEX_NAME}'...")
        pc.create_index(
            name=INDEX_NAME,
            dimension=VECTOR_DIMENSION,
            metric="euclidean",          # NOT cosine — these are real numbers
            spec=ServerlessSpec(cloud="aws", region="us-east-1")
        )
        print("Index created.")

    return pc.Index(INDEX_NAME)


def upsert_part(
    index,
    part_id: str,
    scores: dict,
    inference: dict,
    image_path: str,
    supplier_id: str,
    supplier_name: str,
    project_name: str = "",
    source_type: str = "HISTORICAL_PROJECT",   # or "RFP"
):
    """
    Builds the vector and upserts one part into Pinecone.

    part_id      : unique ID e.g. "part_101"
    scores       : output from compute_geometric_scores()
    inference    : output from run_inference()
    project_name : human-readable project/job name
    source_type  : "HISTORICAL_PROJECT" for supplier history
                   "RFP" for inbound requests
    """

    vector = build_geometric_vector(scores)

    metadata = {
        # Who made it
        "supplier_id":     supplier_id,
        "supplier_name":   supplier_name,
        "source_type":     source_type,
        "image_path":      image_path,
        "project_name":    project_name or image_path,

        # What it is
        "part_family":     inference["part_family"]["value"],
        "part_family_conf":inference["part_family"]["confidence"],
        "material":        inference["material"]["value"],
        "material_conf":   inference["material"]["confidence"],
        "process_primary": inference["process"]["primary"],
        "process_secondary": inference["process"]["secondary"],
        "process_conf":    inference["process"]["confidence"],
        "finish":          inference["finish"]["value"],
        "finish_ra":       inference["finish"]["ra_estimate"],
        "finish_conf":     inference["finish"]["confidence"],

        # Key geometric scores (for filtering)
        "circularity":     scores["circularity"],
        "symmetry":        scores["symmetry_score"],
        "hole_count":      scores["hole_count"],
        "complexity":      scores["feature_complexity"],
        "reflectivity":    scores["reflectivity"],
        "aspect_ratio":    scores["aspect_ratio"],

        # Features list as string (Pinecone metadata must be primitive)
        "features":        " | ".join(inference["features"]),
    }

    index.upsert(vectors=[{
        "id":       part_id,
        "values":   vector,
        "metadata": metadata,
    }])

    print(f"  ✓ Upserted: {part_id} — {inference['part_family']['value']} — {inference['material']['value']}")


def query_similar_parts(
    index,
    rfq_scores: dict,
    supplier_id: str = None,
    top_k: int = 10,
) -> list:
    """
    Query Pinecone for parts similar to an RFQ.

    If supplier_id is given → search only that supplier's history
    If None → search all suppliers (for platform-wide matching)
    """
    query_vector = build_geometric_vector(rfq_scores)

    # Optional filter: scope to one supplier's history
    filter_dict = {"source_type": "HISTORICAL_PROJECT"}
    if supplier_id:
        filter_dict["supplier_id"] = supplier_id

    results = index.query(
        vector=query_vector,
        top_k=top_k,
        include_metadata=True,
        filter=filter_dict,
    )

    return results["matches"]


def print_matches(matches: list, rfq_image: str = ""):
    print(f"\n  MATCHES FOR: {rfq_image}")
    print(f"  {'─'*55}")
    for i, m in enumerate(matches, 1):
        meta = m["metadata"]
        # Pinecone euclidean score: lower = more similar
        # Convert to similarity % for display
        sim_pct = max(0, round((1 - min(1, m["score"] / 5)) * 100, 1))
        print(f"  [{i}] {meta.get('part_family','?'):<26} "
              f"Similarity: {sim_pct}%")
        print(f"      Supplier : {meta.get('supplier_name','?')}")
        print(f"      Material : {meta.get('material','?')}")
        print(f"      Process  : {meta.get('process_primary','?')}")
        print(f"      Finish   : {meta.get('finish','?')}")
        print(f"      Features : {meta.get('features','?')}")
        print()

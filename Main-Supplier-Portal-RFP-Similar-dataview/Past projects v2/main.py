# ─────────────────────────────────────────────────────────────
# main.py
# The single script that runs the full pipeline.
# 
# TWO MODES:
#   python main.py analyze  path/to/image.jpg
#       → Analyzes one image, prints all scores, no Pinecone
#
#   python main.py upload   path/to/image.jpg  SUP01  "Precision CNC"  part_101
#       → Analyzes + upserts into Pinecone
#
#   python main.py match    path/to/rfq.jpg
#       → Finds similar parts from all supplier history
#
#   python main.py match    path/to/rfq.jpg   SUP01
#       → Finds similar parts from ONE supplier's history only
#
#   python main.py batch    path/to/folder/   SUP01  "Precision CNC"
#       → Processes every image in a folder and upserts all
# ─────────────────────────────────────────────────────────────

import sys
import os
import uuid
from geometry   import compute_geometric_scores, build_geometric_vector, print_scores
from inference  import run_inference, print_inference
from pinecone_store import get_index, upsert_part, query_similar_parts, print_matches


# ══════════════════════════════════════════════════════════════
# MODE 1: ANALYZE — just print everything, no Pinecone needed
# ══════════════════════════════════════════════════════════════

def analyze(image_path: str):
    print(f"\nAnalyzing: {image_path}")

    # Step 1 — compute geometric scores
    scores = compute_geometric_scores(image_path)
    print_scores(scores, image_path)

    # Step 2 — run inference
    inference = run_inference(image_path, scores)
    print_inference(inference)

    # Step 3 — show the vector
    vec = build_geometric_vector(scores)
    print(f"\n  PINECONE VECTOR ({len(vec)} dims):")
    print(f"  {vec}\n")


# ══════════════════════════════════════════════════════════════
# MODE 2: UPLOAD — analyze + upsert to Pinecone
# ══════════════════════════════════════════════════════════════

def upload(image_path: str, supplier_id: str, supplier_name: str, part_id: str = None, project_name: str = ""):
    if not part_id:
        part_id = f"part_{str(uuid.uuid4())[:8]}"
    if not project_name:
        project_name = os.path.splitext(os.path.basename(image_path))[0]

    print(f"\nUploading: {image_path}")
    print(f"  Supplier : {supplier_name} ({supplier_id})")
    print(f"  Part ID  : {part_id}")
    print(f"  Project  : {project_name}")

    scores    = compute_geometric_scores(image_path)
    inference = run_inference(image_path, scores)

    print_scores(scores, image_path)
    print_inference(inference)

    index = get_index()
    upsert_part(
        index       = index,
        part_id     = part_id,
        scores      = scores,
        inference   = inference,
        image_path  = image_path,
        supplier_id = supplier_id,
        supplier_name = supplier_name,
        project_name = project_name,
        source_type = "HISTORICAL_PROJECT",
    )
    print(f"\n  Done. Part stored in Pinecone as '{part_id}'")


# ══════════════════════════════════════════════════════════════
# MODE 3: MATCH — find similar parts for an RFQ image
# ══════════════════════════════════════════════════════════════

def match(rfq_image_path: str, supplier_id: str = None):
    print(f"\nMatching RFQ: {rfq_image_path}")
    if supplier_id:
        print(f"  Scoped to supplier: {supplier_id}")
    else:
        print(f"  Searching all suppliers")

    scores = compute_geometric_scores(rfq_image_path)
    print_scores(scores, rfq_image_path)

    inference = run_inference(rfq_image_path, scores)
    print_inference(inference)

    index   = get_index()
    matches = query_similar_parts(
        index       = index,
        rfq_scores  = scores,
        supplier_id = supplier_id,
        top_k       = 10,
    )
    print_matches(matches, rfq_image_path)


# ══════════════════════════════════════════════════════════════
# MODE 4: BATCH — process a whole folder of images
# ══════════════════════════════════════════════════════════════

def batch(folder_path: str, supplier_id: str, supplier_name: str):
    supported = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    images = [
        f for f in os.listdir(folder_path)
        if os.path.splitext(f)[1].lower() in supported
    ]

    if not images:
        print(f"No images found in {folder_path}")
        return

    print(f"\nBatch processing {len(images)} images")
    print(f"Supplier: {supplier_name} ({supplier_id})\n")

    index = get_index()
    success, failed = 0, []

    for i, filename in enumerate(images, 1):
        image_path = os.path.join(folder_path, filename)
        part_id    = f"part_{supplier_id}_{os.path.splitext(filename)[0]}"
        print(f"[{i}/{len(images)}] {filename}")

        try:
            scores    = compute_geometric_scores(image_path)
            inference = run_inference(image_path, scores)
            upsert_part(
                index         = index,
                part_id       = part_id,
                scores        = scores,
                inference     = inference,
                image_path    = image_path,
                supplier_id   = supplier_id,
                supplier_name = supplier_name,
                project_name  = os.path.splitext(filename)[0],
                source_type   = "HISTORICAL_PROJECT",
            )
            success += 1
        except Exception as e:
            print(f"  ✗ FAILED: {e}")
            failed.append(filename)

    print(f"\n  Done. {success}/{len(images)} uploaded successfully.")
    if failed:
        print(f"  Failed: {failed}")


# ══════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    args = sys.argv[1:]

    if not args:
        print("""
TrustBridge Part Analyzer
─────────────────────────
Usage:

  Analyze one image (no Pinecone needed):
    python main.py analyze  image.jpg

  Upload one part to Pinecone:
    python main.py upload   image.jpg  SUP01  "Precision CNC"  part_101  "Project Name"

  Match an RFQ against all supplier history:
    python main.py match    rfq.jpg

  Match an RFQ against ONE supplier's history:
    python main.py match    rfq.jpg  SUP01

  Process a whole folder of images:
    python main.py batch    ./parts/  SUP01  "Precision CNC"
        """)
        sys.exit(0)

    mode = args[0].lower()

    if mode == "analyze":
        analyze(args[1])

    elif mode == "upload":
        supplier_id   = args[2] if len(args) > 2 else "SUP_UNKNOWN"
        supplier_name = args[3] if len(args) > 3 else "Unknown Supplier"
        part_id       = args[4] if len(args) > 4 else None
        project_name  = args[5] if len(args) > 5 else ""
        upload(args[1], supplier_id, supplier_name, part_id, project_name)

    elif mode == "match":
        supplier_id = args[2] if len(args) > 2 else None
        match(args[1], supplier_id)

    elif mode == "batch":
        supplier_id   = args[2] if len(args) > 2 else "SUP_UNKNOWN"
        supplier_name = args[3] if len(args) > 3 else "Unknown Supplier"
        batch(args[1], supplier_id, supplier_name)

    else:
        print(f"Unknown mode: {mode}. Run without args to see usage.")

from pinecone import Pinecone
import csv
import os
from dotenv import load_dotenv

load_dotenv()

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
NAMESPACE        = ""
BATCH_SIZE       = 100

pc    = Pinecone(api_key="pcsk_7PMjfe_NgdYoehHbU9QJ2Fkfh6nRrafFyiY6BgAu3sRygHK9L2d6Zvp9Sco1RScPWKgRUr")
index = pc.Index("supplier-historical-projects")

# ── Step 1: Get all IDs ───────────────────────────────────────
all_ids = []
for ids in index.list(namespace=NAMESPACE):
    all_ids.extend(ids)
print(f"Total IDs found: {len(all_ids)}")

# ── Step 2: Fetch in batches WITH vector values ───────────────
all_rows = []
for i in range(0, len(all_ids), BATCH_SIZE):
    batch_ids = all_ids[i:i + BATCH_SIZE]

    # include_values=True — this is what gets the 512-dim vector
    response = index.fetch(ids=batch_ids, namespace=NAMESPACE)

    for vector_id, vector_data in response.vectors.items():
        row = {"id": vector_id}

        # Metadata fields
        if vector_data.metadata:
            row.update(vector_data.metadata)

        # CLIP vector — stored as clip_0, clip_1, ... clip_511
        if vector_data.values:
            for j, val in enumerate(vector_data.values):
                row[f"clip_{j}"] = round(val, 6)

        all_rows.append(row)

    print(f"  Fetched {min(i + BATCH_SIZE, len(all_ids))} / {len(all_ids)}")

# ── Step 3: Write to CSV ──────────────────────────────────────
if all_rows:
    # Put metadata columns first, then clip_0 ... clip_511
    meta_cols  = [k for k in all_rows[0].keys() if not k.startswith("clip_")]
    clip_cols  = [f"clip_{j}" for j in range(512)]
    fieldnames = meta_cols + clip_cols

    with open("historical_with_vectors.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"\n✓ Export complete: historical_with_vectors.csv")
    print(f"  Rows    : {len(all_rows)}")
    print(f"  Columns : {len(fieldnames)} ({len(meta_cols)} metadata + 512 CLIP vector)")
else:
    print("No data found.")
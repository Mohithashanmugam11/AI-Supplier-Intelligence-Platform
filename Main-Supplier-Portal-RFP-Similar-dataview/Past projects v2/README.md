# TrustBridge Part Analyzer
## Setup & Usage Guide

---

## What this does
Takes any part image → computes geometric scores → infers material/process/finish
→ builds a 15-dimension vector → upserts into your Pinecone index.

Zero AI for geometry. Zero guessing. Pure computation.

---

## Step 1 — Install dependencies

```bash
pip install opencv-python numpy pinecone-client Pillow
```

---

## Step 2 — Add your Pinecone API key

Open `pinecone_store.py` and replace line 13:
```python
PINECONE_API_KEY = "YOUR_PINECONE_API_KEY"
```
with your actual key from https://app.pinecone.io

---

## Step 3 — Run it

### Just analyze an image (no Pinecone needed, test this first)
```bash
python main.py analyze  your_part_image.jpg
```
You'll see all geometric scores, inferred properties, and the vector printed.

---

### Upload a supplier's past part to Pinecone
```bash
python main.py upload   part_photo.jpg   SUP01   "Precision CNC"   part_101
```
Arguments:
- `part_photo.jpg`  → path to the image
- `SUP01`           → your supplier ID
- `"Precision CNC"` → supplier name
- `part_101`        → part ID (optional, auto-generates if omitted)

---

### Upload a whole folder of parts at once (Sanika's job)
```bash
python main.py batch   ./supplier_images/   SUP01   "Precision CNC"
```
Processes every image in the folder and upserts all to Pinecone.

---

### Match an RFQ against all supplier history
```bash
python main.py match   rfq_drawing.jpg
```
Returns top 10 most similar parts from all suppliers.

---

### Match an RFQ against ONE supplier's history only
```bash
python main.py match   rfq_drawing.jpg   SUP01
```
Returns "you've made something like this before" for that specific supplier.

---

## File structure
```
trustbridge_part_analyzer/
├── main.py           ← run this
├── geometry.py       ← all geometric computation (OpenCV)
├── inference.py      ← rule-based material/process/finish
├── pinecone_store.py ← Pinecone upsert + query
└── requirements.txt  ← pip install -r requirements.txt
```

---

## What the 15-dim vector contains
```
dim 0  aspect_ratio         — shape proportion
dim 1  circularity          — how circular (1.0 = perfect circle)
dim 2  convexity            — concave features present if < 0.8
dim 3  edge_density         — feature complexity from edges
dim 4  symmetry_score       — rotational symmetry
dim 5  reflectivity         — surface finish quality
dim 6  feature_complexity   — combined complexity index
dim 7  compactness          — fill ratio of bounding box
dim 8  slenderness          — rod/shaft vs chunky
dim 9  hole_count_norm      — normalized hole count
dim 10-14  hu_moments       — shape fingerprint (scale/rotation invariant)
```

---

## Important notes
- Background should be plain (white/grey/black) for best contour detection
- Part should take up at least 30% of the image frame
- Multiple parts in one image = analyzer takes the largest contour
- Confidence scores on material/finish are estimates — supplier should confirm

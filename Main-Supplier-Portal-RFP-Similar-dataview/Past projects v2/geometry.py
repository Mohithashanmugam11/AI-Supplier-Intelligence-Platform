# ─────────────────────────────────────────────────────────────
# geometry.py
# Computes all geometric scores from a part image.
# Pure OpenCV + NumPy. Zero AI. Fully deterministic.
# ─────────────────────────────────────────────────────────────

import cv2
import numpy as np


# ══════════════════════════════════════════════════════════════
# MAIN FUNCTION — call this with any image path
# ══════════════════════════════════════════════════════════════

def compute_geometric_scores(image_path: str) -> dict:
    """
    Takes an image path, returns all geometric scores + raw measurements.
    This is the core function everything else calls.
    """

    # ── Load image ──
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not load image: {image_path}")

    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # ── Step 1: Threshold — isolate the part from background ──
    # Otsu automatically finds the best threshold value
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, binary = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Clean up noise
    kernel = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN,  kernel, iterations=1)

    # ── Step 2: Find the main contour (largest region) ──
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        raise ValueError("No part contour found in image — check background contrast")

    # Take the largest contour = the main part
    main_contour = max(contours, key=cv2.contourArea)

    # ── Step 3: Compute all scores ──
    scores = {}

    # --- ASPECT RATIO ---
    # Bounding rectangle width / height
    x, y, bw, bh = cv2.boundingRect(main_contour)
    scores["aspect_ratio"] = round(float(bw) / bh, 4) if bh > 0 else 1.0
    # > 2.0 = long rod/shaft | ~1.0 = square/ring | < 0.5 = flat disc

    # --- CIRCULARITY ---
    # How close is the shape to a perfect circle
    # Formula: 4π × Area / Perimeter²
    # Perfect circle = 1.0 | Complex irregular = close to 0
    area      = cv2.contourArea(main_contour)
    perimeter = cv2.arcLength(main_contour, True)
    circularity = (4 * np.pi * area) / (perimeter ** 2) if perimeter > 0 else 0
    scores["circularity"] = round(min(1.0, circularity), 4)

    # --- CONVEXITY ---
    # Ratio of actual area to convex hull area
    # = 1.0 means fully convex (no pockets/slots/undercuts)
    # < 0.8 means significant concave features
    hull        = cv2.convexHull(main_contour)
    hull_area   = cv2.contourArea(hull)
    convexity   = area / hull_area if hull_area > 0 else 1.0
    scores["convexity"] = round(min(1.0, convexity), 4)

    # --- EDGE DENSITY ---
    # How many edge pixels relative to total image pixels
    # High = complex geometry with many features
    # Low  = simple smooth shape
    edges = cv2.Canny(gray, 50, 150)
    edge_count   = int(np.sum(edges > 0))
    edge_density = edge_count / (W * H)
    scores["edge_density"] = round(edge_density, 6)

    # --- SYMMETRY SCORE ---
    # Mirror the binary mask left/right along the centroid
    # Compare how many pixels match → score 0 to 1
    M_raw     = cv2.moments(main_contour)
    cx        = int(M_raw["m10"] / M_raw["m00"]) if M_raw["m00"] else W // 2
    mask      = np.zeros((H, W), dtype=np.uint8)
    cv2.drawContours(mask, [main_contour], -1, 255, -1)
    flipped   = cv2.flip(mask, 1)
    # shift flipped to align centroid
    shift     = 2 * cx - W
    M_shift   = np.float32([[1, 0, shift], [0, 1, 0]])
    flipped   = cv2.warpAffine(flipped, M_shift, (W, H))
    overlap   = cv2.bitwise_and(mask, flipped)
    sym_score = np.sum(overlap > 0) / np.sum(mask > 0) if np.sum(mask > 0) > 0 else 0
    scores["symmetry_score"] = round(min(1.0, float(sym_score)), 4)

    # --- HOLE COUNT ---
    # Count interior contours (holes) inside the main part
    contours_all, hierarchy = cv2.findContours(
        binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE
    )
    hole_count = 0
    if hierarchy is not None:
        for i, h in enumerate(hierarchy[0]):
            # h[3] = parent index — if it has a parent, it's a hole
            if h[3] >= 0:
                hole_area = cv2.contourArea(contours_all[i])
                if hole_area > 50:  # ignore tiny noise holes
                    hole_count += 1
    scores["hole_count"] = hole_count

    # --- REFLECTIVITY ---
    # What fraction of part pixels are very bright (>200 intensity)
    # Mirror polish = high | Matte/anodized = low
    part_pixels    = gray[mask > 0]
    highlight_pct  = float(np.sum(part_pixels > 200)) / len(part_pixels) if len(part_pixels) > 0 else 0
    scores["reflectivity"] = round(highlight_pct, 4)

    # --- SURFACE UNIFORMITY ---
    # Low std deviation = uniform surface (anodized, coated)
    # High std deviation = reflective / textured surface
    scores["surface_std_dev"]   = round(float(np.std(part_pixels)), 2)
    scores["mean_brightness"]   = round(float(np.mean(part_pixels)), 2)

    # --- FEATURE COMPLEXITY ---
    # Combined score: edge density + convexity penalty + holes
    complexity = (
        min(1.0, edge_density * 12) * 0.5 +
        (1 - convexity) * 0.3 +
        min(1.0, hole_count / 5) * 0.2
    )
    scores["feature_complexity"] = round(min(1.0, complexity), 4)

    # --- COMPACTNESS ---
    # How much of the bounding box does the part fill
    bb_area     = bw * bh
    compactness = area / bb_area if bb_area > 0 else 0
    scores["compactness"] = round(float(compactness), 4)

    # --- SLENDERNESS ---
    # Long thin parts score high (rods, shafts)
    # Chunky parts score low
    ar = scores["aspect_ratio"]
    slenderness = (ar - 1) / ar if ar >= 1 else (1 - ar)
    scores["slenderness"] = round(min(1.0, float(slenderness)), 4)

    # --- HU MOMENTS (shape fingerprint) ---
    # 7 numbers that uniquely describe the shape
    # Invariant to scale, rotation, and translation
    # Two identical shapes = same Hu moments regardless of size/angle
    hu = cv2.HuMoments(cv2.moments(main_contour)).flatten()
    hu_log = [-np.sign(v) * np.log10(abs(v) + 1e-10) for v in hu]
    scores["hu_moments"] = [round(float(v), 6) for v in hu_log]

    # ── Step 4: Raw measurements ──
    scores["raw"] = {
        "image_width_px":    W,
        "image_height_px":   H,
        "part_area_px":      int(area),
        "part_area_pct":     round(area / (W * H) * 100, 2),
        "perimeter_px":      round(float(perimeter), 2),
        "bounding_w_px":     bw,
        "bounding_h_px":     bh,
        "edge_pixel_count":  edge_count,
        "contour_count":     len(contours),
    }

    return scores


# ══════════════════════════════════════════════════════════════
# VECTOR BUILDER — produces the Pinecone-ready vector
# ══════════════════════════════════════════════════════════════

def build_geometric_vector(scores: dict) -> list:
    """
    Flattens scores into a fixed-length numeric vector for Pinecone.
    Always 15 dimensions. Same order every time.
    """
    vec = [
        scores["aspect_ratio"],           # dim 0
        scores["circularity"],            # dim 1
        scores["convexity"],              # dim 2
        scores["edge_density"],           # dim 3
        scores["symmetry_score"],         # dim 4
        scores["reflectivity"],           # dim 5
        scores["feature_complexity"],     # dim 6
        scores["compactness"],            # dim 7
        scores["slenderness"],            # dim 8
        min(1.0, scores["hole_count"] / 10.0),  # dim 9  (normalized)
        scores["hu_moments"][0],          # dim 10 shape fingerprint
        scores["hu_moments"][1],          # dim 11
        scores["hu_moments"][2],          # dim 12
        scores["hu_moments"][3],          # dim 13
        scores["hu_moments"][4],          # dim 14
    ]
    return [round(float(v), 6) for v in vec]


# ══════════════════════════════════════════════════════════════
# QUICK PRINT — for testing / debugging
# ══════════════════════════════════════════════════════════════

def print_scores(scores: dict, image_path: str = ""):
    print(f"\n{'═'*55}")
    print(f"  GEOMETRIC ANALYSIS — {image_path.split('/')[-1]}")
    print(f"{'═'*55}")

    labels = {
        "aspect_ratio":       ("Aspect Ratio",        "1.0=square | >2.0=rod/shaft"),
        "circularity":        ("Circularity",          "1.0=perfect circle"),
        "convexity":          ("Convexity",            "1.0=no pockets | <0.8=undercuts"),
        "edge_density":       ("Edge Density",         "higher=more complex features"),
        "symmetry_score":     ("Symmetry",             "1.0=perfectly symmetric"),
        "hole_count":         ("Hole Count",           "counted interior voids"),
        "reflectivity":       ("Reflectivity",         "highlight pixel fraction"),
        "feature_complexity": ("Feature Complexity",   "combined complexity index"),
        "compactness":        ("Compactness",          "fill ratio of bounding box"),
        "slenderness":        ("Slenderness",          "1.0=very slender rod"),
        "surface_std_dev":    ("Surface Std Dev",      "brightness variation"),
        "mean_brightness":    ("Mean Brightness",      "0-255"),
    }

    for key, (label, note) in labels.items():
        val = scores.get(key, "—")
        print(f"  {label:<24} {str(val):<10}  # {note}")

    print(f"\n  {'Hu Moments (shape fingerprint)':}")
    for i, v in enumerate(scores.get("hu_moments", [])):
        print(f"    hu[{i}] = {v}")

    print(f"\n  {'Raw Measurements':}")
    for k, v in scores.get("raw", {}).items():
        print(f"    {k:<22} {v}")

    vec = build_geometric_vector(scores)
    print(f"\n  Pinecone Vector ({len(vec)} dims):")
    print(f"  {vec}")
    print(f"{'═'*55}\n")

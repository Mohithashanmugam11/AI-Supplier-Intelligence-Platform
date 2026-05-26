"""
visual_extractor.py
Handles extraction/conversion of visual content from uploaded files.
PDF  → extracts all embedded images
CAD  → renders to image using trimesh
Image → returns as-is (base64)
"""

import io
import base64
import os
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

RENDER_BG_RGB = (219, 222, 230)
RENDER_BG_RGBA = (RENDER_BG_RGB[0] / 255.0, RENDER_BG_RGB[1] / 255.0, RENDER_BG_RGB[2] / 255.0, 1.0)

try:
    import matplotlib
    matplotlib.use("Agg")
except Exception:
    matplotlib = None


def file_to_images_b64(file_bytes: bytes, filename: str) -> list[str]:
    """
    Main entry point. Returns list of base64-encoded JPEG strings.
    """
    ext = Path(filename).suffix.lower()

    if ext == ".pdf":
        return _extract_from_pdf(file_bytes)
    elif ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".avif"):
        return [_pil_to_b64(Image.open(io.BytesIO(file_bytes)).convert("RGB"))]
    elif ext in (".step", ".stp", ".iges", ".igs", ".stl", ".obj", ".ply", ".glb", ".gltf", ".3mf"):
        return _render_cad(file_bytes, ext)
    else:
        print(f"  ⚠ Unsupported file type: {ext}")
        return []


def _pil_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=96, optimize=True, subsampling=0)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _autocrop_render_image(
    img: Image.Image,
    *,
    bg_rgb=(219, 222, 230),
    tol: int = 10,
    out_size: int = 256,
    pad_ratio: float = 0.1,
) -> Image.Image:
    """
    Tight-crop around non-background pixels and refit to square canvas.
    Improves readability for thin/tall CAD parts in preview cards.
    """
    try:
        import numpy as np
    except Exception:
        return img

    try:
        src = img.convert("RGB")
        arr = np.asarray(src, dtype=np.int16)
        bg = np.asarray(bg_rgb, dtype=np.int16).reshape(1, 1, 3)
        mask = np.any(np.abs(arr - bg) > int(max(0, tol)), axis=2)
        ys, xs = np.where(mask)
        if ys.size == 0 or xs.size == 0:
            return src

        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        w = max(1, x1 - x0 + 1)
        h = max(1, y1 - y0 + 1)
        pad = max(4, int(max(w, h) * float(max(0.02, min(0.3, pad_ratio)))))
        x0 = max(0, x0 - pad)
        y0 = max(0, y0 - pad)
        x1 = min(arr.shape[1] - 1, x1 + pad)
        y1 = min(arr.shape[0] - 1, y1 + pad)

        crop = src.crop((x0, y0, x1 + 1, y1 + 1))
        target = int(max(128, min(512, out_size)))
        canvas = Image.new("RGB", (target, target), tuple(int(v) for v in bg_rgb))

        cw, ch = crop.size
        scale = min((target * 0.92) / max(1, cw), (target * 0.92) / max(1, ch))
        nw = max(1, int(round(cw * scale)))
        nh = max(1, int(round(ch * scale)))
        crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)
        ox = (target - nw) // 2
        oy = (target - nh) // 2
        canvas.paste(crop, (ox, oy))
        return canvas
    except Exception:
        return img


def _shade_tri_faces(tris, base_rgb=(0.38, 0.40, 0.44)):
    """
    Simple Lambert shading so CAD previews preserve depth/features.
    """
    import numpy as np

    tri = np.asarray(tris, dtype=float)
    if tri.ndim != 3 or tri.shape[1] != 3 or tri.shape[2] != 3:
        base = np.array(base_rgb, dtype=float)
        return np.tile(np.array([base[0], base[1], base[2], 1.0], dtype=float), (max(len(tri), 1), 1))

    v1 = tri[:, 1] - tri[:, 0]
    v2 = tri[:, 2] - tri[:, 0]
    n = np.cross(v1, v2)
    n_norm = np.linalg.norm(n, axis=1, keepdims=True)
    n = n / np.clip(n_norm, 1e-9, None)

    light = np.array([0.35, -0.35, 0.87], dtype=float)
    light = light / np.linalg.norm(light)
    intensity = (n @ light).reshape(-1)
    intensity = np.clip(intensity, -0.35, 1.0)
    intensity = 0.35 + 0.65 * ((intensity + 0.35) / 1.35)

    base = np.array(base_rgb, dtype=float).reshape(1, 3)
    rgb = np.clip(base * (0.62 + 0.72 * intensity[:, None]), 0.0, 1.0)
    alpha = np.ones((rgb.shape[0], 1), dtype=float)
    return np.hstack([rgb, alpha])


def _is_likely_noise_asset(pil_img: Image.Image) -> bool:
    """
    Heuristic noise filter for PDF-extracted assets:
    - logos/seals (very low color complexity)
    - signatures/stamps (mostly white background with sparse ink)
    - human/photo-like inserts (skin-heavy low-edge regions)
    """
    try:
        import numpy as np
        arr = np.asarray(pil_img.convert("RGB"), dtype=np.uint8)
        h, w = arr.shape[:2]
        if h == 0 or w == 0:
            return True

        # 1) Near-monochrome / logo-like
        q = (arr // 16).reshape(-1, 3)
        uniq_bins = int(np.unique(q, axis=0).shape[0])
        if uniq_bins < 24:
            return True

        # 2) Signature/stamp-like: mostly white with very little dark ink
        gray = (0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]).astype(np.float32)
        white_ratio = float((gray > 240).mean())
        dark_ratio = float((gray < 70).mean())
        if white_ratio > 0.90 and dark_ratio < 0.05:
            return True

        # 2b) Watermark/logo-like overlays:
        # very sparse non-white foreground + low edge complexity.
        fg_ratio = float((gray < 232).mean())
        gx_wm = np.abs(np.diff(gray, axis=1))
        gy_wm = np.abs(np.diff(gray, axis=0))
        edge_density_wm = float((((gx_wm > 16).sum() + (gy_wm > 16).sum()) / max(1, (gx_wm.size + gy_wm.size))))
        if fg_ratio < 0.08 and edge_density_wm < 0.028:
            return True

        # 3) Human-photo-like insert: skin-heavy and low-edge detail
        r = arr[:, :, 0].astype(np.int16)
        g = arr[:, :, 1].astype(np.int16)
        b = arr[:, :, 2].astype(np.int16)
        skin = (
            (r > 95) & (g > 40) & (b > 20) &
            ((np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)) > 15) &
            (np.abs(r - g) > 15) & (r > g) & (r > b)
        )
        skin_ratio = float(skin.mean())
        gx = np.abs(np.diff(gray, axis=1))
        gy = np.abs(np.diff(gray, axis=0))
        edge_density = float((((gx > 18).sum() + (gy > 18).sum()) / max(1, (gx.size + gy.size))))
        if skin_ratio > 0.35 and edge_density < 0.025:
            return True
    except Exception:
        return False
    return False


def _extract_from_pdf(file_bytes: bytes) -> list[str]:

    try:
        import fitz
        max_images = int(os.getenv("PDF_EXTRACT_MAX_IMAGES", "16"))
        max_side = int(os.getenv("PDF_EXTRACT_MAX_SIDE_PX", "1600"))
        min_w = int(os.getenv("PDF_EXTRACT_MIN_WIDTH_PX", "220"))
        min_h = int(os.getenv("PDF_EXTRACT_MIN_HEIGHT_PX", "180"))
        min_area = int(os.getenv("PDF_EXTRACT_MIN_AREA_PX", "90000"))
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        images = []
        fallback_candidates = []
        seen_xrefs = set()
        for page in doc:
            for img in page.get_images(full=True):
                xref = img[0]
                if xref in seen_xrefs:
                    continue
                seen_xrefs.add(xref)
                base_img = doc.extract_image(xref)
                raw = base_img["image"]
                try:
                    pil = Image.open(io.BytesIO(raw)).convert("RGB")
                    w, h = pil.size
                    area = w * h
                    aspect = (max(w, h) / max(1, min(w, h)))

                    # Keep raw bytes candidates in case strict filtering removes everything.
                    # This avoids holding many full-size PIL copies in memory.
                    fallback_candidates.append(raw)

                    # Filter likely logos/signatures/separators.
                    if w < min_w or h < min_h or area < min_area:
                        continue
                    # Very thin banner-like assets are usually headers/footers.
                    if aspect > 6.0 and min(w, h) < 260:
                        continue
                    if _is_likely_noise_asset(pil):
                        continue

                    if max(pil.size) > max_side:
                        pil.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
                    images.append(_pil_to_b64(pil))
                    if len(images) >= max_images:
                        print(f"  [pdf] image cap reached ({max_images}); truncating extraction")
                        print(f"  [pdf] extracted {len(images)} images (capped)")
                        return images
                except Exception:
                    continue
        print(f"  [pdf] extracted {len(images)} images")
        if not images and fallback_candidates:
            # Graceful fallback: keep a small set so upload doesn't appear to fail on scanned/compact PDFs.
            relaxed_cap = min(max_images, 4)
            picked = []
            for raw in fallback_candidates:
                try:
                    pil = Image.open(io.BytesIO(raw)).convert("RGB")
                except Exception:
                    continue
                if max(pil.size) > max_side:
                    pil.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
                picked.append(_pil_to_b64(pil))
                if len(picked) >= relaxed_cap:
                    break
            if picked:
                print(f"  [pdf] strict filter yielded 0; fallback kept {len(picked)} image(s)")
                return picked
        enable_page_render_fallback = str(os.getenv("PDF_PAGE_RENDER_FALLBACK_ENABLED", "false")).strip().lower() in {
            "1", "true", "yes", "on", "enabled"
        }
        if not images and enable_page_render_fallback:
            # Final fallback: render PDF pages directly (handles text/vector PDFs with no embedded rasters).
            try:
                page_scale = float(os.getenv("PDF_PAGE_RENDER_SCALE", "2.0"))
            except Exception:
                page_scale = 2.0
            page_scale = max(1.0, min(3.0, page_scale))
            try:
                max_pages = int(os.getenv("PDF_PAGE_RENDER_MAX_PAGES", "6"))
            except Exception:
                max_pages = 6
            max_pages = max(1, min(20, max_pages))
            try:
                page_max_side = int(os.getenv("PDF_PAGE_RENDER_MAX_SIDE_PX", str(max_side)))
            except Exception:
                page_max_side = max_side
            page_max_side = max(512, min(3000, page_max_side))

            rendered = []
            page_count = len(doc)
            pages_to_render = min(page_count, max_pages)
            print(
                f"  [pdf] no embedded images; rendering {pages_to_render}/{page_count} page(s) "
                f"at scale={page_scale}"
            )
            for page_idx in range(pages_to_render):
                try:
                    page = doc[page_idx]
                    pix = page.get_pixmap(matrix=fitz.Matrix(page_scale, page_scale), alpha=False)
                    mode = "RGB" if pix.n < 4 else "RGBA"
                    pil = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
                    if mode == "RGBA":
                        pil = pil.convert("RGB")
                    if max(pil.size) > page_max_side:
                        pil.thumbnail((page_max_side, page_max_side), Image.Resampling.LANCZOS)
                    rendered.append(_pil_to_b64(pil))
                except Exception as e:
                    print(f"  [pdf] page render failed for page {page_idx + 1}: {e}")
                    continue
            if rendered:
                print(f"  [pdf] page-render fallback produced {len(rendered)} image(s)")
                return rendered
        elif not images and not enable_page_render_fallback:
            print("  [pdf] no images extracted; page-render fallback disabled")
        return images
    except ImportError:
        print("  [pdf] PyMuPDF not installed - run: pip install pymupdf")
        return []
    except Exception as e:
        print(f"  ✗ PDF extraction failed: {e}")
        return []


def _render_cad(file_bytes: bytes, ext: str) -> list[str]:
    try:
        import trimesh
    except ImportError as e:
        print(f"  ✗ CAD dependency missing ({e}) — run: pip install trimesh")
        return []

    try:
        ext_name = ext.lstrip(".")
        if ext_name == "stp":
            ext_name = "step"
        if ext_name == "igs":
            ext_name = "iges"

        # Loader fallback chain (for in-memory bytes we must always pass file_type):
        # 1) force mesh (best for downstream rendering)
        # 2) normal load (may return Scene)
        # 3) force scene (handles some 3MF scene graph variants)
        load_attempts = [
            {"file_type": ext_name, "force": "mesh"},
            {"file_type": ext_name},
            {"file_type": ext_name, "force": "scene"},
        ]
        mesh = None
        last_err = None
        for opts in load_attempts:
            try:
                mesh = trimesh.load(io.BytesIO(file_bytes), **opts)
                if mesh is not None:
                    break
            except Exception as e:
                last_err = e
                continue
        if mesh is None:
            if ext_name == "3mf":
                mesh = _load_3mf_mesh_from_xml(file_bytes, trimesh)
                if mesh is not None:
                    print("  ✓ CAD: 3MF XML mesh fallback succeeded")
            if mesh is None:
                raise RuntimeError(last_err or "CAD load failed")

        # Handle scene vs single mesh
        if isinstance(mesh, trimesh.Scene):
            # Some 3MFs have scene graph naming oddities (e.g. "world"),
            # so use dump(concatenate=True) first, then geometry fallback.
            try:
                dumped = mesh.dump(concatenate=True)
                if dumped is not None:
                    mesh = dumped
            except Exception:
                geoms = [g for g in mesh.geometry.values() if hasattr(g, "faces")]
                geoms = [g for g in geoms if len(getattr(g, "faces", [])) > 0]
                if not geoms:
                    print("  ⚠ CAD file has no mesh geometry")
                    return []
                mesh = trimesh.util.concatenate(geoms)

        if isinstance(mesh, (list, tuple)):
            geoms = [g for g in mesh if hasattr(g, "faces") and len(getattr(g, "faces", [])) > 0]
            if not geoms:
                print("  ⚠ CAD list load has no mesh geometry")
                return []
            mesh = trimesh.util.concatenate(geoms)

        if not hasattr(mesh, "vertices") or not hasattr(mesh, "faces"):
            print("  ⚠ CAD load did not return a mesh with vertices/faces")
            return []

        # Cap triangle count before rendering.
        # Use a higher default so previews remain close to STEP/STL quality.
        max_faces_raw = os.getenv("CAD_RENDER_MAX_FACES", "60000").strip()
        try:
            MAX_FACES = int(max_faces_raw)
        except Exception:
            MAX_FACES = 60000
        MAX_FACES = max(8000, min(80000, MAX_FACES))
        if hasattr(mesh, "faces") and len(mesh.faces) > MAX_FACES:
            try:
                mesh = mesh.simplify_quadric_decimation(MAX_FACES)
                print(f"  ⚑ CAD mesh decimated to {len(mesh.faces)} faces")
            except Exception:
                # If decimation fails, keep original geometry to avoid ugly faceting.
                print("  ⚠ CAD decimation failed; using original mesh for quality")

        import numpy as np
        import matplotlib.pyplot as plt
        from mpl_toolkits.mplot3d.art3d import Poly3DCollection

        verts = np.asarray(mesh.vertices, dtype=float)
        faces = np.asarray(mesh.faces, dtype=int)

        # Robust normalization: prevent far-out outliers from shrinking the object in frame.
        center = np.median(verts, axis=0)
        v = verts - center
        d = np.linalg.norm(v, axis=1)
        p = float(np.percentile(d, 99.5)) if d.size else 0.0
        radius = p if p > 1e-9 else float(np.max(d) if d.size else 1.0)
        if radius <= 1e-9:
            radius = 1.0
        v = v / radius
        v = np.clip(v, -1.35, 1.35)
        tris = v[faces]

        bg   = RENDER_BG_RGBA
        body = (0.48, 0.50, 0.54, 1.0)
        edge = (0.10, 0.10, 0.10, 0.55)

        # 3 angles kept for UI preview; iso view is used for scoring.
        # Use configurable render resolution for better quality when needed.
        render_res_raw = os.getenv("CAD_RENDER_RES", "256").strip()
        try:
            render_res = int(render_res_raw)
        except Exception:
            render_res = 256
        render_res = max(160, min(512, render_res))
        supersample_raw = os.getenv("CAD_RENDER_SUPERSAMPLE", "2").strip()
        try:
            supersample = int(supersample_raw)
        except Exception:
            supersample = 2
        supersample = max(1, min(3, supersample))
        render_px = int(min(1024, render_res * supersample))
        fig_size = render_px / 100.0
        angles = [
            (24,  36),   # front-iso  ← used by _choose_isometric_cad_view for scoring
            ( 8,  90),   # front
            (90,  90),   # top
        ]
        images = []
        for elev, azim in angles:
            try:
                tri_count = int(getattr(tris, "shape", [0])[0] or 0)
                fast_style = tri_count >= int(os.getenv("CAD_FAST_STYLE_TRI_THRESHOLD", "35000"))
                lw = 0.03 if fast_style else 0.08
                edge_rgba = (0.12, 0.12, 0.12, 0.16) if fast_style else (0.10, 0.10, 0.10, 0.24)
                fig = plt.figure(figsize=(fig_size, fig_size), dpi=100, facecolor=bg)
                ax  = fig.add_subplot(1, 1, 1, projection="3d")
                ax.set_facecolor(bg)
                facecolors = _shade_tri_faces(tris, base_rgb=body[:3] if isinstance(body, tuple) else (0.38, 0.40, 0.44))
                poly = Poly3DCollection(
                    tris,
                    facecolor=facecolors,
                    edgecolor=edge_rgba,
                    linewidths=lw,
                    antialiaseds=True,
                    alpha=1.0,
                )
                ax.add_collection3d(poly)
                ax.set_xlim(-0.95, 0.95)
                ax.set_ylim(-0.95, 0.95)
                ax.set_zlim(-0.95, 0.95)
                ax.set_box_aspect((1, 1, 1))
                ax.view_init(elev=elev, azim=azim)
                try:
                    projection = os.getenv("CAD_PROJECTION", "persp").strip().lower()
                    ax.set_proj_type("ortho" if projection == "ortho" else "persp")
                except Exception:
                    pass
                ax.set_axis_off()
                plt.subplots_adjust(left=0.01, right=0.99, bottom=0.01, top=0.99)
                buf = io.BytesIO()
                fig.savefig(buf, format="png", dpi=100, facecolor=bg)
                plt.close(fig)
                pil = Image.open(buf).convert("RGB")
                if pil.size != (render_res, render_res):
                    pil = pil.resize((render_res, render_res), Image.Resampling.LANCZOS)
                pil = _autocrop_render_image(
                    pil,
                    bg_rgb=RENDER_BG_RGB,
                    tol=10,
                    out_size=render_res,
                    pad_ratio=0.1,
                )
                images.append(_pil_to_b64(pil))
            except Exception as e:
                print(f"  ⚠ CAD render angle ({elev},{azim}) failed: {e}")
                plt.close("all")
                continue

        print(f"  ✓ CAD: rendered {len(images)} views (matplotlib/Agg)")
        return images

    except ImportError as e:
        if ext in (".step", ".stp"):
            print(f"  ✗ STEP/STP dependency missing ({e}) — run: pip install cascadio")
        else:
            print(f"  ✗ CAD dependency missing ({e}) — run: pip install trimesh")
        if ext == ".3mf":
            fallback = _extract_3mf_embedded_images(file_bytes)
            if fallback:
                print(f"  ✓ 3MF fallback: extracted {len(fallback)} embedded image(s)")
                return fallback
        return []
    except Exception as e:
        print(f"  ✗ CAD render failed: {e}")
        if ext == ".3mf":
            fallback = _extract_3mf_embedded_images(file_bytes)
            if fallback:
                print(f"  ✓ 3MF fallback: extracted {len(fallback)} embedded image(s)")
                return fallback
        return []


def _parse_3mf_transform_matrix(transform_str: str):
    vals = [v for v in str(transform_str or "").strip().split() if v]
    if len(vals) != 12:
        return None
    try:
        nums = [float(v) for v in vals]
    except Exception:
        return None
    # 3MF transform order (12 vals):
    # m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32
    # where m30/m31/m32 are translation terms.
    return [
        [nums[0], nums[1], nums[2], nums[9]],
        [nums[3], nums[4], nums[5], nums[10]],
        [nums[6], nums[7], nums[8], nums[11]],
    ]


def _apply_3mf_transform(vertices, mat34):
    if mat34 is None:
        return vertices
    import numpy as np
    v = np.asarray(vertices, dtype=float)
    if v.size == 0:
        return v
    ones = np.ones((v.shape[0], 1), dtype=float)
    vh = np.hstack([v, ones])
    m = np.asarray(mat34, dtype=float)
    return vh @ m.T


def _load_3mf_mesh_from_xml(file_bytes: bytes, trimesh_module):
    import numpy as np

    with zipfile.ZipFile(io.BytesIO(file_bytes), "r") as zf:
        model_name = None
        for n in zf.namelist():
            if n.lower() == "3d/3dmodel.model":
                model_name = n
                break
        if not model_name:
            for n in zf.namelist():
                if n.lower().endswith(".model"):
                    model_name = n
                    break
        if not model_name:
            return None
        model_xml = zf.read(model_name)

    root = ET.fromstring(model_xml)

    def _lname(tag: str) -> str:
        return str(tag).split("}")[-1]

    def _first_child_by_name(node, name: str):
        if node is None:
            return None
        for ch in list(node):
            if _lname(ch.tag) == name:
                return ch
        return None

    def _children_by_name(node, name: str):
        if node is None:
            return []
        return [ch for ch in list(node) if _lname(ch.tag) == name]

    resources = _first_child_by_name(root, "resources")
    if resources is None:
        for el in root.iter():
            if _lname(el.tag) == "resources":
                resources = el
                break
    if resources is None:
        return None

    objects = {}
    for obj in _children_by_name(resources, "object"):
        oid = obj.attrib.get("id")
        if not oid:
            continue
        mesh_node = _first_child_by_name(obj, "mesh")
        comps_node = _first_child_by_name(obj, "components")
        if mesh_node is not None:
            verts = []
            faces = []
            verts_node = _first_child_by_name(mesh_node, "vertices")
            tris_node = _first_child_by_name(mesh_node, "triangles")
            if verts_node is not None:
                for v in _children_by_name(verts_node, "vertex"):
                    try:
                        verts.append([float(v.attrib.get("x", 0.0)), float(v.attrib.get("y", 0.0)), float(v.attrib.get("z", 0.0))])
                    except Exception:
                        continue
            if tris_node is not None:
                for t in _children_by_name(tris_node, "triangle"):
                    try:
                        faces.append([int(t.attrib.get("v1", 0)), int(t.attrib.get("v2", 0)), int(t.attrib.get("v3", 0))])
                    except Exception:
                        continue
            if verts and faces:
                objects[oid] = {
                    "type": "mesh",
                    "vertices": np.asarray(verts, dtype=float),
                    "faces": np.asarray(faces, dtype=int),
                }
                continue
        if comps_node is not None:
            comps = []
            for c in _children_by_name(comps_node, "component"):
                refid = c.attrib.get("objectid")
                if not refid:
                    continue
                comps.append((refid, _parse_3mf_transform_matrix(c.attrib.get("transform", ""))))
            if comps:
                objects[oid] = {"type": "components", "components": comps}

    if not objects:
        return None

    cache = {}

    def build_obj(oid, stack=None):
        stack = stack or set()
        if oid in cache:
            return cache[oid].copy()
        if oid in stack:
            return None
        desc = objects.get(oid)
        if not desc:
            return None
        stack.add(oid)
        result = None
        if desc["type"] == "mesh":
            result = trimesh_module.Trimesh(vertices=desc["vertices"], faces=desc["faces"], process=False)
        else:
            parts = []
            for child_id, mat in desc.get("components", []):
                child = build_obj(child_id, stack)
                if child is None:
                    continue
                v = _apply_3mf_transform(child.vertices, mat)
                child = trimesh_module.Trimesh(vertices=v, faces=child.faces, process=False)
                if len(child.faces) > 0:
                    parts.append(child)
            if parts:
                result = trimesh_module.util.concatenate(parts)
        stack.remove(oid)
        if result is not None:
            cache[oid] = result.copy()
        return result

    build_node = _first_child_by_name(root, "build")
    if build_node is None:
        for el in root.iter():
            if _lname(el.tag) == "build":
                build_node = el
                break
    meshes = []
    if build_node is not None:
        for item in _children_by_name(build_node, "item"):
            oid = item.attrib.get("objectid")
            if not oid:
                continue
            m = build_obj(oid, set())
            if m is None:
                continue
            mat = _parse_3mf_transform_matrix(item.attrib.get("transform", ""))
            if mat is not None:
                v = _apply_3mf_transform(m.vertices, mat)
                m = trimesh_module.Trimesh(vertices=v, faces=m.faces, process=False)
            if len(m.faces) > 0:
                meshes.append(m)
    if not meshes:
        for oid, d in objects.items():
            if d.get("type") == "mesh":
                m = build_obj(oid, set())
                if m is not None and len(m.faces) > 0:
                    meshes.append(m)
    if not meshes:
        return None
    return trimesh_module.util.concatenate(meshes)


def _extract_3mf_embedded_images(file_bytes: bytes) -> list[str]:
    """
    Fallback for 3MF variants that fail trimesh parsing (e.g. graph/'world' errors).
    Pull thumbnail/embedded images directly from the .3mf ZIP package.
    """
    try:
        out = []
        with zipfile.ZipFile(io.BytesIO(file_bytes), "r") as zf:
            names = zf.namelist()
            # Prefer thumbnail-ish images first.
            candidates = []
            for n in names:
                lower = n.lower()
                if lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp")):
                    score = 0
                    if "thumbnail" in lower:
                        score += 4
                    if "thumbnails/" in lower:
                        score += 3
                    if "metadata/" in lower:
                        score += 1
                    candidates.append((score, n))

            ranked = []
            for score, name in candidates:
                try:
                    raw = zf.read(name)
                    img = Image.open(io.BytesIO(raw)).convert("RGB")
                    w, h = img.size
                    area = int(w) * int(h)
                    import numpy as np
                    arr = np.asarray(img, dtype=np.uint8)
                    std = float(arr.std())
                    detail_ok = (area >= 64000) and (std >= 8.0)
                    quality_score = (2.0 * std) + (area / 100000.0)
                    ranked.append((int(detail_ok), quality_score, area, score, name, img))
                except Exception:
                    continue
            # Biggest previews first, then thumbnail hint score.
            ranked.sort(key=lambda x: (-x[0], -x[1], -x[2], -x[3], x[4]))
            for _, _, _, _, _, img in ranked[:3]:
                min_side = min(img.size)
                if min_side < 512 and min_side > 0:
                    scale = 512.0 / float(min_side)
                    new_w = int(round(img.size[0] * scale))
                    new_h = int(round(img.size[1] * scale))
                    img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
                out.append(_pil_to_b64(img))
        return out
    except Exception:
        return []

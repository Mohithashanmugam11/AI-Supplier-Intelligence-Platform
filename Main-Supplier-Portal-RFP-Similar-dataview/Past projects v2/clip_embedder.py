import hashlib
import os
import re

import numpy as np
from PIL import Image, ImageOps

_model = None
_processor = None
_loaded = False
_projection = None

EMBEDDER_BACKEND = os.getenv("EMBEDDER_BACKEND", "clip").strip().lower()
IMAGE_SIZE = int(os.getenv("EMBEDDER_IMAGE_SIZE", os.getenv("CLIP_IMAGE_SIZE", "224")))
EMBED_DIM = int(os.getenv("EMBEDDER_DIM", "512"))

try:
    _BICUBIC = Image.Resampling.BICUBIC
except AttributeError:
    _BICUBIC = Image.BICUBIC


def _l2_normalize(vec):
    arr = np.asarray(vec, dtype=np.float32).reshape(-1)
    if arr.size == 0:
        return None
    norm = float(np.linalg.norm(arr))
    if norm <= 1e-12:
        return None
    arr = arr / norm
    return arr.astype(np.float32).tolist()


def _get_projection(in_dim: int, out_dim: int):
    global _projection
    if _projection is not None and _projection.shape == (in_dim, out_dim):
        return _projection
    rng = np.random.default_rng(42)  # deterministic projection
    mat = rng.normal(0.0, 1.0 / np.sqrt(max(1, in_dim)), size=(in_dim, out_dim)).astype(np.float32)
    _projection = mat
    return _projection


def _extract_feature_vector(output):
    if output is None:
        return None

    if hasattr(output, "detach"):
        return output.detach().cpu().numpy()

    for attr in ("image_embeds", "pooler_output", "last_hidden_state"):
        value = getattr(output, attr, None)
        if value is not None:
            if hasattr(value, "detach"):
                value = value.detach().cpu().numpy()
            if attr == "last_hidden_state" and getattr(value, "ndim", 0) >= 2:
                value = value[:, 0, :] if value.ndim == 3 else value[0]
            return value

    if isinstance(output, (list, tuple)) and output:
        return _extract_feature_vector(output[0])

    return None


def _load_efficientnet():
    global _model, _processor
    import torch
    from torchvision.models import EfficientNet_B0_Weights, efficientnet_b0

    print("  Loading EfficientNet-B0 model (low-RAM visual embedder)...")
    weights = EfficientNet_B0_Weights.DEFAULT
    base = efficientnet_b0(weights=weights)
    _model = base.features.eval()
    _processor = weights.transforms()
    print("  EfficientNet-B0 model loaded")
    return True


def _load_clip():
    global _model, _processor
    import torch
    from transformers import CLIPModel, CLIPProcessor

    print("  Loading CLIP model (first time ~600MB download, cached after)...")
    _model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
    _processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32", use_fast=True)
    _model.eval()

    # Optional low-RAM optimization for CPU inference.
    use_quant = os.getenv("CLIP_DYNAMIC_QUANTIZE", "true").strip().lower() in {"1", "true", "yes", "on"}
    if use_quant:
        try:
            _model = torch.quantization.quantize_dynamic(_model, {torch.nn.Linear}, dtype=torch.qint8)
        except Exception as qerr:
            print(f"  CLIP quantization skipped: {qerr}")

    print("  CLIP model loaded")
    return True


def _load():
    global _loaded
    if _loaded:
        return _model is not None
    _loaded = True
    try:
        if EMBEDDER_BACKEND in {"efficientnet", "efficientnet_b0", "effnet"}:
            return _load_efficientnet()
        return _load_clip()
    except Exception as e:
        print(f"  Embedder load failed ({EMBEDDER_BACKEND}): {e}")
        return False


def _prepare_image(image: Image.Image) -> Image.Image:
    image = image.convert("RGB")
    return ImageOps.fit(image, (IMAGE_SIZE, IMAGE_SIZE), method=_BICUBIC)


def _compute_visual_embedding(image: Image.Image):
    if not _load():
        return None
    try:
        import torch
        import torch.nn.functional as F

        if EMBEDDER_BACKEND in {"efficientnet", "efficientnet_b0", "effnet"}:
            inputs = _processor(image).unsqueeze(0)
            with torch.no_grad():
                feat = _model(inputs)  # [1, 1280, 7, 7]
                feat = F.adaptive_avg_pool2d(feat, (1, 1)).flatten(1)  # [1,1280]
            arr = feat.cpu().numpy().astype(np.float32)[0]
            proj = arr @ _get_projection(arr.shape[0], EMBED_DIM)
            return _l2_normalize(proj)

        inputs = _processor(images=image, return_tensors="pt", padding=True)
        with torch.no_grad():
            try:
                features = _model.get_image_features(**inputs)
            except Exception:
                outputs = _model(**inputs)
                features = _extract_feature_vector(outputs)
            else:
                features = _extract_feature_vector(features)

        if features is None:
            return None
        if hasattr(features, "detach"):
            features = features.detach().cpu().numpy()
        features = np.asarray(features, dtype=np.float32)
        if features.ndim > 1:
            features = features[0]
        return _l2_normalize(features)
    except Exception as e:
        print(f"  Visual embedding failed: {e}")
        return None


def _hash_text_embedding(text: str):
    clean = (text or "").strip().lower()
    if not clean:
        return None
    tokens = re.findall(r"[a-z0-9]+", clean)
    if not tokens:
        return None
    vec = np.zeros((EMBED_DIM,), dtype=np.float32)
    for tok in tokens:
        digest = hashlib.sha256(tok.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:4], "big") % EMBED_DIM
        sign = 1.0 if (digest[4] % 2 == 0) else -1.0
        vec[idx] += sign
    return _l2_normalize(vec)


def compute_clip_embedding(image_path: str) -> list:
    try:
        image = Image.open(image_path)
        image = _prepare_image(image)
        return _compute_visual_embedding(image)
    except Exception as e:
        print(f"  Visual embedding failed: {e}")
        return None


def compute_clip_embedding_from_pil(image: Image.Image) -> list:
    image = _prepare_image(image)
    return _compute_visual_embedding(image)


def compute_clip_text_embedding(text: str) -> list:
    if EMBEDDER_BACKEND in {"efficientnet", "efficientnet_b0", "effnet"}:
        return _hash_text_embedding(text)

    if not _load():
        return None
    try:
        import torch

        clean = (text or "").strip()
        if not clean:
            return None

        inputs = _processor(text=[clean], return_tensors="pt", padding=True, truncation=True)
        with torch.no_grad():
            features = _model.get_text_features(**inputs)
            features = _extract_feature_vector(features)

        if features is None:
            return None
        if hasattr(features, "detach"):
            features = features.detach().cpu().numpy()
        features = np.asarray(features, dtype=np.float32)
        if features.ndim > 1:
            features = features[0]
        return _l2_normalize(features)
    except Exception as e:
        print(f"  CLIP text embedding failed: {e}")
        return None

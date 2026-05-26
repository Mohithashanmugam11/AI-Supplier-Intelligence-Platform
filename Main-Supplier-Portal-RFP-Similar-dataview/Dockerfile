FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=10000 \
    WEB_CONCURRENCY=1 \
    TOKENIZERS_PARALLELISM=false \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    MALLOC_ARENA_MAX=2 \
    CAD_RENDER_RES=320 \
    CAD_RENDER_VIEWS=1 \
    MAX_CAD_FILE_MB=20 \
    CAD_FALLBACK_MAX_VERTICES=50000 \
    CAD_FALLBACK_MAX_FACES=35000 \
    EMBEDDER_BACKEND=efficientnet_b0 \
    DEFER_PINECONE_INIT=true \
    CLIP_WARMUP=false \
    LIBGL_ALWAYS_SOFTWARE=1 \
    PYGLET_HEADLESS=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.docker.txt /app/requirements.docker.txt

# CPU-only torch/torchvision to avoid CUDA bloat on Render
RUN pip install --upgrade pip && \
    pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision && \
    pip install matplotlib && \
    pip install -r /app/requirements.docker.txt

COPY . /app

EXPOSE 10000

CMD ["sh", "-c", "python -m uvicorn unified.backend.app:app --host 0.0.0.0 --port ${PORT}"]

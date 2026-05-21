# syntax=docker/dockerfile:1
# ── Stage 1: install dependencies ─────────────────────────────────────────────
FROM python:3.11-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc tesseract-ocr && \
    rm -rf /var/lib/apt/lists/*

# Make pip aware of packages already installed in /install across all RUN steps.
# Without this, each pip invocation starts with a blank slate and re-resolves
# deps from scratch, causing version downgrades / numpy 1.x vs 2.x conflicts.
ENV PYTHONPATH=/install/lib/python3.11/site-packages

# ── Torch CPU + numpy 2.x (one layer, no CUDA wheel, numpy pinned before scipy) ──
# torch's own deps install numpy 1.x; we immediately upgrade it to 2.x in the
# same RUN so the next layer never sees 1.x. scipy 1.13+ is compiled for
# numpy 2.x (uses numpy._core) and will ImportError with numpy 1.x.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install --prefix=/install \
        "torch" --index-url https://download.pytorch.org/whl/cpu && \
    pip install --prefix=/install --upgrade \
        "numpy>=2.0.0"

# ── All remaining app deps ────────────────────────────────────────────────────
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefix=/install -r requirements.txt && \
    pip install --prefix=/install \
        https://github.com/explosion/spacy-models/releases/download/en_core_web_md-3.7.1/en_core_web_md-3.7.1-py3-none-any.whl

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd -r appuser && useradd -r -g appuser appuser

COPY --from=builder /install /usr/local

COPY --chown=appuser:appuser . .

# Create uploads dir and HuggingFace model cache (both writable by appuser).
# appuser is a system user with no home dir, so HF_HOME must point here.
RUN mkdir -p /app/uploads /app/.cache/huggingface && \
    chown -R appuser:appuser /app/uploads /app/.cache/huggingface && \
    chmod +x /app/entrypoint.sh

ENV HF_HOME=/app/.cache/huggingface

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/ready || exit 1

CMD ["/app/entrypoint.sh"]

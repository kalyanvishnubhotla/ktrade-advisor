# ─────────────────────────────────────────────────────────────────────────────
# KTrade Advisor — multi-stage Docker build
#
# Final image: ~350 MB, runs on linux/amd64 + linux/arm64
# (Apple Silicon runs natively; Intel runs natively; no QEMU at runtime.)
#
# Stage 1 (build-frontend): Node 20 builds the Vite/React app to /app/dist
# Stage 2 (runtime):        python:3.12-slim-bookworm runs FastAPI/uvicorn
#                           with the pre-built frontend mounted at /
#
# Why slim-bookworm: identical Python runtime to the full image, but ~150 MB
# smaller and Debian Bookworm has pre-built wheels for pandas/numpy/yfinance —
# so no gcc/build-essential needed in the final image.
# ─────────────────────────────────────────────────────────────────────────────


# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  STAGE 1 — build the React frontend                                       ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
FROM node:20-alpine AS build-frontend

WORKDIR /build

# Copy ONLY package files first so npm install is cached when source changes
# without dep changes. Saves ~40s on incremental builds.
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Now copy the rest of the frontend source and build
COPY frontend/ ./
RUN npm run build
# Output: /build/dist/ (Vite default)


# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  STAGE 2 — Python runtime                                                 ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
FROM python:3.12-slim-bookworm AS runtime

# Don't write .pyc files in the container (smaller image, no benefit)
# Don't buffer stdout/stderr (so `docker logs` shows output in real time)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    KTRADE_DOCKER=1 \
    KTRADE_PORT=8000

WORKDIR /app

# ── System packages ──────────────────────────────────────────────────────────
# pdfplumber → needs libfreetype/libjpeg via Pillow wheel (already binary).
# We need curl just for the HEALTHCHECK. ca-certificates for outbound HTTPS
# (yfinance, RSS feeds). Clean up apt lists to keep the layer small.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        tini \
 && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ──────────────────────────────────────────────────────
# Copy ONLY requirements.txt first so the (slow) pip install layer is cached
# across code changes when deps haven't changed.
COPY requirements.txt ./
RUN pip install --upgrade pip \
 && pip install -r requirements.txt

# ── Application source ───────────────────────────────────────────────────────
# Backend code (the .dockerignore excludes everything we don't want)
COPY backend/ ./backend/

# Frontend built artifact from stage 1
COPY --from=build-frontend /build/dist ./frontend/dist

# ── Non-root user + data volume ──────────────────────────────────────────────
# Run as a dedicated unprivileged user. UID 1000 matches typical Linux hosts
# so bind-mounted volumes are owned correctly out of the box. macOS Docker
# Desktop transparently maps UIDs so this Just Works there too.
RUN groupadd --gid 1000 ktrade \
 && useradd --uid 1000 --gid 1000 --create-home --shell /bin/sh ktrade \
 && mkdir -p /app/data \
 && chown -R ktrade:ktrade /app

USER ktrade

# /app/data is where SQLite lives. Declaring VOLUME makes Docker treat it as
# external state — `docker-compose.yml` bind-mounts it to ./data on the host.
VOLUME ["/app/data"]

EXPOSE 8000

# ── Healthcheck ──────────────────────────────────────────────────────────────
# Docker uses this to mark the container "healthy" when /api/health responds.
# Useful for orchestrators and just nice feedback in `docker ps`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent http://localhost:8000/api/health >/dev/null || exit 1

# tini = tiny init: handles signal forwarding (so Ctrl+C / docker stop are
# clean) and reaps zombies from any subprocesses yfinance might spawn.
ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]

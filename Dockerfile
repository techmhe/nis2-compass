# syntax=docker/dockerfile:1.7
# ---- frontend build ----------------------------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- backend runtime ---------------------------------------------------------------------------------
FROM python:3.14-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH" \
    NIS2_ENV=production NIS2_DATA_DIR=/data NIS2_FRONTEND_DIST=/app/frontend_dist
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
COPY --from=web /web/dist /app/frontend_dist
RUN useradd --system --uid 10001 --home /app nis2 && mkdir -p /data && chown -R nis2 /data \
    && chmod +x /app/entrypoint.sh
USER nis2
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=4).status==200 else 1)"
ENTRYPOINT ["/app/entrypoint.sh"]

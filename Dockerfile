# syntax=docker/dockerfile:1.7
# Base images are pinned by version and digest; bump both together.
# ---- frontend build ----------------------------------------------------------------------------------
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- backend runtime ---------------------------------------------------------------------------------
FROM python:3.14.10-slim@sha256:fa99b65193ea9dbde3fc2367f43d3a2907571ce2a15213a86f0053e1d49d8456 AS app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH" \
    NIS2_ENV=production NIS2_DATA_DIR=/data NIS2_FRONTEND_DIST=/app/frontend_dist
COPY --from=docker.io/astral/uv:0.10.4@sha256:4cac394b6b72846f8a85a7a0e577c6d61d4e17fe2ccee65d9451a8b3c9efb4ac /uv /usr/local/bin/uv
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

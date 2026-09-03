# Multi-stage build for the SA-2025 Generator web edition.
# Build context is the repo root (see docker-compose.yml).
#
#   Stage 1 (node)   builds the SPA          -> frontend/dist
#   Stage 2 (rust)   builds the API server   -> sa2025-web binary
#   Stage 3 (slim)   minimal runtime image   -> binary + static dist + resources
#
# TLS is terminated upstream (Nginx Proxy Manager), so the container speaks
# plain HTTP on $PORT.

# ---- Stage 1: build the frontend ----
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: build the server ----
FROM rust:1-bookworm AS server
WORKDIR /app/server
COPY server/Cargo.toml server/Cargo.lock ./
# Pre-build dependencies against a stub main for layer caching.
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY server/ ./
# Touch so cargo rebuilds with the real sources.
RUN touch src/main.rs && cargo build --release

# ---- Stage 3: runtime ----
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --user-group app
WORKDIR /app
COPY --from=server /app/server/target/release/sa2025-web /app/sa2025-web
COPY --from=frontend /app/frontend/dist /app/static
# Bundled resources (field-map.json, the template PDF, seed JSON) - required at
# runtime for field data, PDF rendering, and first-run seeding.
COPY server/resources /app/resources
# Data dir (SQLite volume mounts here); owned by the non-root user.
RUN mkdir -p /app/data && chown -R app:app /app
USER app
ENV PORT=8080 \
    STATIC_DIR=/app/static \
    DATA_DIR=/app/data \
    RESOURCES_DIR=/app/resources
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1
CMD ["/app/sa2025-web"]

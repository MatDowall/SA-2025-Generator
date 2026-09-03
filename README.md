# SA-2025 Generator — web edition

Browser-hosted, multi-user app that batch-generates Master Builders Subcontract
Agreements (2025 version). One filled PDF per subcontractor.

> The original Tauri desktop build has been sunset; this web edition is the only
> maintained version. (History for the desktop app remains in the git log.)

- **Server:** Rust + axum (`server/`) — serves the API and the built SPA.
- **Frontend:** React + Vite (`frontend/`).
- **DB:** shared SQLite (WAL) on a mounted volume.
- **Auth:** email + password (session cookie); users are managed in-app by admins.
- **Projects:** private to their creator. TP Companies, staff and settings are
  shared company-wide.
- **Hosting:** plain HTTP in the container; **Nginx Proxy Manager** terminates
  TLS and maps a subdomain to it. Portable to any host via env + volume.

## Run with Docker
```bash
cp .env.example .env      # then edit: set ADMIN_EMAIL/ADMIN_PASSWORD, etc.
docker compose up --build
```
The container serves plain HTTP on `HOST_PORT` (default 8080). First boot creates
the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`; log in and add users in-app
(account menu → Manage users).

### Behind Nginx Proxy Manager (production)
1. Point a subdomain's Proxy Host at the container's `host:HOST_PORT`.
2. Enable SSL (Let's Encrypt) and Force SSL.
3. In `.env`, set **`COOKIE_SECURE=true`** (the public origin is now HTTPS).
4. Deploy elsewhere by copying the repo, providing a `.env`, and mounting a volume
   for `/app/data` — nothing host-specific is baked into the image.

> If you browse the container directly over plain HTTP (bypassing the proxy),
> keep `COOKIE_SECURE=false`, or the session cookie won't be sent and you can't
> log in.

## Local dev (hot reload)
Two terminals:
```bash
# 1) API server
cd server
ADMIN_EMAIL=admin@local ADMIN_PASSWORD=changeme123 cargo run

# 2) SPA with hot reload (proxies /api to the server on :8080)
cd frontend
npm install
npm run dev
```
Open the Vite URL it prints (default `http://localhost:5173`).

## Configuration (environment)
| Var | Default | Purpose |
|-----|---------|---------|
| `HOST_PORT` | 8080 | Host port published by compose |
| `PORT` | 8080 | Port the server listens on (in-container) |
| `STATIC_DIR` | /app/static | Built SPA |
| `DATA_DIR` | /app/data | SQLite dir (mount a volume) |
| `RESOURCES_DIR` | /app/resources | Bundled field-map / template / seeds |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Bootstrap the first admin on first boot |
| `COOKIE_SECURE` | false | `true` when served over HTTPS (behind the proxy) |
| `NZBN_API_KEY` / `NZBN_ENV` | — | MBIE NZBN key for the Companies Register lookup; read from the env only (no Settings entry). `NZBN_ENV` is `sandbox` (default) or `production` |
| `RUST_LOG` | info | Log filter |

## Maintenance
Deleting a user cascades their projects away, and the server sweeps expired
sessions + orphaned rows on every boot. Admins can also run **Manage users →
Clean up database** to purge and `VACUUM` on demand.

## Roadmap (milestone-gated)
- **P0** scaffold ✓
- **P1** pooled SQLite (WAL) + users/sessions ✓
- **P2** RPC endpoints + frontend copy-fork ✓
- **P3** file upload/download ✓
- **P4** email+password auth + Users admin ✓ (+ per-user projects, DB cleanup)
- **P5** hardening + Docker finalize ← _here_
- **P6** Microsoft SSO (planned)

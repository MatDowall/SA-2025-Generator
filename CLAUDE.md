# SA-2025 Generator (web) — developer guide

Browser-hosted, multi-user web app that batch-generates Master Builders
Subcontract Agreements (2025 version). One filled PDF per subcontractor.

> The original Tauri desktop app was sunset and removed from the working tree;
> this web edition is the only maintained version. Its history remains in the git
> log if you need to recover anything.

## Stack
- **Server:** Rust + axum (`server/`) — serves the JSON API and the built SPA.
- **Frontend:** React + TypeScript + Vite (`frontend/`).
- **PDF display:** pdf.js with the interactive form layer (users edit on the PDF).
- **PDF fill/export:** Rust `lopdf`.
- **Persistence:** shared SQLite (WAL) via `rusqlite` on a mounted volume.
- **Auth:** email + password (session cookie); users managed in-app by admins.
- **Hosting:** plain HTTP in the container; Nginx Proxy Manager terminates TLS.

## Single source of truth: the template's AcroForm fields
`server/resources/SA-2025-Template.pdf` defines every field name, parsed into
`server/resources/field-map.json` — the bundled map that drives CSV columns,
dropdown options, and PDF filling. `field-map.json` is committed as a static
resource; if the template changes, regenerate the map (the field-map generator
lived in the removed desktop app — port it back if needed).

- Only **pages 1–10** carry data (154 fields). Pages 11–52 are boilerplate and
  are intentionally NOT filled.
- Field types: `text`, `checkbox`, `radio`, `dropdown`, `signature` (left blank).

## Commands
- `cd server && cargo run` — run the API server (needs `ADMIN_EMAIL`/`ADMIN_PASSWORD` on first boot).
- `cd frontend && npm run dev` — Vite dev server with hot reload (proxies `/api`).
- `cd frontend && npm run build` — typecheck + build the SPA.
- `cd server && cargo check` — typecheck the backend.
- `docker compose up --build` — build + run the full container (see README.md).

## Configuration (environment)
Set via `.env` (copy from `.env.example`; `.env` is gitignored). Key vars:
`ADMIN_EMAIL`/`ADMIN_PASSWORD`, `COOKIE_SECURE`, `DATA_DIR`, `STATIC_DIR`,
`RESOURCES_DIR`, `NZBN_API_KEY`/`NZBN_ENV`. See README.md for the full table.

- **NZBN / Companies Register:** the MBIE API key is read **from the server env
  only** (`NZBN_API_KEY`, `NZBN_ENV`) — there is no Settings-UI entry for it.

## Data model (SQLite)
- `users`, `sessions` — auth.
- `projects` (owner-scoped; private to their creator).
- `subcontractors` (project_id, name, ordering) — one row = one agreement = one PDF.
- `field_values` (subcontractor_id, field_name, value) — keyed by AcroForm field name.
- TP Companies, staff, and settings are shared company-wide.

## PDF export
- Naming: `{project_number}-{project_name}-{subcontractor}.pdf`. Batch export zips.
- Export offers a **flat vs fillable** toggle.

## Workflow rule (IMPORTANT)
**Never auto-verify UI/UX** — ask the user to visually verify layout/rendering.
Backend/build verification (compiles, tests) is fine to do yourself.

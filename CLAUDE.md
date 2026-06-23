# SA-2025 Generator — developer guide

Tauri 2 desktop app that batch-generates Master Builders Subcontract Agreements
(2025 version). One filled PDF per subcontractor.

## Stack
- **Shell:** Tauri 2 (Rust backend), standalone `.exe`.
- **Frontend:** React + TypeScript + Vite (`src/`).
- **Backend:** Rust (`src-tauri/src/`).
- **PDF display:** pdf.js with the interactive form layer (users edit directly on the PDF).
- **PDF fill/export:** Rust `lopdf` (added in Milestone 6).
- **Persistence:** SQLite via `rusqlite` (bundled). DB lives in the app data dir as `sa2025.sqlite`.

## Single source of truth: the template's AcroForm fields
`src-tauri/resources/SA-2025-Template.pdf` defines every field name. The
generator `scripts/generate-field-map.mjs` parses it into
`src-tauri/resources/field-map.json`, which drives CSV columns, dropdown
options, and PDF filling.

- Only **pages 1–10** carry data (154 fields). Pages 11–52 are boilerplate
  (repeated "Initials" + signature fields) and are intentionally NOT filled.
- Field types: `text`, `checkbox`, `radio`, `dropdown` (options
  `Month/Week/Day/-`), `signature` (left blank).
- Regenerate after any template change: `npm run gen:field-map`.

## Commands
- `npm run dev` — Vite dev server only.
- `npm run tauri dev` — run the full desktop app (Rust + webview).
- `npm run build` — typecheck + build frontend.
- `npm run tauri build` — produce the standalone `.exe`.
- `npm run gen:field-map` — regenerate `field-map.json` from the template.
- `cargo check` (in `src-tauri/`) — typecheck the backend.

## Data model (SQLite)
- `projects` (name, project_number, csv_export_selection JSON, timestamps)
- `subcontractors` (project_id, name, ordering) — one row = one agreement = one PDF
- `field_values` (subcontractor_id, field_name, value) — keyed by AcroForm field name

## PDF export
- Naming: `{project_number}-{project_name}-{subcontractor}.pdf`. Batch export zips.
- Export offers a **flat vs fillable** toggle.

## Workflow rule (IMPORTANT)
Build milestones 1–7 in order (see `readme.md`). **Always stop at each milestone
gate and get user approval before starting the next.** **Never auto-verify
UI/UX** — ask the user to visually verify layout/rendering. Backend/build
verification (compiles, tests) is fine to do yourself.

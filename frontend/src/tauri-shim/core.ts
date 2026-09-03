// Browser stand-in for `@tauri-apps/api/core` (aliased in vite.config.ts +
// tsconfig.json). This is the transport swap: the desktop `invoke(cmd, args)`
// IPC call becomes an HTTP call to the axum server, so every copied frontend
// file that imports `invoke` works unchanged.
//
// Most commands map to `POST /api/{cmd}`. A handful need special handling:
//   - binary/text resource reads hit dedicated GET routes,
//   - file exports become browser downloads,
//   - file imports upload the bytes the `open` dialog stashed (see uploads.ts),
//   - desktop-only commands resolve locally.
import { basename, downloadBytes, peekUpload } from "./uploads";

// A 401 from any API call means the session is gone: notify the auth gate (it
// drops back to the login screen) and throw so the caller still fails cleanly.
function fail(status: number, text: string): never {
  if (status === 401) window.dispatchEvent(new Event("sa2025:unauthorized"));
  throw new Error(text || `HTTP ${status}`);
}

/** POST helper for the normal JSON RPC path. */
async function rpc<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const r = await fetch(`/api/${cmd}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  if (!r.ok) fail(r.status, await r.text());
  const text = await r.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  // --- resources (non-JSON payloads on dedicated GET routes) ---
  if (cmd === "get_template_pdf") {
    const r = await fetch("/api/template-pdf", { credentials: "include" });
    if (!r.ok) fail(r.status, await r.text());
    return (await r.arrayBuffer()) as unknown as T;
  }
  if (cmd === "get_field_map") {
    const r = await fetch("/api/field-map", { credentials: "include" });
    if (!r.ok) fail(r.status, await r.text());
    return (await r.text()) as unknown as T;
  }

  // --- desktop-only: launched-with .saproj file (never exists on the web) ---
  if (cmd === "get_launch_file") {
    return null as unknown as T;
  }

  // --- file downloads (the frontend already has, or the server returns, bytes) ---
  if (cmd === "write_binary_file") {
    const { path, contents } = args as { path: string; contents: number[] };
    downloadBytes(basename(path), new Uint8Array(contents));
    return null as unknown as T;
  }
  if (cmd === "export_project_csv") {
    const { projectId, fields, path } = args as {
      projectId: number;
      fields: string[];
      path: string;
    };
    const r = await fetch("/api/export_project_csv", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, fields }),
    });
    if (!r.ok) fail(r.status, await r.text());
    downloadBytes(basename(path), await r.blob());
    // Desktop returned the row count; recover it from the response header.
    return Number(r.headers.get("X-Row-Count") ?? 0) as unknown as T;
  }
  if (cmd === "export_project_file") {
    const { projectId, path } = args as { projectId: number; path: string };
    const r = await fetch("/api/export_project_file", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    if (!r.ok) fail(r.status, await r.text());
    downloadBytes(basename(path), await r.blob());
    return null as unknown as T;
  }

  // --- file uploads (bytes were stashed by the open() dialog shim) ---
  if (
    cmd === "analyze_import_csv" ||
    cmd === "parse_import_csv" ||
    cmd === "import_project_file"
  ) {
    const { path } = args as { path: string };
    const up = peekUpload(path);
    if (!up) throw new Error("The chosen file is no longer available - please pick it again.");
    const r = await fetch(`/api/${cmd}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body: up.bytes,
    });
    if (!r.ok) fail(r.status, await r.text());
    return (await r.json()) as T;
  }

  // --- everything else: plain JSON RPC ---
  return rpc<T>(cmd, args);
}

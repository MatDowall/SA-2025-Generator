import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Web build of the SA-2025 Generator (browser, multi-user). The frontend source
// is copy-forked from the desktop app and kept byte-identical; every Tauri
// import is redirected here to a browser shim under src/tauri-shim (the same
// mapping is mirrored in tsconfig.json "paths" so tsc resolves them too). The
// key one is @tauri-apps/api/core, whose `invoke` becomes an HTTP call.
const shim = (file: string) =>
  fileURLToPath(new URL(`./src/tauri-shim/${file}`, import.meta.url));

// `npm run dev` proxies /api to the local axum server. 127.0.0.1 (not
// "localhost") avoids Windows resolving to IPv6 ::1 while the server binds IPv4.
const apiTarget = process.env.VITE_API_TARGET || "http://127.0.0.1:8080";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@tauri-apps/api/core": shim("core.ts"),
      "@tauri-apps/api/window": shim("window.ts"),
      "@tauri-apps/api/event": shim("event.ts"),
      "@tauri-apps/api/path": shim("path.ts"),
      "@tauri-apps/api/app": shim("app.ts"),
      "@tauri-apps/plugin-dialog": shim("dialog.ts"),
      "@tauri-apps/plugin-opener": shim("opener.ts"),
      "@tauri-apps/plugin-updater": shim("updater.ts"),
      "@tauri-apps/plugin-process": shim("process.ts"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
  },
});

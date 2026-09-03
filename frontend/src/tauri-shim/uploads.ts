// Bridges the desktop's path-based file flow to the browser without touching
// the app code. The native `open` dialog can't return a filesystem path a
// server could read, so instead the file the user picks is read into memory and
// stashed here under a synthetic "upload://" path. The command shim (core.ts)
// recognises that path and uploads the bytes to the server. `save` targets and
// downloads use plain filenames, resolved with basename().
export interface StoredUpload {
  name: string;
  bytes: Uint8Array;
}

const store = new Map<string, StoredUpload>();
let seq = 0;

/** Stash picked bytes; returns a synthetic path to hand back to the app. */
export function stashUpload(name: string, bytes: Uint8Array): string {
  seq += 1;
  const key = `upload://${seq}/${name}`;
  store.set(key, { name, bytes });
  return key;
}

/** Look up stashed bytes without removing them (analyze + parse reuse one). */
export function peekUpload(path: string): StoredUpload | undefined {
  return store.get(path);
}

export function isUploadPath(path: string): boolean {
  return typeof path === "string" && path.startsWith("upload://");
}

/** Final path segment (the filename), tolerating / and \ separators. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Trigger a browser download of the given bytes under `filename`. */
export function downloadBytes(filename: string, bytes: Uint8Array | Blob): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

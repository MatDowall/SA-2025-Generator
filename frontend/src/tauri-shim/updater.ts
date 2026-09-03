// Browser stand-in for `@tauri-apps/plugin-updater`.
//
// The web edition updates by deploying a new image / reloading the page, so
// there is never a self-update to offer: check() resolves to null, which the
// useUpdateChecker hook renders as "up-to-date" (the banner stays hidden).
export type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished"; data?: unknown };

export interface Update {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
  downloadAndInstall(onEvent?: (event: DownloadEvent) => void): Promise<void>;
}

export async function check(): Promise<Update | null> {
  return null;
}

// Browser stand-in for `@tauri-apps/plugin-dialog`.
//
// - open(): shows a real file picker, reads the chosen file into memory, and
//   returns a synthetic "upload://" path (see uploads.ts) that the command shim
//   turns into a server upload. Returns null if the user cancels.
// - save(): the browser can't choose a path ahead of a download, so it just
//   echoes the suggested filename back; the actual save happens when the app
//   calls write_binary_file / export_* (handled in core.ts as a download).
import { stashUpload } from "./uploads";

export interface DialogFilter {
  name: string;
  extensions: string[];
}
export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: DialogFilter[];
}
export interface OpenDialogOptions {
  defaultPath?: string;
  filters?: DialogFilter[];
  multiple?: boolean;
  directory?: boolean;
}

export async function save(options?: SaveDialogOptions): Promise<string | null> {
  // Non-null so the calling flow proceeds to the write/export step, which
  // performs the browser download using this name.
  return options?.defaultPath ?? "download";
}

export async function open(options?: OpenDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (options?.filters?.length) {
      input.accept = options.filters
        .flatMap((f) => f.extensions.map((e) => `.${e}`))
        .join(",");
    }
    // Fires in modern browsers when the picker is dismissed with no selection.
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      resolve(stashUpload(file.name, bytes));
    };
    input.click();
  });
}

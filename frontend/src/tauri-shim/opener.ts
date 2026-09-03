// Browser stand-in for `@tauri-apps/plugin-opener`.
//
// On the desktop, openPath() launched the freshly written .eml in the OS mail
// client. On the web the .eml has already been downloaded (by write_binary_file
// in core.ts), so there's nothing left to open - this is a no-op. The user
// opens the downloaded .eml from their browser's downloads.
export async function openPath(_path: string): Promise<void> {}

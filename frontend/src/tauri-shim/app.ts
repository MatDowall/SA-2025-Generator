// Browser stand-in for `@tauri-apps/api/app`.
// Shown in the About dialog. Kept in step with the product version.
export async function getVersion(): Promise<string> {
  return "0.5.0";
}

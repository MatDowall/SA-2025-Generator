// Browser stand-in for `@tauri-apps/api/path`.
//
// Used only by the email-draft flow to build a temp .eml path. That flow writes
// a file and opens it in the OS mail client - a P3 concern (it becomes an .eml
// download). These provide harmless values so imports resolve; the flow itself
// stops at the download/opener step until P3.
export async function tempDir(): Promise<string> {
  return "/tmp";
}

export async function join(...parts: string[]): Promise<string> {
  return parts.join("/").replace(/\/+/g, "/");
}

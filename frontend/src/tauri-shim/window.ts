// Browser stand-in for `@tauri-apps/api/window`.
//
// The app only uses the current window to flush unsaved edits on close via
// `onCloseRequested`. A browser tab can't reliably intercept its own close, and
// field edits are debounce-saved anyway, so this is a no-op; `destroy` likewise
// has no browser equivalent.
type CloseHandler = (event: { preventDefault(): void }) => void | Promise<void>;

class WebWindow {
  async onCloseRequested(_handler: CloseHandler): Promise<() => void> {
    return () => {};
  }
  async destroy(): Promise<void> {}
}

export function getCurrentWindow(): WebWindow {
  return new WebWindow();
}

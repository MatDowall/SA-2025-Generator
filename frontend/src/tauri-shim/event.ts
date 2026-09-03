// Browser stand-in for `@tauri-apps/api/event`.
//
// The only listened event is "open-project-file", emitted by the desktop
// single-instance plugin when a .saproj is double-clicked. There's no such
// event on the web, so listen() registers nothing and returns a no-op unlisten.
export interface Event<T> {
  payload: T;
}
export type EventCallback<T> = (event: Event<T>) => void;
export type UnlistenFn = () => void;

export async function listen<T = unknown>(
  _event: string,
  _handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return () => {};
}

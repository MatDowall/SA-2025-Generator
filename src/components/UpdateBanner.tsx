import { useEffect, useState } from "react";
import { useUpdateChecker } from "../lib/updater";

/** Checks for an update on mount and offers an install-and-restart prompt. */
export function UpdateBanner() {
  const { update, state, progress, checkForUpdate, installUpdate } = useUpdateChecker();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void checkForUpdate();
  }, [checkForUpdate]);

  if (!update || state === "idle" || state === "checking" || state === "up-to-date" || dismissed) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 10000,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        boxShadow: "var(--shadow)",
        padding: "12px 16px",
        width: 280,
        fontSize: 13,
        color: "var(--text)",
      }}
    >
      {state === "available" && (
        <>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            SA-2025 Generator {update.version} is available
          </div>
          {update.body && (
            <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>{update.body}</div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => setDismissed(true)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
              }}
            >
              Later
            </button>
            <button
              onClick={() => void installUpdate()}
              style={{
                background: "var(--accent)",
                border: "none",
                borderRadius: 5,
                color: "var(--accent-text)",
                padding: "4px 10px",
              }}
            >
              Install &amp; Restart
            </button>
          </div>
        </>
      )}
      {state === "downloading" && <div>Downloading update… {progress}%</div>}
      {state === "ready" && <div>Update ready — restarting…</div>}
      {state === "error" && (
        <div style={{ color: "var(--danger)" }}>Update check failed. Try again later.</div>
      )}
    </div>
  );
}

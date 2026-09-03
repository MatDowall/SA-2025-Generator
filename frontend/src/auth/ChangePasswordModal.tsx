import { useState, type FormEvent } from "react";
import { changePassword } from "./authApi";

const MIN_LEN = 12;

// Self-service password change for the signed-in user. Requires the current
// password; on success the server invalidates the user's other sessions.
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_LEN) {
      setError(`New password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--text)" }}>Change password</h2>
          <button onClick={onClose} style={xButton} aria-label="Close">
            ✕
          </button>
        </div>

        {done ? (
          <div style={{ marginTop: "1rem" }}>
            <p style={{ fontSize: "0.9rem", color: "var(--text)", margin: 0 }}>
              Password changed. You've been signed out of any other devices.
            </p>
            <button onClick={onClose} style={{ ...addButton, marginTop: "1rem" }}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ marginTop: "1rem" }}>
            <label style={labelStyle}>Current password</label>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus required style={field} />

            <label style={labelStyle}>New password</label>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={MIN_LEN} style={field} />

            <label style={labelStyle}>Confirm new password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={MIN_LEN} style={field} />

            <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", margin: "0.25rem 0 0.75rem" }}>
              At least {MIN_LEN} characters. Changing it signs you out of other devices.
            </p>

            {error && <p style={{ color: "var(--danger)", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>{error}</p>}

            <button type="submit" disabled={busy} style={addButton}>
              {busy ? "Changing…" : "Change password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "grid",
  placeItems: "center",
  zIndex: 10000,
};
const panel: React.CSSProperties = {
  width: 380,
  maxWidth: "90vw",
  background: "var(--bg-panel)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "1.5rem",
  boxShadow: "var(--shadow)",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  color: "var(--text-muted)",
  marginBottom: 4,
};
const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "0.5rem 0.6rem",
  marginBottom: "1rem",
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  fontSize: "0.95rem",
  fontFamily: "inherit",
};
const xButton: React.CSSProperties = {
  border: "none",
  background: "none",
  fontSize: "1rem",
  cursor: "pointer",
  color: "var(--text-muted)",
};
const addButton: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "var(--accent)",
  color: "var(--accent-text)",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: "0.9rem",
  fontWeight: 600,
};

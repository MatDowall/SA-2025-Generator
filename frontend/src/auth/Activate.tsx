import { useEffect, useState, type FormEvent } from "react";
import { activate, tokenInfo, type AuthUser } from "./authApi";

const MIN_LEN = 12;

// Self-service password setup reached via an invite link (`/activate#<token>`).
// The token lives in the URL fragment so it never reaches the server logs or a
// Referer header; we read it here and send it explicitly in the API calls.
export function Activate({ onSuccess }: { onSuccess: (user: AuthUser) => void }) {
  const token = decodeURIComponent(window.location.hash.replace(/^#/, "").trim());

  const [status, setStatus] = useState<"checking" | "ready" | "dead">("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStatus("dead");
      return;
    }
    void (async () => {
      try {
        const info = await tokenInfo(token);
        if (!cancelled) {
          setEmail(info.email);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("dead");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LEN) {
      setError(`Password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      onSuccess(await activate(token, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <div
        style={{
          width: 340,
          background: "var(--bg-panel)",
          padding: "2rem",
          borderRadius: 12,
          boxShadow: "var(--shadow)",
          border: "1px solid var(--border)",
        }}
      >
        <h1 style={{ fontSize: "1.3rem", margin: "0 0 0.25rem", color: "var(--text)" }}>
          SA-2025 Generator
        </h1>

        {status === "checking" && (
          <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0", fontSize: "0.9rem" }}>
            Checking your link…
          </p>
        )}

        {status === "dead" && (
          <p style={{ color: "var(--danger)", margin: "0.5rem 0 0", fontSize: "0.9rem" }}>
            This link has expired or has already been used. Ask an admin for a new invite.
          </p>
        )}

        {status === "ready" && (
          <form onSubmit={submit}>
            <p style={{ color: "var(--text-muted)", margin: "0 0 1.5rem", fontSize: "0.9rem" }}>
              Set a password for <strong style={{ color: "var(--text)" }}>{email}</strong>
            </p>

            <label style={labelStyle}>New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
              minLength={MIN_LEN}
              style={inputStyle}
            />

            <label style={labelStyle}>Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={MIN_LEN}
              style={inputStyle}
            />

            <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", margin: "-0.5rem 0 1rem" }}>
              At least {MIN_LEN} characters.
            </p>

            {error && (
              <p style={{ color: "var(--danger)", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} style={buttonStyle}>
              {busy ? "Setting password…" : "Set password & sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  color: "var(--text-muted)",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
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

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem",
  background: "var(--accent)",
  color: "var(--accent-text)",
  border: "none",
  borderRadius: 8,
  fontSize: "0.95rem",
  fontWeight: 600,
  cursor: "pointer",
};

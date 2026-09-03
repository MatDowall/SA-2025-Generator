import { useState, type FormEvent } from "react";
import { login, type AuthUser } from "./authApi";

export function Login({ onSuccess }: { onSuccess: (user: AuthUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSuccess(await login(email.trim(), password));
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
      <form
        onSubmit={submit}
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
        <p style={{ color: "var(--text-muted)", margin: "0 0 1.5rem", fontSize: "0.9rem" }}>
          Sign in to continue
        </p>

        <label style={labelStyle}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
          style={inputStyle}
        />

        <label style={labelStyle}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
        />

        {error && (
          <p style={{ color: "var(--danger)", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} style={buttonStyle}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
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

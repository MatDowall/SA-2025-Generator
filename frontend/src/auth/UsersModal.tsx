import { useEffect, useState, type FormEvent } from "react";
import { cleanupDatabase, createUser, deleteUser, listUsers, type UserRow } from "./authApi";

// Admin-only user management. Kept deliberately simple: list, add, remove.
export function UsersModal({
  currentUserId,
  onClose,
}: {
  currentUserId: number;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setUsers(await listUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createUser({ email: email.trim(), password, displayName: displayName.trim(), role });
      setEmail("");
      setDisplayName("");
      setPassword("");
      setRole("member");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: UserRow) => {
    if (!confirm(`Remove ${u.email}? Their projects will be permanently deleted.`)) return;
    setError(null);
    try {
      await deleteUser(u.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const cleanup = async () => {
    setCleaning(true);
    setError(null);
    setCleanupMsg(null);
    try {
      const r = await cleanupDatabase();
      setCleanupMsg(
        `Removed ${r.orphanProjects} orphaned project(s), ${r.expiredSessions} expired session(s). Storage reclaimed.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--text)" }}>Users</h2>
          <button onClick={onClose} style={xButton} aria-label="Close">
            ✕
          </button>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
              <th style={th}>Email</th>
              <th style={th}>Name</th>
              <th style={th}>Role</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td}>{u.email}</td>
                <td style={td}>{u.displayName}</td>
                <td style={{ ...td, color: "var(--text-muted)" }}>{u.role}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  {u.id !== currentUserId && (
                    <button onClick={() => remove(u)} style={linkDanger}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form onSubmit={add} style={{ marginTop: "1.25rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.9rem", color: "var(--text)" }}>
            Add user
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={field} />
            <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required style={field} />
            <input placeholder="Password (min 8)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={field} />
            <select value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")} style={field}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {error && <p style={{ color: "var(--danger)", fontSize: "0.85rem", margin: "0.75rem 0 0" }}>{error}</p>}
          <button type="submit" disabled={busy} style={addButton}>
            {busy ? "Adding…" : "Add user"}
          </button>
        </form>

        <div style={{ marginTop: "1.25rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.25rem", fontSize: "0.9rem", color: "var(--text)" }}>
            Maintenance
          </div>
          <p style={{ margin: "0 0 0.6rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Purge expired sessions and projects left behind by deleted users, and
            reclaim storage.
          </p>
          <button onClick={cleanup} disabled={cleaning} style={cleanupButton}>
            {cleaning ? "Cleaning…" : "Clean up database"}
          </button>
          {cleanupMsg && (
            <span style={{ marginLeft: "0.75rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
              {cleanupMsg}
            </span>
          )}
        </div>
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
  width: 560,
  maxWidth: "90vw",
  maxHeight: "85vh",
  overflow: "auto",
  background: "var(--bg-panel)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "1.5rem",
  boxShadow: "var(--shadow)",
};
const th: React.CSSProperties = { padding: "0.35rem 0.5rem", fontWeight: 600 };
const td: React.CSSProperties = { padding: "0.4rem 0.5rem", color: "var(--text)" };
const field: React.CSSProperties = {
  padding: "0.45rem 0.55rem",
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  fontSize: "0.9rem",
  fontFamily: "inherit",
};
const xButton: React.CSSProperties = {
  border: "none",
  background: "none",
  fontSize: "1rem",
  cursor: "pointer",
  color: "var(--text-muted)",
};
const linkDanger: React.CSSProperties = {
  border: "none",
  background: "none",
  color: "var(--danger)",
  cursor: "pointer",
  fontSize: "0.85rem",
};
const addButton: React.CSSProperties = {
  marginTop: "0.9rem",
  padding: "0.5rem 1rem",
  background: "var(--accent)",
  color: "var(--accent-text)",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: "0.9rem",
  fontWeight: 600,
};
const cleanupButton: React.CSSProperties = {
  padding: "0.45rem 0.9rem",
  background: "var(--bg-hover)",
  color: "var(--text)",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: "0.85rem",
};

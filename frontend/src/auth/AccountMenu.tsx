import { useState } from "react";
import { logout, type AuthUser } from "./authApi";
import { UsersModal } from "./UsersModal";

// A small floating account control overlaid on the (unchanged) app, top-right.
// Shows who's signed in, opens the Users admin (admins only), and logs out.
export function AccountMenu({ user, onLoggedOut }: { user: AuthUser; onLoggedOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [showUsers, setShowUsers] = useState(false);

  const doLogout = async () => {
    await logout();
    onLoggedOut();
  };

  return (
    <>
      <div style={wrap}>
        <button onClick={() => setOpen((v) => !v)} style={pill} title={user.email}>
          <span style={dot}>{(user.displayName || user.email)[0]?.toUpperCase()}</span>
          <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user.displayName || user.email}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>▾</span>
        </button>
        {open && (
          <div style={menu} onMouseLeave={() => setOpen(false)}>
            <div style={{ padding: "0.4rem 0.75rem", color: "var(--text-muted)", fontSize: "0.75rem" }}>
              {user.email} · {user.role}
            </div>
            {user.role === "admin" && (
              <button
                style={item}
                onClick={() => {
                  setShowUsers(true);
                  setOpen(false);
                }}
              >
                Manage users
              </button>
            )}
            <button style={item} onClick={doLogout}>
              Log out
            </button>
          </div>
        )}
      </div>
      {showUsers && <UsersModal currentUserId={user.id} onClose={() => setShowUsers(false)} />}
    </>
  );
}

const wrap: React.CSSProperties = {
  position: "fixed",
  top: 8,
  right: 10,
  zIndex: 9000,
};
const pill: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "var(--bg-panel)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "3px 10px 3px 3px",
  cursor: "pointer",
  fontSize: "0.82rem",
  boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
};
const dot: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: "50%",
  background: "var(--accent)",
  color: "var(--accent-text)",
  display: "grid",
  placeItems: "center",
  fontSize: "0.75rem",
  fontWeight: 700,
};
const menu: React.CSSProperties = {
  position: "absolute",
  top: 36,
  right: 0,
  minWidth: 180,
  background: "var(--bg-panel)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "var(--shadow)",
  padding: "0.25rem",
  display: "flex",
  flexDirection: "column",
};
const item: React.CSSProperties = {
  textAlign: "left",
  background: "none",
  border: "none",
  color: "var(--text)",
  padding: "0.5rem 0.75rem",
  cursor: "pointer",
  fontSize: "0.85rem",
  borderRadius: 6,
};

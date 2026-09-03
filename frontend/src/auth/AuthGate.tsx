import { useCallback, useEffect, useState, type ReactNode } from "react";
import { fetchMe, type AuthUser } from "./authApi";
import { Login } from "./Login";
import { AccountMenu } from "./AccountMenu";

// Wraps the (unchanged) app: gates it behind sign-in, and overlays the account
// control. The app's own API calls only start once we render its children, i.e.
// once authenticated. A 401 from any API call anywhere dispatches the
// "sa2025:unauthorized" window event (see tauri-shim/core.ts), which drops the
// user back to the login screen.
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "in" | "out">("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = useCallback(async () => {
    try {
      const u = await fetchMe();
      if (u) {
        setUser(u);
        setStatus("in");
      } else {
        setUser(null);
        setStatus("out");
      }
    } catch {
      setUser(null);
      setStatus("out");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setStatus("out");
    };
    window.addEventListener("sa2025:unauthorized", onUnauthorized);
    return () => window.removeEventListener("sa2025:unauthorized", onUnauthorized);
  }, []);

  if (status === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "#6b7280",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Loading…
      </div>
    );
  }

  if (status === "out" || !user) {
    return (
      <Login
        onSuccess={(u) => {
          setUser(u);
          setStatus("in");
        }}
      />
    );
  }

  return (
    <>
      <AccountMenu
        user={user}
        onLoggedOut={() => {
          setUser(null);
          setStatus("out");
        }}
      />
      {children}
    </>
  );
}

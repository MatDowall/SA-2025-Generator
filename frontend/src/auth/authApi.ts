// Auth + user-management calls. These talk to the public /api/auth/* routes and
// the admin-only user endpoints directly (they're not part of the desktop `api`
// surface, so they live here rather than in the copy-forked api.ts).
export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "member";
}

export interface UserRow extends AuthUser {
  createdAt: string;
}

async function readJson<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
  const text = await r.text();
  return (text ? JSON.parse(text) : null) as T;
}

const jsonPost = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

/** Current user, or null if not signed in. */
export async function fetchMe(): Promise<AuthUser | null> {
  const r = await fetch("/api/auth/me", { credentials: "include" });
  if (r.status === 401) return null;
  return readJson<AuthUser>(r);
}

export async function login(email: string, password: string): Promise<AuthUser> {
  return readJson<AuthUser>(await jsonPost("/api/auth/login", { email, password }));
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}

export async function listUsers(): Promise<UserRow[]> {
  return readJson<UserRow[]>(await jsonPost("/api/list_users", {}));
}

export async function createUser(input: {
  email: string;
  password: string;
  displayName: string;
  role: "admin" | "member";
}): Promise<UserRow> {
  return readJson<UserRow>(await jsonPost("/api/create_user", input));
}

export async function deleteUser(id: number): Promise<void> {
  await readJson<null>(await jsonPost("/api/delete_user", { id }));
}

export interface CleanupReport {
  expiredSessions: number;
  orphanProjects: number;
  orphanLastProjectKeys: number;
}

/** Admin-only: purge expired sessions + orphaned rows and reclaim file space. */
export async function cleanupDatabase(): Promise<CleanupReport> {
  return readJson<CleanupReport>(await jsonPost("/api/cleanup_database", {}));
}

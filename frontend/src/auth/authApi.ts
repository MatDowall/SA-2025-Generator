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

/** Validate an invite token and get the email it's for (throws if dead). */
export async function tokenInfo(token: string): Promise<{ email: string }> {
  return readJson<{ email: string }>(await jsonPost("/api/auth/token_info", { token }));
}

/** Consume an invite token: set the password and get signed in (cookie set). */
export async function activate(token: string, password: string): Promise<AuthUser> {
  return readJson<AuthUser>(await jsonPost("/api/auth/activate", { token, password }));
}

/** Rotate the signed-in user's own password. Other sessions are invalidated. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await readJson<null>(await jsonPost("/api/change_password", { currentPassword, newPassword }));
}

export async function listUsers(): Promise<UserRow[]> {
  return readJson<UserRow[]>(await jsonPost("/api/list_users", {}));
}

/** The created account plus the one-time invite token (returned once). */
export interface CreatedUser {
  user: UserRow;
  inviteToken: string;
  expiresHours: number;
}

export async function createUser(input: {
  email: string;
  displayName: string;
  role: "admin" | "member";
}): Promise<CreatedUser> {
  return readJson<CreatedUser>(await jsonPost("/api/create_user", input));
}

export async function deleteUser(id: number): Promise<void> {
  await readJson<null>(await jsonPost("/api/delete_user", { id }));
}

export interface AuthEvent {
  id: number;
  createdAt: string;
  event: string;
  targetEmail: string | null;
  actorEmail: string | null;
  detail: string | null;
}

/** Admin-only: recent account-security events (invite/reset/activate/…), newest first. */
export async function listAuthEvents(): Promise<AuthEvent[]> {
  return readJson<AuthEvent[]>(await jsonPost("/api/list_auth_events", {}));
}

/** Admin-only: mint a one-time password-reset link for an existing user. */
export async function createResetLink(
  id: number,
): Promise<{ token: string; expiresHours: number; email: string }> {
  return readJson<{ token: string; expiresHours: number; email: string }>(
    await jsonPost("/api/create_reset_link", { id }),
  );
}

export interface CleanupReport {
  expiredSessions: number;
  orphanProjects: number;
  orphanLastProjectKeys: number;
  spentTokens: number;
}

/** Admin-only: purge expired sessions + orphaned rows and reclaim file space. */
export async function cleanupDatabase(): Promise<CleanupReport> {
  return readJson<CleanupReport>(await jsonPost("/api/cleanup_database", {}));
}

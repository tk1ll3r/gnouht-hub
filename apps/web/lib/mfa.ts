import "server-only";
import { createAdminClient } from "./supabase/admin";
import type { ServerClient } from "./supabase/server";

/**
 * The database's verdict on this session, from the same function its restrictive RLS policies use:
 * `ended` once the session was revoked (sign out, sign out everywhere), `mfa` while a user with a
 * verified TOTP factor has not finished the code step through the hub, otherwise `ok`.
 */
export type SessionState = "ok" | "mfa" | "ended";

export async function sessionState(supabase: ServerClient): Promise<SessionState> {
  const { data, error } = await supabase.rpc("session_status");
  if (error) throw new Error(`session check failed (${error.code})`);
  return data === "ok" || data === "mfa" ? data : "ended";
}

/**
 * Called right after the hub's own rate-limited form verified a TOTP code. Supabase Auth itself does not
 * limit guesses per account, so the database only counts aal2 sessions the hub marked here.
 */
export async function markTwoStepSession(supabase: ServerClient, userId: string): Promise<boolean> {
  const { data } = await supabase.auth.getClaims();
  const sessionId = data?.claims?.session_id;
  if (typeof sessionId !== "string") return false;
  const { data: marked, error } = await createAdminClient().rpc("mark_mfa_session", { p_user: userId, p_session: sessionId });
  return !error && marked === true;
}

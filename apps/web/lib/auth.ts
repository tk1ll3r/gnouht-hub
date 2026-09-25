import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sessionState, type SessionState } from "./mfa";
import { createClient, type ServerClient } from "./supabase/server";

export interface SessionUser {
  id: string;
  email: string | null;
}

/** Verified user for this request (JWT signature checked), or null. Cached per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, email: typeof data.claims.email === "string" ? data.claims.email : null };
});

/** The signed-in user plus the database's verdict on the session (live, and two-step done when enrolled). */
export const getSession = cache(async (): Promise<{ user: SessionUser; supabase: ServerClient; state: SessionState } | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  return { user, supabase, state: await sessionState(supabase) };
});

/**
 * Every page, Server Action and route handler that touches user data calls this itself — the proxy's
 * redirect is a convenience, not the security boundary.
 */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Revoked sessions are cleared; enrolled users finish the TOTP step before any page or action runs
  // (RLS enforces both again in the database).
  if (session.state === "ended") redirect("/auth/ended");
  if (session.state === "mfa") redirect("/login/mfa");
  return { user: session.user, supabase: session.supabase };
}

/** Route handlers: the user when the session is fully accepted, otherwise the JSON error to return. */
export async function requireApiUser(): Promise<{ user: SessionUser; supabase: ServerClient } | { error: Response }> {
  const session = await getSession();
  if (!session || session.state === "ended") return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.state === "mfa") return { error: Response.json({ error: "two-step sign-in required" }, { status: 403 }) };
  return { user: session.user, supabase: session.supabase };
}

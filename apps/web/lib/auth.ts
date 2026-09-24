import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";

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

/**
 * Every page, Server Action and route handler that touches user data calls this itself — the proxy's
 * redirect is a convenience, not the security boundary.
 */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  return { user, supabase };
}

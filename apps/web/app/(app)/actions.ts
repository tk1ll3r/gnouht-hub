"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Server Action (not a plain POST route) so Next.js' Origin check blocks cross-site logout CSRF. */
export async function signOut(): Promise<void> {
  const user = await getSessionUser();
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  if (user) await audit(user.id, "auth.sign_out", "user", user.id);
  redirect("/login");
}

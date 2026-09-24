import "server-only";
import type { Database } from "@hub/core/db";
import { createClient } from "@supabase/supabase-js";
import { env } from "../env";

/**
 * Service-role client: bypasses RLS. Only for trusted server paths (cron sync, agent ingestion,
 * writes to server-only tables) — never pass its results to the browser without scoping by user.
 */
export function createAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY } = env();
  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;

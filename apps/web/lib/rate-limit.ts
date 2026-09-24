import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "./supabase/admin";

/**
 * Fixed-window limiter backed by `public.hit_rate_limit` (shared across serverless instances).
 * Returns true when the call is allowed. Fails open only if the database itself errors.
 */
export async function allow(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("hit_rate_limit", { p_bucket: bucket.slice(0, 200), p_limit: limit, p_window_seconds: windowSeconds });
  if (error) {
    console.error("rate limiter unavailable", error.code);
    return true;
  }
  return data !== false;
}

/** Client IP as reported by the platform (first X-Forwarded-For hop), for per-IP buckets. */
export async function clientIp(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded && /^[0-9a-f:.]{2,45}$/i.test(forwarded) ? forwarded : "unknown";
}

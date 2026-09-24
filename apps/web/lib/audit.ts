import "server-only";
import type { Json } from "@hub/core/db";
import { headers } from "next/headers";
import { createAdminClient } from "./supabase/admin";

/** First hop of X-Forwarded-For as set by the platform (Vercel) — informational only. */
async function clientIp(): Promise<string | null> {
  try {
    const forwarded = (await headers()).get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim();
    return ip && /^[0-9a-f:.]+$/i.test(ip) ? ip : null;
  } catch {
    return null;
  }
}

/** Appends a security-relevant event. Best effort: auditing must never break the user action. */
export async function audit(actorId: string | null, action: string, entity?: string, entityId?: string, meta: Json = {}): Promise<void> {
  try {
    await createAdminClient()
      .from("audit_log")
      .insert({ actor_id: actorId, action, entity: entity ?? null, entity_id: entityId ?? null, meta, ip: await clientIp() });
  } catch (err) {
    console.error("audit log write failed", err instanceof Error ? err.message : err);
  }
}

import "server-only";
import { SIGNATURE_HEADERS, verifySignature } from "@hub/core/protocol";
import type { z } from "zod";
import { decryptSecret } from "./crypto";
import { createAdminClient, type AdminClient } from "./supabase/admin";

const MAX_BODY_BYTES = 512 * 1024;

export interface AgentContext {
  admin: AdminClient;
  device: { id: string; userId: string; name: string };
}

export function deviceAad(deviceId: string): string {
  return `device:${deviceId}`;
}

function reject(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/**
 * Authenticates a signed agent request and parses its JSON body with `schema`.
 * Order: size cap → device lookup → HMAC + timestamp → nonce uniqueness (replay) → rate limit → schema.
 */
export async function authenticateAgent<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ ok: true; ctx: AgentContext; body: z.infer<T> } | { ok: false; response: Response }> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return { ok: false, response: reject(413, "payload too large") };
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return { ok: false, response: reject(413, "payload too large") };

  const deviceId = request.headers.get(SIGNATURE_HEADERS.device) ?? "";
  if (!/^[0-9a-f-]{36}$/.test(deviceId)) return { ok: false, response: reject(401, "unauthorized") };

  const admin = createAdminClient();
  const { data: device } = await admin.from("devices").select("id, user_id, name, secret_ciphertext").eq("id", deviceId).maybeSingle();
  // Same response for unknown devices and bad signatures: no device enumeration.
  if (!device) return { ok: false, response: reject(401, "unauthorized") };

  let secret: string;
  try {
    secret = decryptSecret(device.secret_ciphertext, deviceAad(device.id));
  } catch {
    return { ok: false, response: reject(401, "unauthorized") };
  }

  const url = new URL(request.url);
  const nonce = request.headers.get(SIGNATURE_HEADERS.nonce);
  const failure = verifySignature(secret, {
    method: request.method,
    path: url.pathname + url.search,
    body: raw,
    timestamp: request.headers.get(SIGNATURE_HEADERS.timestamp),
    nonce,
    signature: request.headers.get(SIGNATURE_HEADERS.signature),
  });
  if (failure) return { ok: false, response: reject(401, failure === "stale" ? "clock skew too large" : "unauthorized") };

  // Replay protection: a nonce is accepted once per device (the timestamp window bounds storage).
  const { error: replay } = await admin.from("agent_nonces").insert({ device_id: device.id, nonce: nonce! });
  if (replay) return { ok: false, response: reject(401, "replayed request") };

  const { data: allowed } = await admin.rpc("hit_rate_limit", { p_bucket: `agent:${device.id}`, p_limit: 120, p_window_seconds: 60 });
  if (allowed === false) return { ok: false, response: reject(429, "rate limited") };

  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, response: reject(400, "invalid json") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, response: Response.json({ error: "invalid payload", issues: parsed.error.issues.slice(0, 5) }, { status: 400 }) };

  await admin.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);
  return { ok: true, ctx: { admin, device: { id: device.id, userId: device.user_id, name: device.name } }, body: parsed.data };
}

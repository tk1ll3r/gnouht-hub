import { pairRequestSchema } from "@hub/core/protocol";
import { randomBytes, randomUUID } from "node:crypto";
import { audit } from "@/lib/audit";
import { deviceAad } from "@/lib/agent-auth";
import { encryptSecret, sha256Hex } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_DEVICES = 5;

/**
 * Exchanges a one-time pairing code (shown in Settings, valid 10 minutes) for a device id + HMAC secret.
 * The secret is returned exactly once; the server keeps only an encrypted copy.
 */
export async function POST(request: Request) {
  const admin = createAdminClient();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const [{ data: perIp }, { data: global }] = await Promise.all([
    admin.rpc("hit_rate_limit", { p_bucket: `pair:${ip}`, p_limit: 10, p_window_seconds: 600 }),
    admin.rpc("hit_rate_limit", { p_bucket: "pair:all", p_limit: 60, p_window_seconds: 600 }),
  ]);
  if (perIp === false || global === false) return Response.json({ error: "too many attempts" }, { status: 429 });

  const parsed = pairRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid request" }, { status: 400 });

  // Claim the code atomically so two agents racing with the same code cannot both succeed.
  const { data: claimed } = await admin
    .from("device_pairing_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code_hash", sha256Hex(parsed.data.code))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("user_id")
    .maybeSingle();
  if (!claimed) return Response.json({ error: "invalid or expired code" }, { status: 401 });

  const { count } = await admin.from("devices").select("id", { count: "exact", head: true }).eq("user_id", claimed.user_id);
  if ((count ?? 0) >= MAX_DEVICES) return Response.json({ error: "device limit reached — revoke an old device first" }, { status: 409 });

  const deviceId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const { error } = await admin.from("devices").insert({
    id: deviceId,
    user_id: claimed.user_id,
    name: parsed.data.name,
    platform: parsed.data.platform,
    agent_version: parsed.data.agentVersion,
    secret_ciphertext: encryptSecret(secret, deviceAad(deviceId)),
  });
  if (error) return Response.json({ error: "could not register device" }, { status: 500 });

  await audit(claimed.user_id, "device.pair", "device", deviceId, { name: parsed.data.name, platform: parsed.data.platform });
  return Response.json({ deviceId, secret });
}

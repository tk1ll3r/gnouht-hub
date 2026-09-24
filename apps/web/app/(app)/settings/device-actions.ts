"use server";

import { randomInt } from "node:crypto";
import { refresh } from "next/cache";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { sha256Hex } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "@/lib/utils";
import { uuid } from "@/lib/validation";

// No 0/O/1/I so codes survive being read aloud or retyped.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function createPairingCode(): Promise<ActionState> {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("hit_rate_limit", { p_bucket: `paircode:${user.id}`, p_limit: 5, p_window_seconds: 600 });
  if (allowed === false) return { message: "Too many codes requested. Wait a few minutes." };

  const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const { error } = await admin.from("device_pairing_codes").insert({
    code_hash: sha256Hex(code),
    user_id: user.id,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) return { message: "Could not create a pairing code." };
  await audit(user.id, "device.pairing_code", "user", user.id);
  return { ok: true, message: code };
}

export async function revokeDevice(formData: FormData): Promise<void> {
  const { user, supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const { data } = await supabase.from("devices").delete().eq("id", id.data).select("id");
  if (data?.length) await audit(user.id, "device.revoke", "device", id.data);
  refresh();
}

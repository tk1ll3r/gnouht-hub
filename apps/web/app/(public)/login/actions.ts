"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { allow, clientIp } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/utils";

const emailSchema = z.object({
  email: z.email("Enter a valid email address").max(254).transform((v) => v.toLowerCase()),
  next: z.string().max(512).optional(),
});

export async function sendMagicLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email"), next: formData.get("next") ?? undefined });
  if (!parsed.success) return { errors: { email: [parsed.error.issues[0]?.message ?? "Invalid email"] } };

  const next = safeNextPath(parsed.data.next);
  // Per IP and per address (hashed, so the limiter table holds no emails). Same reply as success when
  // limited per address, so the limit itself does not reveal which addresses were tried.
  if (!(await allow(`magic-ip:${await clientIp()}`, 10, 600))) return { message: "Too many sign-in attempts. Wait a few minutes and try again." };
  if (!(await allow(`magic-email:${sha256Hex(parsed.data.email)}`, 4, 600))) {
    return { ok: true, message: "If this address is invited, a sign-in link is on its way. Check your inbox." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: true, emailRedirectTo: `${env().APP_URL}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (error?.status === 429) {
    return { message: "Too many sign-in attempts. Wait a few minutes and try again." };
  }
  if (error && error.status !== 403 && error.status !== 422) {
    console.error("magic link failed", error.status, error.code);
  }
  // Identical answer for allowed and unknown addresses, so this form cannot be used to enumerate members.
  return { ok: true, message: "If this address is invited, a sign-in link is on its way. Check your inbox." };
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${env().APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
      scopes: "openid email profile",
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

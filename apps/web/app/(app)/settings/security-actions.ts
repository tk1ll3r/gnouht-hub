"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { markTwoStepSession } from "@/lib/mfa";
import { decryptSecret } from "@/lib/crypto";
import { revokeToken } from "@/lib/google";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretAad } from "@/lib/sync";
import { allow } from "@/lib/rate-limit";
import type { ActionState } from "@/lib/utils";

export interface EnrollState extends ActionState {
  factorId?: string;
  qr?: string;
  secret?: string;
}

/** Step 1: a fresh, unverified TOTP factor with its QR code. Leftover unverified factors are removed first. */
export async function startMfaEnrollment(): Promise<EnrollState> {
  const { user, supabase } = await requireUser();
  if (!(await allow(`mfa-enroll:${user.id}`, 10, 3600))) return { message: "Too many attempts. Try again in an hour." };
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { message: "Could not start the setup. Try again." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

const confirmSchema = z.object({ factor_id: z.uuid(), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") });

/** Step 2: the first code proves the app is set up; the factor becomes verified and the session aal2. */
export async function confirmMfaEnrollment(prev: EnrollState, formData: FormData): Promise<EnrollState> {
  const { user, supabase } = await requireUser();
  const parsed = confirmSchema.safeParse({ factor_id: formData.get("factor_id"), code: formData.get("code") });
  if (!parsed.success) return { ...prev, errors: { code: [parsed.error.issues[0]?.message ?? "Invalid code"] } };
  if (!(await allow(`mfa:${user.id}`, 8, 600))) return { ...prev, message: "Too many attempts. Wait 10 minutes." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: parsed.data.factor_id, code: parsed.data.code });
  if (error) return { ...prev, errors: { code: ["That code is not right. Use the current code from the app."] } };
  // This session proved the code through the hub, so it stays signed in; other sessions need the code.
  await markTwoStepSession(supabase, user.id);
  await audit(user.id, "mfa.enable", "user", user.id);
  refresh();
  return { ok: true, message: "Two-step sign-in is on." };
}

export async function removeMfaFactor(formData: FormData): Promise<void> {
  const { user, supabase } = await requireUser();
  const id = z.uuid().safeParse(formData.get("factor_id"));
  if (!id.success) return;
  // Supabase only lets an aal2 session remove a verified factor, and requireUser guarantees aal2 here.
  const { error } = await supabase.auth.mfa.unenroll({ factorId: id.data });
  if (!error) await audit(user.id, "mfa.disable", "user", user.id);
  refresh();
}

/** Revokes every session of this account (all browsers and devices), including this one. */
export async function signOutEverywhere(): Promise<void> {
  const { user, supabase } = await requireUser();
  await audit(user.id, "auth.sign_out_all", "user", user.id);
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}

/**
 * Deletes the account and everything it owns (rows cascade from auth.users). Groups it owns pass to
 * another member first; Google grants are revoked at Google. Requires typing the account's email.
 */
export async function deleteAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const typed = String(formData.get("confirm_email") ?? "").trim().toLowerCase();
  if (!user.email || typed !== user.email.toLowerCase()) return { errors: { confirm_email: ["Type your email exactly to confirm."] } };
  if (!(await allow(`delete-account:${user.id}`, 3, 3600))) return { message: "Too many attempts. Try again later." };

  const admin = createAdminClient();
  const { data: googleSources } = await admin.from("calendar_sources").select("id").eq("user_id", user.id).eq("kind", "google");
  for (const source of googleSources ?? []) {
    const { data: secret } = await admin.from("integration_secrets").select("ciphertext").eq("source_id", source.id).maybeSingle();
    if (!secret) continue;
    try {
      await revokeToken(decryptSecret(secret.ciphertext, secretAad(source.id)));
    } catch {
      // Undecryptable or already revoked: the row is deleted below either way.
    }
  }
  const { error: prepError } = await admin.rpc("prepare_account_deletion", { p_user: user.id });
  if (prepError) return { message: "Could not prepare the deletion. Nothing was deleted." };
  await audit(user.id, "account.delete", "user", user.id);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { message: "Could not delete the account. Nothing was deleted." };
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect("/login?deleted=1");
}

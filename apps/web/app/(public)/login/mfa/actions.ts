"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { markTwoStepSession } from "@/lib/mfa";
import { allow } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/safe-redirect";
import type { ActionState } from "@/lib/utils";

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"), next: z.string().max(512).optional() });

/**
 * Second step of sign-in: verifies a TOTP code against the user's verified factor, which upgrades the
 * session to aal2, then marks the session so the database accepts it (see markTwoStepSession).
 */
export async function verifyMfaCode(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.state === "ended") redirect("/auth/ended");
  const { user, supabase } = session;
  const parsed = codeSchema.safeParse({ code: formData.get("code"), next: formData.get("next") ?? undefined });
  if (!parsed.success) return { errors: { code: [parsed.error.issues[0]?.message ?? "Invalid code"] } };
  // Six digits are guessable without a limit: at most 8 tries per 10 minutes per account.
  if (!(await allow(`mfa:${user.id}`, 8, 600))) return { message: "Too many attempts. Wait 10 minutes, then try again." };

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp.find((f) => f.status === "verified");
  if (!factor) redirect(safeNextPath(parsed.data.next));
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data.code });
  if (error) {
    await audit(user.id, "auth.mfa_failed", "user", user.id);
    return { errors: { code: ["That code is not right. Check the time on your phone and try the current code."] } };
  }
  if (!(await markTwoStepSession(supabase, user.id))) return { message: "The code was right, but the session could not be confirmed. Try again." };
  await audit(user.id, "auth.mfa_verify", "user", user.id);
  redirect(safeNextPath(parsed.data.next));
}

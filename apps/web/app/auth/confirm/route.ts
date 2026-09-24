import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup", "invite", "email_change"]);

/**
 * Magic links from the custom email template point here with a `token_hash`. Unlike the PKCE code
 * flow this works when the link is opened on another device (e.g. requested on laptop, opened on phone).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const base = env().APP_URL;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const next = safeNextPath(params.get("next"));

  if (tokenHash && type && OTP_TYPES.has(type)) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && data.user) {
      await audit(data.user.id, "auth.sign_in", "user", data.user.id, { method: "magic_link" });
      return NextResponse.redirect(new URL(next, base), { status: 303 });
    }
  }
  return NextResponse.redirect(new URL("/login?error=link", base), { status: 303 });
}

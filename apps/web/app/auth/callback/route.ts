import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/** OAuth (Google) and same-browser magic links land here with a PKCE `code`. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"));
  const base = env().APP_URL;

  const code = params.get("code");
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await audit(data.user.id, "auth.sign_in", "user", data.user.id, { method: data.user.app_metadata.provider ?? "email" });
      return NextResponse.redirect(new URL(next, base), { status: 303 });
    }
  }

  // Auth errors (e.g. the before-user-created hook rejecting an uninvited address) arrive as query params.
  const description = params.get("error_description") ?? "";
  const reason = /invite-only/i.test(description) ? "invite" : params.get("error") === "access_denied" ? "denied" : "link";
  return NextResponse.redirect(new URL(`/login?error=${reason}`, base), { status: 303 });
}

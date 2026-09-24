import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { env, googleConfigured } from "@/lib/env";
import { buildAuthUrl, OAUTH_COOKIE, type GoogleAccess } from "@/lib/google";

/** Starts the Google Calendar consent flow (separate from sign-in, so calendar access stays opt-in). */
export async function GET(request: NextRequest) {
  const base = env().APP_URL;
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/settings", base), { status: 303 });
  if (session.state !== "ok") return NextResponse.redirect(new URL(session.state === "mfa" ? "/login/mfa?next=/settings" : "/auth/ended", base), { status: 303 });
  const { user } = session;
  if (!googleConfigured()) return NextResponse.redirect(new URL("/settings?error=not_configured#calendars", base), { status: 303 });

  const access: GoogleAccess = request.nextUrl.searchParams.get("access") === "freeBusy" ? "freeBusy" : "calendarRead";
  const { url, state, verifier } = buildAuthUrl(access, user.email);

  const response = NextResponse.redirect(url, { status: 303 });
  // State + PKCE verifier live in a short-lived, encrypted, httpOnly cookie bound to this user.
  response.cookies.set(OAUTH_COOKIE, encryptSecret(JSON.stringify({ state, verifier, access, uid: user.id }), "google-oauth"), {
    httpOnly: true,
    secure: base.startsWith("https://"),
    sameSite: "lax",
    path: "/api/integrations/google",
    maxAge: 600,
  });
  return response;
}

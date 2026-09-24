import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { env, googleConfigured } from "@/lib/env";
import { buildAuthUrl, OAUTH_COOKIE, type GoogleAccess } from "@/lib/google";

/** Starts the Google Calendar consent flow (separate from sign-in, so calendar access stays opt-in). */
export async function GET(request: NextRequest) {
  const base = env().APP_URL;
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/settings", base), { status: 303 });
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

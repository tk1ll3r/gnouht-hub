import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { sessionState } from "@/lib/mfa";
import { createClient } from "@/lib/supabase/server";

/**
 * Where requireUser sends a browser whose session was revoked elsewhere: clears the stale session
 * cookies, then shows the sign-in page. It only clears sessions the database already treats as ended,
 * so a cross-site GET here cannot sign anyone out.
 */
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login?ended=1", env().APP_URL), { status: 303 });
  response.headers.set("cache-control", "private, no-store");
  const supabase = await createClient();
  if ((await sessionState(supabase).catch(() => "ok")) !== "ended") return response;
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-")) response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
  }
  return response;
}

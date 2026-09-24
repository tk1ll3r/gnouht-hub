import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "./lib/csp";

/** Paths reachable without a session. Everything else redirects to /login. */
const PUBLIC_PREFIXES = ["/login", "/auth/", "/invite/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV === "development", supabaseOrigin: new URL(supabaseUrl).origin });

  // Upstream request headers carry the nonce (Next.js applies it to its own scripts) and the refreshed cookies.
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", csp);
    return NextResponse.next({ request: { headers } });
  };

  let response = forward();
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, cacheHeaders) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = forward();
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(cacheHeaders)) response.headers.set(key, value);
      },
    },
  });

  // Refreshes an expiring session and verifies the JWT. Must run before any redirect decision.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  const redirectTo = (path: string) => {
    const target = NextResponse.redirect(new URL(path, request.url));
    for (const cookie of response.cookies.getAll()) target.cookies.set(cookie);
    target.headers.set("cache-control", "private, no-store");
    return target;
  };

  if (pathname === "/") return redirectTo(signedIn ? "/today" : "/login");
  if (!signedIn && !isPublic(pathname)) {
    return redirectTo(`/login?next=${encodeURIComponent(pathname + search)}`);
  }
  if (signedIn && pathname === "/login") return redirectTo("/today");

  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // API routes authenticate themselves (session, cron secret or agent signature).
      source: "/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

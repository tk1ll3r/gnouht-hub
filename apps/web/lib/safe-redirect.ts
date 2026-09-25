const BASE = "http://internal.invalid";

/**
 * Returns a same-origin path for post-login redirects, or `fallback` for anything that could leave the
 * site (absolute URLs, `//host`, `/\host`, control characters the URL parser strips, other schemes).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/today"): string {
  if (!next || next.length > 512 || !next.startsWith("/")) return fallback;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  // Re-check the normalised path: the parser collapses tabs/newlines that could turn "/\t/evil" into "//evil".
  if (url.pathname.startsWith("//") || url.pathname.includes("\\")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Post-login destination for an emailed link. The email template passes Supabase's `redirect_to` (the
 * `emailRedirectTo` the login form sent: `<APP_URL>/auth/callback?next=…`); its `next` wins over the
 * template's static `next` only when that URL is on our own origin.
 */
export function nextFromEmailLink(params: URLSearchParams, appUrl: string): string {
  const redirectTo = params.get("redirect_to");
  if (redirectTo) {
    try {
      const url = new URL(redirectTo);
      const inner = url.searchParams.get("next");
      if (url.origin === new URL(appUrl).origin && inner) return safeNextPath(inner);
    } catch {
      // Not a URL: ignore it and use the plain `next`.
    }
  }
  return safeNextPath(params.get("next"));
}

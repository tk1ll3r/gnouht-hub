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

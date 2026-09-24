export interface CspOptions {
  nonce: string;
  dev: boolean;
  /** Supabase origin — the target of OAuth form redirects. */
  supabaseOrigin?: string;
}

/**
 * Strict nonce-based policy: no inline script or style without the per-request nonce, no framing,
 * and the browser only talks to this origin (all Supabase calls happen server-side).
 */
export function buildCsp({ nonce, dev, supabaseOrigin }: CspOptions): string {
  const formTargets = ["'self'", supabaseOrigin, "https://accounts.google.com"].filter(Boolean).join(" ");
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action ${formTargets}`,
    "frame-ancestors 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
  ];
  if (!dev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

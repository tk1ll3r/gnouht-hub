import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// CSP is set per request (with a nonce) in proxy.ts; these are the static hardening headers.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@hub/core"],
  serverExternalPackages: ["node-ical"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Files served without the proxy (which sets the per-request CSP) get a strict static policy.
      {
        source: "/:file(robots\\.txt|icon\\.svg|favicon\\.ico|manifest\\.webmanifest)",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }],
      },
      // Authenticated pages and API responses must never be cached by a shared cache.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;

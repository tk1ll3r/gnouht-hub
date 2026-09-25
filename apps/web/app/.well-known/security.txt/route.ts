import { env } from "@/lib/env";

/** RFC 9116 contact file for vulnerability reports. */
export function GET() {
  const expires = new Date(Date.now() + 180 * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);
  const body = [
    "Contact: mailto:security@gnouht.space",
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: vi, en",
    `Canonical: ${env().APP_URL}/.well-known/security.txt`,
    "Policy: Please report privately and give a reasonable time to fix before disclosure. Do not access other users' data.",
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" } });
}

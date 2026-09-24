# Threat model (v0, milestone M1)

## Assets

Google refresh tokens; secret iCal URLs (Moodle export URLs embed a personal token); users' tasks,
timetable and calendar events; project documents (M3); 9router credentials and quota (M2, which stay on the
owner's PC); friends' data (M4).

## Trust boundaries

1. Browser ↔ Next.js on Vercel (the only thing the browser talks to; `connect-src 'self'`)
2. Next.js ↔ Supabase (user-scoped client under RLS; service role only in trusted server paths)
3. Next.js ↔ Google / arbitrary iCal hosts (outbound, user-influenced URLs)
4. pg_cron ↔ Next.js cron endpoints
5. Local agent ↔ cloud, and agent ↔ 9router (M2)

## STRIDE and current controls

| Threat | Example | Control | Verified by |
|---|---|---|---|
| Spoofing | Stranger signs up | `before_user_created` hook with an allow-list | pgTAP `020`, smoke test |
| Spoofing | Forged cron call | Bearer `CRON_SECRET` compared in constant time; the secret lives in Vault | smoke test |
| Spoofing | OAuth CSRF / code injection | State + PKCE held in an encrypted, httpOnly, user-bound cookie | code review |
| Tampering | Linking your task to someone else's course | Composite FKs `(parent_id, user_id)` | pgTAP `010` |
| Tampering | Rewriting server-owned columns | Column-level GRANTs (source, sync state, ids) | pgTAP `010` |
| Tampering | Swapping ciphertext between rows | AES-256-GCM with AAD `calendar:<id>` | Vitest `crypto` |
| Repudiation | "I never connected that" | `audit_log`, append-only from trusted code | pgTAP `010` |
| Info disclosure | IDOR on `/courses/[id]` | RLS returns nothing, so the page is a 404 | smoke test |
| Info disclosure | Reading secrets through the API | `integration_secrets` has RLS on and no policies | pgTAP `010` |
| Info disclosure | Account enumeration via login | Same message whether or not the email is invited | code review |
| Info disclosure | SSRF through an iCal URL | https-only, default port, IP-literal checks, DNS answers checked at connect time, manual redirects, size/time caps | Vitest `ssrf` |
| DoS | Huge or slow feed | 2 MB cap, 15 s timeout, 5000-event cap, per-user source limit, sync throttling | code review |
| Elevation | XSS | Strict nonce CSP, no inline styles, react-markdown without raw HTML, escaped email HTML | smoke test, Vitest `email` |
| Elevation | Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY` | smoke test |
| Elevation | Open redirect after login | `safeNextPath`, redirects built from `APP_URL` | Vitest, smoke test |

## Open items (later milestones)

Agent HMAC authentication and replay protection (M2); project-scoped RLS and invites (M4); AI prompt
injection and budget races (M5); rate limiting, MFA enforcement, ZAP scan and a manual pentest (M6).

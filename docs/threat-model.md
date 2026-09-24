# Threat model (v1, milestones M1–M6)

## Assets

Google refresh tokens; secret iCal URLs (Moodle export URLs embed a personal token); users' tasks,
timetable and calendar events; project documents (M3); 9router credentials and quota (M2, which stay on the
owner's PC); friends' data (M4); AI prompts and answers (M5).

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
| Spoofing | Forged agent request | HMAC-SHA256 over method, path, timestamp, nonce and body hash; secret stored encrypted (AAD `device:<id>`) | agent e2e |
| Spoofing | Replayed agent request | ±5 min timestamp window + per-device nonce table | agent e2e |
| Elevation | Agent writing into another user's project | Project looked up by the device owner's id; composite FKs on every child row | pgTAP `040` |
| Info disclosure | Hub (or an attacker controlling it) steering the agent to read other files | The agent reads only paths from its own listing of the watched folder; symlinks/junctions are never followed; the hub's `need` list is intersected with that listing | Vitest agent `documents` |
| Info disclosure | Credentials pasted into notes get uploaded | Secret-looking file names and dot files are never listed; regex redaction (keys, tokens, JWTs, private keys, URL passwords, `password=`) on the PC and again on ingest | Vitest `redact`, agent e2e |
| Info disclosure | Watching an over-broad folder | `project add` refuses drive roots and the home folder and previews what will be indexed; PDFs/slides are opt-in | Vitest agent `documents` |
| Tampering | Path traversal through a document path | Paths are labels only (never opened on the server), validated by zod and a DB check | Vitest `documents`, pgTAP `040` |
| Info disclosure | Search returning other users' passages | `search_documents` is SECURITY INVOKER, so RLS applies | pgTAP `040` |
| Tampering | tsquery syntax injection through the search box | The query is rebuilt from folded alphanumeric words only | pgTAP `040`, Vitest `search` |
| Elevation | Stored XSS from document Markdown | react-markdown with raw HTML skipped, only http(s) links (`noopener noreferrer nofollow`), no images | smoke test |
| Spoofing | Registering through someone else's invite | Invites are bound to one email; the sign-up hook admits only pending invites for that exact address, and `accept_group_invite` checks the signed-in email | pgTAP `050`, smoke test |
| Info disclosure | A forwarded or leaked invite link | The token (24 random bytes) is stored hashed and only identifies the invite; accepting also needs the invited address; links expire (≤14 days), are single-use and revocable; the landing page masks the address and is rate limited | pgTAP `050`, smoke test |
| Info disclosure | Group members reading each other's private data | Reads widen only for projects explicitly shared (`shared_project_ids()`); tasks, calendars and profiles stay owner-only; the roster RPC returns display names only | pgTAP `050`, smoke test |
| Info disclosure | Free-time finder leaking schedules | Opt-in per member; computed server-side after a membership check and rate limited; only per-hour counts leave the function, never titles or times of commitments | Vitest `availability`, smoke test |
| Tampering | Members editing shared projects or sharing others' projects | Update/delete policies stay owner-only; the share insert policy requires owning the project and belonging to the group | pgTAP `050` |
| DoS / lockout | A group losing its last owner | Trigger blocks removing the last owner while the group exists; limits of 20 groups per user, 30 members and 50 pending invites per group | pgTAP `050` |
| Elevation | Open redirect through email links | `redirect_to` is honoured only on our own origin and its `next` still passes `safeNextPath` | Vitest `safe-redirect` |
| Elevation | Prompt injection from a document (possibly a teammate's shared file) | Untrusted text is fenced with a random per-job marker (look-alikes stripped) under a system prompt that says data carries no instructions; the model has no tools; the agent never acts on output | Vitest `prompts` |
| Info disclosure | Exfiltration through model output (image beacons, lure links) | Answers render without raw HTML or images, and no URL is clickable except `[n]` citations to documents the job actually retrieved; CSP `img-src 'self'` as a backstop | smoke test |
| Tampering | Users writing arbitrary prompts to the queue | `enqueue_ai_job` is service-role only; prompts are built server-side from reads under the user's RLS | pgTAP `060` |
| DoS / cost | Budget races and runaway usage | Per-user advisory lock around the budget check and reservation; daily token limit (reservation until actual usage arrives); at most 3 waiting jobs; 20 requests / 10 min per user | pgTAP `060` |
| Spoofing / tampering | A rogue device answering someone else's job | Claims only return the device owner's jobs (SKIP LOCKED); only the claiming device may complete, once; output length-capped and stripped of control characters | pgTAP `060`, agent e2e |
| Info disclosure | Stored excerpts outliving their use | Prompts are wiped when a job finishes, expires or is cancelled; jobs are deleted after 30 days; AI is off until the user consents (audited) | pgTAP `060` |
| DoS | Huge folders or documents | 1000 files per folder, 30 folders, 4 MB text / 30 MB binary files, 120k characters and 400 chunks per document, 512 KB request bodies, capped `.pptx` decompression | Vitest, code review |
| Spoofing | Stolen magic link or inbox access | Optional TOTP second factor; once enrolled, the database refuses first-factor sessions on every table and callable function (restrictive RLS), and the proxy, `requireUser` and API routes send them to the code step | pgTAP `070`, smoke test |
| Spoofing | Guessing TOTP codes straight against Supabase Auth, which has no per-account limit | Only sessions marked by the hub after its rate-limited form (8 tries / 10 min) count as two-step; an aal2 session obtained directly from Auth reads nothing | pgTAP `070`, smoke test, `docs/pentest.md` F1 |
| Spoofing | A stolen or forgotten session after "sign out everywhere" | The JWT's session must still exist in `auth.sessions`; revoked sessions lose access at once, not when the token expires | pgTAP `070`, smoke test, `docs/pentest.md` F2 |
| DoS / brute force | Scripted sign-in, search, AI or write floods | Database-backed fixed-window limits per user (and per IP and hashed address for sign-in); see `docs/pentest.md` | smoke test, code review |
| Info disclosure | Account data on request / right to erasure | Export returns only the caller's own rows under RLS (no secrets); deletion needs the typed address, revokes Google grants, hands owned groups to a member, then cascades | smoke test, pgTAP `070` |
| Elevation | Regressions in headers or CSRF protection | ZAP baseline in CI with triaged rules; Server Actions keep Next.js' Origin check | CI `e2e`, `docs/pentest.md` |

## Residual risks

- TOTP is optional. Accounts without it rest on the security of the email inbox.
- The per-IP sign-in limit relies on the platform setting `X-Forwarded-For` (Vercel does). The per-address
  limit applies regardless.
- The rate limiter fails open if its database call errors (see `docs/pentest.md` F4).
- Supabase Auth ends a user's other aal1 sessions whenever a TOTP code is verified. This is expected, but
  it can look like a sign-out on another device.

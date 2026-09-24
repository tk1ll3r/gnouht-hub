# gnouht hub

A personal student operations hub at **hub.gnouht.space**. It covers the current semester's courses and
timetable, deadlines ranked by how hard they are to meet given the free time in your calendar, project
progress parsed from Markdown checklists, AI quota from 9router, and study groups.

It also serves as a security portfolio piece: row-level security with pgTAP tests, a strict nonce-based CSP,
encrypted integration secrets, an SSRF-safe fetcher, closed registration and an audit log.

## Layout

| Path | What |
|---|---|
| `packages/core` | Pure logic: time zones, free-time intervals, UIT timetable, urgency ranking (EDF), checklist and milestone parsers, document analysis, search folding, secret redaction, briefs |
| `apps/web` | Next.js 16 app (App Router, Server Actions, `proxy.ts`) |
| `apps/agent` | Local Windows agent: project folders, 9router quota, UIT sync (AI jobs in M5) |
| `supabase` | Migrations, pgTAP tests, email templates, local config |
| `docs` | Architecture, threat model, runbook |

## Local development

Requires Node 22+, and the Supabase CLI + Docker inside WSL (see `docs/runbook.md`).

```bash
npm install
npm run db:start            # Supabase in WSL Docker
node scripts/dev-env.mjs    # writes apps/web/.env.local (never printed)
npm run dev                 # http://localhost:3000 — sign in as owner@example.com, email at http://127.0.0.1:54324
```

## Study groups

Create a group at `/groups` and invite classmates by email. An invite is the only way besides the owner's
allow-list to register, and it works only for the address it was sent to. Members see projects you choose to
share (read-only) and their deadlines; if they opt in, the group page shows when everyone is free, built from
classes and busy calendar events — counts only, never what anyone is doing.

## Local agent (Windows)

```bash
npm run build -w @hub/agent
node apps/agent/dist/hub-agent.mjs pair --hub https://hub.gnouht.space   # code from Settings → Devices
node apps/agent/dist/hub-agent.mjs login-9router                          # password → Credential Manager
node apps/agent/dist/hub-agent.mjs login-uit                              # UIT password used once, only the Moodle token is kept
node apps/agent/dist/hub-agent.mjs project add "D:\Research\IDS"         # watch a project folder (Markdown + Word by default)
node apps/agent/dist/hub-agent.mjs install-startup                        # run at logon (Startup folder, no admin)
```

Watched folders become projects: checklist progress (`[x]`, `[~]`, `[!]`, `[CẮT]`), milestone tables with a
“Hạn”/“Deadline” column and items like `- [ ] Nộp báo cáo 📅 2026-10-05` turn into ranked deadlines, and the
text is searchable at `/docs` without typing accents. Only files matching the folder's globs are read, secrets are
redacted on the PC, and the hub can never ask the agent for a file outside its own listing.

The agent only makes outbound HTTPS requests signed with HMAC-SHA256 (timestamp + one-time nonce), so
9router and your files are never exposed to the internet.

## Checks

```bash
npm test                    # Vitest: core + web + agent
npm run db:test             # pgTAP: RLS matrix, signup hook, projects and search, groups and sharing
npm run typecheck && npm run lint
node apps/web/test/smoke.mjs   # end-to-end against the running dev server
node apps/agent/test/e2e.mjs   # agent pairing, signed requests, quota and document sync (after the smoke test)
```

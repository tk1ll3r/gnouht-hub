# gnouht hub

A personal student operations hub at **hub.gnouht.space**. It covers the current semester's courses and
timetable, deadlines ranked by how hard they are to meet given the free time in your calendar, project
progress parsed from Markdown checklists, AI quota from 9router, and study groups.

It also serves as a security portfolio piece: row-level security with pgTAP tests, a strict nonce-based CSP,
encrypted integration secrets, an SSRF-safe fetcher, closed registration and an audit log.

## Layout

| Path | What |
|---|---|
| `packages/core` | Pure logic: time zones, free-time intervals, UIT timetable, urgency ranking (EDF), checklist and milestone parsers, briefs |
| `apps/web` | Next.js 16 app (App Router, Server Actions, `proxy.ts`) |
| `apps/agent` | Local Windows agent (documents, 9router quota, AI jobs, UIT sync) — milestone M2+ |
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

## Checks

```bash
npm test                    # Vitest: core + web + agent
npm run db:test             # pgTAP: RLS matrix, signup hook
npm run typecheck && npm run lint
node apps/web/test/smoke.mjs   # end-to-end against the running dev server
```

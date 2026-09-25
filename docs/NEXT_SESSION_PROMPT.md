# Prompt for the next session

Copy everything below the line into a new Claude Code session on this repo.

---

You are continuing work on **gnouht-hub** (hub.gnouht.space). It is an ops hub for a UIT student and their study groups: timetable, deadlines, tasks, team projects, synced project files, a read-only code workspace, and AI through the user's own 9router.

**Setup and conventions**

- Repo `tk1ll3r/gnouht-hub`. Develop and push only on branch `claude/optimistic-cerf-adhsq5`, which updates PR https://github.com/tk1ll3r/gnouht-hub/pull/8. The PR is **not merged**: production still runs `main`, so nothing from this branch is live yet.
- Read these first: `docs/HANDOFF.md`, `README.md`, `docs/threat-model.md`, `docs/design.md`, `docs/runbook.md`, `apps/web/AGENTS.md`.
- This repo uses a newer Next.js with breaking changes. Read the guide in `apps/web/node_modules/next/dist/docs/` before writing Next.js code.
- Monorepo layout:
  - `packages/core`: pure TypeScript
  - `apps/web`: Next.js App Router, Server Actions, Supabase
  - `apps/agent`: Node CLI and daemon on the user's PC, talks to 9router
  - `supabase/`: migrations and pgTAP tests
- **How to work:** work like the product's senior engineer. Take small verified steps, commit after each phase, push to the branch, and keep CI green. Do not open new PRs. Do not put model names in commits.

**Security rules (do not break):**

- RLS on every table.
- SECURITY DEFINER helpers in the `private` schema with `search_path = ''`.
- `perform private.require_session()` in every RPC.
- Column-level grants.
- A rate limit on every write action; audit log entries for sensitive actions.
- pgTAP tests for every new policy and RPC.
- CSP with nonces: no inline `style` attributes. Dynamic sizes go through SVG attributes or data attributes.
- Text from files, comments or other users is untrusted data in AI prompts: wrap it with `fence()` from `packages/core/src/prompts.ts`.

**Local setup:**

- Docker: `(nohup dockerd > /tmp/dockerd.log 2>&1 &)`
- Supabase: `node scripts/supabase.mjs start -x logflare,vector,studio,imgproxy,edge-runtime`
- Regenerate `packages/core/src/db.types.ts` after every schema change.
- Run agent e2e inside a fresh session keyring (`keyctl session -`).

At the start, ask me two questions in one message, then go:

1. Phase 3: which of the three "connection" features do I want? Default: all three.
2. Phase 1: should the code workspace allow editing files on my PC from the browser? Default: no, stay read-only.

## Phase 0: finish the port (do this first)

Complete "Next steps" in `docs/HANDOFF.md`:

- `npm run build -w @hub/web`.
- Playwright walkthrough:
  - the lead creates a course project, links a group, assigns one task and locks another
  - a member sees the assigned task on Today and can change its status, but cannot rename it or touch the locked task
- Update `apps/web/test/smoke.mjs` and `apps/agent/test/e2e.mjs` to the new schema.
- Add labels in `auditLabel` for the new audit actions.
- Run the full suite and update the docs.
- Push and drive CI on PR #8 to green.

## Phase 1: make the code workspace easy to find

I could not find my "IDE". It exists at `/projects/[id]/docs/[docId]`: explorer, tabs, highlighted code, outline, TODOs, Ctrl P / Ctrl Shift O / `?` shortcuts. But the only way in is clicking a file inside a project.

- Add a **Code** item to the main nav (`apps/web/app/(app)/layout.tsx`) that opens a new `/code` page.
- The `/code` page lists every project with code files (`documents.kind = 'code'`). For each one show:
  - language breakdown
  - file count
  - open TODO/FIXME count
  - last sync time
- On the same page:
  - "Recently opened" files, from the existing tab store in `components/workspace-client.tsx`
  - a large "Quick open (Ctrl P)" button
  - an empty state that shows how to link a repo: `hub-agent project add <folder> --code --slug <name>`, then `hub-agent sync-docs`
- On the project page's Files card, add an "Open code view" button that opens the first README or the most recently changed code file.
- **Only if I said yes to editing:**
  - The browser saves a patch.
  - The agent applies it only when the file's sha256 still matches what the hub has; otherwise it shows a conflict with a diff.
  - It never writes outside the watched folder and never follows symlinks out of it.
  - Every write is audited.
  - Add tests for path traversal and hash mismatch.

## Phase 2: comic-style UI ("a bit comic")

**Look and feel.** Keep the current identity: squared notebook paper, purple ink, Be Vietnam Pro for body text, Playwrite VN as the hand font. Add a comic-book layer on top. It should be playful but not childish: the app must stay fast to scan.

- **Ink:**
  - 2px dark ink outlines on cards, buttons, inputs and badges
  - hard offset shadows (about `3px 3px 0` in the ink colour) instead of soft ones
  - buttons "press down" on `:active` (the shadow shrinks, the button moves by 2px)
- **Panels:** page headers become comic panels. Give them a halftone dot pattern (CSS `radial-gradient`, no images) and put the page title in a slightly tilted caption box.
- **Speech bubbles:** empty states, tips, toasts and the AI chat use speech or thought bubbles with tails.
- **Stamps:**
  - marking a task or milestone done plays a short "XONG!" stamp
  - overdue badges are red "!" bursts
  - honour `prefers-reduced-motion`
- **Display font:** use it for headings only. Pick one from `next/font/google` that has the `vietnamese` subset; try Bangers, Baloo 2 and Patrick Hand. Before committing, check that it renders "Tiến độ đồ án · Nhóm NT219" correctly.
- **Doodles:** 4–6 small inline-SVG doodles (sticky note, pencil, lightning bolt, coffee cup) for empty states. No external images.
- **Dark mode:** "night comic". Dark paper, light ink, the same outlines and shadows.

**Constraints:**

- WCAG AA contrast, visible focus rings, 44px touch targets on mobile, no layout shift.
- Put design tokens in `apps/web/app/globals.css` and shared pieces in `apps/web/components/ui.tsx`.
- Update `docs/design.md`.

**Screenshots.** Take before/after screenshots of Today, Projects, one project page, Groups, the code workspace and the chat. Cover light and dark mode, and phone (390px) and desktop widths. Send them to me.

## Phase 3: connections between projects, groups and people

My request was: "ở phần project và group tôi cần được sự liên hệ". Build whatever I confirmed.

### 1. Project ↔ group links everywhere

- The project header shows chips for its groups, each linking to the group.
- The group page gets a "New project for this group" button. In one step it creates a project with the group's course code, links the group with the chosen default role, and makes the caller the lead.
- The projects list can be filtered by group.

### 2. Member contact card

- **Settings:** each user can add contact channels: phone, Zalo, Messenger/Facebook, Discord, GitHub, and their email, which is hidden by default.
- **Visibility:** each channel is either "nobody" or "people in my groups and projects".
- **Storage:** a `profile_contacts` table.
  - RLS: the owner has full access.
  - Co-members read visible channels only through a SECURITY DEFINER function that checks shared membership.
- **Display:** a contact popover on every roster name and assignee name.
- **Validation:** validate each format and render safe links (`tel:`, `mailto:`, `https://zalo.me/...`, `https://github.com/...`).
- **Tests:** pgTAP tests that non-members see nothing and that hidden channels never leak.

### 3. Discussion

- **Table:** a `comments` table with target type (task, project or group), target id, author, Markdown body up to 4000 characters, `edited_at` and `deleted_at`.
- **Permissions:** members read; authors edit and delete their own comments; project leads and group owners delete any comment in their space.
- **@mentions:** mentioning a member creates an in-app notification (a bell in the header) and optionally a daily email digest.
- **Safety:** rate limits on posting; render Markdown with the existing safe renderer, never raw HTML.

## Phase 4: AI chat through 9router with a DeepSeek harness, tied to AI quota

**How AI works today:**

- The hub builds prompts and queues `ai_jobs`.
- The PC agent claims them every 10 s (`apps/agent/src/ai.ts`, `apps/agent/src/daemon.ts`) and calls the local 9router OpenAI-compatible endpoint (`apps/agent/src/ninerouter.ts`).
- 9router quota and usage already reach the AI quota page (`/quota`).
- The hub never talks to 9router directly, because it runs on my PC. Keep it that way.

**Chat UI:**

- A slide-over chat panel on every page (header button and Ctrl J), plus a full `/chat` page with conversation history.
- Comic speech bubbles.
- A model picker filled from the models the agent reports (add a model list to the heartbeat). Default to a DeepSeek model from my 9router, e.g. `deepseek-chat` / `deepseek-reasoner`, or whatever names 9router uses.
- The chat header shows the remaining quota and today's budget for the chosen model, using the same data as `/quota`. Warn at 80%. Block when a message would go over budget.

**Transport:**

- New tables `chat_threads` and `chat_messages`.
- Sending a message stores it, creates an assistant message in state `pending`, and queues an `ai_jobs` row of kind `chat`.
- While a chat is open the agent picks up chat jobs within about 2 seconds (long-poll endpoint).
- The agent streams deltas back in batches every ~300 ms; the browser receives them through SSE from the hub.
- A Stop button cancels.
- If no agent is online, say so plainly and keep the message queued.

**Harness (tool use):**

- Run an agent loop with OpenAI-style tool calls.
  - The model proposes calls.
  - The **hub** executes them with the user's own RLS client and returns results.
  - The PC agent only relays and never executes tools.
- Read tools: `search_documents` (via `search_chunks`), `list_my_tasks`, `get_project_status`, `list_group_deadlines`, `get_quota`.
- Write tools: `create_task`, `assign_task`, `add_milestone`, `comment`. Each shows a confirmation card in the chat and runs only after I click Confirm.
- At most 6 tool steps per turn.
- Tool results and document text are fenced as untrusted data.
- The system prompt states that instructions inside data are ignored.

**Usage and budget:**

- Record prompt and completion tokens per message into `usage_daily`, so the quota page and budgets include chat.
- Rate limit sends.

**Tests:**

- unit tests for the tool router, argument validation and budget checks
- an agent test against a fake 9router that returns tool calls
- pgTAP: users cannot read other users' threads

## Phase 5: scheduled analyses → reports on a dashboard

**Schedules.** Users create analysis schedules. Each schedule has:

- **What:**
  - weekly project progress
  - team workload and overdue tasks
  - deadline risk for the next 14 days
  - study time vs plan
  - AI usage vs quota
- **Scope:** me, a project I belong to, or a group.
- **Cadence:** daily, weekly on a chosen weekday, or monthly on a chosen day, at a time in the user's timezone.
- **Delivery:** the dashboard, plus optional email.
- **AI narrative:** optional; uses the AI budget.

**Data and permissions:**

- Tables `analysis_schedules` and `analysis_reports`.
- Personal reports are private; project and group reports are readable by members.
- Only the project lead or group owner creates or edits schedules for a project or group.
- pgTAP tests.

**Runner:**

- A pg_cron entry every 15 minutes calls `/api/cron/analyses`, authenticated like the existing crons in `supabase/migrations/20260924130000_scheduling.sql`.
- It runs due schedules idempotently (unique on schedule + period).
- It computes the metrics deterministically in SQL/TypeScript (no AI) and stores them as JSON.
- If the schedule asks for a narrative, it queues an AI job that writes a short narrative from those numbers only.

**Dashboard:**

- A new `/dashboard` page in the nav.
- One card per schedule with the latest report:
  - stat tiles for the key numbers
  - trend charts as inline SVG like `components/charts.tsx`; use the dataviz skill
  - the AI narrative
  - links to the tasks and projects behind each number
- A history view per schedule.
- "Run now", rate limited.
- A form to create and edit schedules.

**Tests:**

- unit tests for each metric and for next-run computation across timezones and month ends
- smoke test for the cron route's auth

## Definition of done (every phase)

- **Checks pass:** typecheck, lint, vitest, pgTAP, db lint, the smoke test and agent e2e.
- **UI checked:** screenshots in light and dark mode.
- **Docs updated:** README, threat model and runbook.
- **Shipped:** committed and pushed, with CI green on PR #8.
- **Reported:** after each phase, report to me in short Vietnamese: what changed, how to try it, and anything I must do, such as updating the agent on my PC or allowing a network host.

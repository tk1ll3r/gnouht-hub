# Handoff: team projects on main's M3 model

Branch `claude/optimistic-cerf-adhsq5`, PR https://github.com/tk1ll3r/gnouht-hub/pull/8.

## Where things stand

M3 to M7 were rebuilt on main's M3 data model (merge commit 160fc5b). That model has:

- projects with `owner_id`, slug, kind and roles
- `project_members` with roles owner/editor/viewer
- milestones
- `tasks.assignee_id`
- device-owned `documents` with visibility private/project
- an `activity` feed

Production was never migrated, so no repair migration is needed.

Done and checked (typecheck, lint, core unit tests pass):

- **Database** (`supabase/migrations/2026092*`), all pgTAP passing when last run:
  - `20260926200000_project_sync.sql`: folder sync onto `documents`, chunk search (`search_chunks`), checklist items, `ingest_document`, and `set_document_sharing` (each member chooses whether to share their files).
  - `20260927100000_groups.sql`:
    - groups with `course_code`
    - `project_groups`: linking a group makes all its members project members; leaving unassigns their tasks
    - per-task permission `tasks.permission`: team / assignee / owner (locked)
    - `guard_task_permissions` trigger: an assignee who is only a viewer may change status, progress, notes and estimate only
    - assignment activity log
    - roster and role RPCs
  - Tests: `045_team_tasks.test.sql` (permission matrix), `050_groups.test.sql`, `080_project_sync.test.sql`.
- **Core and agent:** the new protocol (manifest → need → documents) and `splitText` / `describeChunks`. The CLI now takes `hub-agent project add <folder> [--slug s | --project <id>]`.
- **Web:**
  - Project page: task board with All/Mine filter, assign and permission pickers, milestones, roster and roles, group linking, file sharing, activity.
  - Code workspace reads `documents` plus its chunks; editors can turn a TODO into a task.
  - Docs search and AI ask use `search_chunks`; the AI project summary now lists who holds which open task.
  - Today and Tasks include tasks assigned to you, marked "assigned to you". A locked task shows "Locked by the lead". Today also has a project milestones card.
  - Groups: course code, linked projects, a "Coming up" list (milestones and tasks with assignees), and a per-member workload bar.
  - Projects list: your role, how many tasks are yours, and the linking groups.
  - Command palette and data export are ported.

## Next steps, in order

1. `npm run build -w @hub/web`, then click through with Playwright:
   - lead creates a project, links a group, assigns a task and locks another
   - a member sees it on Today, can change status, cannot rename
2. Update the end-to-end scripts to the new schema:
   - `apps/web/test/smoke.mjs`: projects `owner_id` and slug, `documents`, `search_chunks`, team tasks and permissions
   - `apps/agent/test/e2e.mjs`: the `--slug` flag and the new routes. Run it in a fresh session keyring (`keyctl session -`).
3. Add labels in `auditLabel` (`apps/web/lib/format.ts`) for:
   - project.link_group, project.unlink_group
   - project.set_role, project.add_member, project.remove_member
   - project.share_files, project.hide_files
4. Rerun everything:
   - `npm run typecheck`, `npm run lint`, vitest
   - `node scripts/supabase.mjs test db`, db lint
   - smoke, agent e2e, ZAP
5. Docs: update the README, the threat model (roles, per-task permissions, file sharing, teammate names in AI prompts) and the runbook.
6. Push and drive PR #8's CI to green.

Still open, waiting on the user:

- The design pass modelled on ktxcomay.com.vn: the site is blocked by the network policy; needs screenshots or an allowlist change.
- Editing PC files from the browser: not decided.

## Local setup reminders

- Docker down: `(nohup dockerd > /tmp/dockerd.log 2>&1 &)`
- Start Supabase: `node scripts/supabase.mjs start -x logflare,vector,studio,imgproxy,edge-runtime`
- Regenerate DB types after schema changes (`packages/core/src/db.types.ts`).

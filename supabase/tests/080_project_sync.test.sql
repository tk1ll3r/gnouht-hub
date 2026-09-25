-- Synced files: ingest_document stores a file with its chunks, checklist, outline and TODOs; visibility follows
-- the member's sharing choice; milestones come only from shared files; search finds identifier parts, can be
-- narrowed by kind and follows visibility; totals and progress count shared files.
begin;
select plan(20);

select tests.create_user('81000000-0000-0000-0000-000000000081', 'linh@example.com');   -- owner
select tests.create_user('82000000-0000-0000-0000-000000000082', 'quan@example.com');   -- team member
select tests.create_user('83000000-0000-0000-0000-000000000083', 'tam@example.com');    -- outsider
select tests.authenticate_as('81000000-0000-0000-0000-000000000081');
insert into public.projects (id, slug, name, kind) values ('81100000-0000-0000-0000-000000000001', 'hub', 'Hub', 'research');
reset role;
insert into public.project_members (project_id, user_id, role) values ('81100000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000082', 'viewer');
insert into public.devices (id, user_id, name, secret_ciphertext) values ('81200000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000081', 'PC', 'v1.x');

create temporary table fixture on commit drop as select
  '{"path": "src/checklist.ts", "title": "checklist.ts", "ext": "ts", "kind": "code", "language": "typescript", "sizeBytes": 90,
    "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", "modifiedAt": "2026-09-25T08:00:00Z",
    "excerpt": "export function parseChecklist", "lineCount": 4,
    "outline": [{"name": "parseChecklist", "kind": "function", "line": 1, "depth": 0}],
    "todos": [{"tag": "TODO", "text": "support nested lists", "line": 2}]}'::jsonb as code,
  '[{"idx": 0, "content": "export function parseChecklist(text: string) {\n  // TODO: support nested lists\n", "line": 1, "heading": "parseChecklist", "terms": "parse checklist"}]'::jsonb as code_chunks,
  '{"path": "notes/plan.md", "title": "Plan", "ext": "md", "kind": "markdown", "language": "markdown", "sizeBytes": 60,
    "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", "modifiedAt": "2026-09-25T08:00:00Z",
    "excerpt": "Plan", "lineCount": 4, "checklist": {"total": 2, "done": 1, "doing": 0, "attention": 0, "cut": 0}}'::jsonb as plan,
  '[{"key": "0123456789abcdef", "text": "Write the parser", "status": "done", "section": "Plan", "line": 2},
    {"key": "fedcba9876543210", "text": "Nộp báo cáo", "status": "todo", "section": "Plan", "line": 3}]'::jsonb as items,
  '[{"key": "aaaaaaaaaaaaaaaa", "title": "Nộp báo cáo", "dueDate": "2026-10-05", "startDate": null, "hard": true, "done": false, "line": 3, "origin": "checklist"}]'::jsonb as milestones;

-- ── private by default ──
select lives_ok($$select public.ingest_document('81200000-0000-0000-0000-000000000001', '81100000-0000-0000-0000-000000000001', repeat('9', 64),
  (select code from fixture), (select code_chunks from fixture), '[]', '[]')$$, 'the server stores a source file');
select lives_ok($$select public.ingest_document('81200000-0000-0000-0000-000000000001', '81100000-0000-0000-0000-000000000001', repeat('9', 64),
  (select plan from fixture), '[{"idx": 0, "content": "# Plan\n- [x] Write the checklist parser\n- [ ] Nộp báo cáo 📅 2026-10-05\n", "line": 1}]',
  (select items from fixture), (select milestones from fixture))$$, 'and a note with a checklist and a dated item');
select is((select row(kind, language, line_count, visibility, todos -> 0 ->> 'text')::text from public.documents where path = 'src/checklist.ts'),
  '(code,typescript,4,private,"support nested lists")', 'kind, language, line count and TODOs are stored; files start private');
select is((select count(*)::int from public.milestones), 0, 'private files create no milestones');
select is((select items_total from public.projects where id = '81100000-0000-0000-0000-000000000001'), 0, 'private files do not count towards team totals');
select throws_ok($$update public.documents set outline = '{"not": "a list"}' where path = 'src/checklist.ts'$$, '23514', null, 'the outline must be a list');

-- ── the owner shares her files; the agent re-sends them ──
select tests.authenticate_as('81000000-0000-0000-0000-000000000081');
select is(public.set_document_sharing('81100000-0000-0000-0000-000000000001', true), 2, 'the owner shares her files with the project');
select is((select count(*)::int from public.documents where sha256 = repeat('0', 64)), 2, 'shared files are marked for re-upload');
reset role;
select public.ingest_document('81200000-0000-0000-0000-000000000001', '81100000-0000-0000-0000-000000000001', repeat('9', 64),
  (select plan from fixture), '[{"idx": 0, "content": "# Plan\n- [x] Write the checklist parser\n- [ ] Nộp báo cáo 📅 2026-10-05\n", "line": 1}]',
  (select items from fixture), (select milestones from fixture));
select public.refresh_project_stats('81100000-0000-0000-0000-000000000001');
select is((select row(title, due_on, hard, source)::text from public.milestones), '("Nộp báo cáo",2026-10-05,t,markdown)', 'a shared file''s dated item becomes a milestone');
select is((select row(items_total, items_done)::text from public.projects where id = '81100000-0000-0000-0000-000000000001'), '(2,1)', 'shared checklists count');
select is((select count(*)::int from public.project_progress_daily), 1, 'and record a progress point');

-- ── the team member ──
select tests.authenticate_as('82000000-0000-0000-0000-000000000082');
select is((select count(*)::int from public.documents), 2, 'members read shared files');
select is((select count(*)::int from public.checklist_items), 2, 'and their checklist items');
select is((select count(*)::int from public.search_chunks('checklist')), 2, 'a word inside an identifier matches through its terms');
select is((select count(*)::int from public.search_chunks('checklist', null, 30, false, array['code'])), 1, 'search can be narrowed to code');
select is((select count(*)::int from public.search_chunks('bao cao ke hoach', null, 30, true)), 1, 'question retrieval matches any word');
select throws_ok($$update public.documents set todos = '[]' where path = 'src/checklist.ts'$$, '42501', null, 'derived columns are not writable');

-- ── hiding again ──
select tests.authenticate_as('81000000-0000-0000-0000-000000000081');
select public.set_document_sharing('81100000-0000-0000-0000-000000000001', false);
select is((select count(*)::int from public.milestones), 0, 'hiding files removes the milestones they created');
select tests.authenticate_as('82000000-0000-0000-0000-000000000082');
select is((select count(*)::int from public.documents) + (select count(*)::int from public.search_chunks('checklist')), 0, 'members lose access to hidden files');

-- ── outsider ──
select tests.authenticate_as('83000000-0000-0000-0000-000000000083');
select throws_ok($$select public.ingest_document('81200000-0000-0000-0000-000000000001', null, '', '{}', '[]', '[]', '[]')$$, '42501', null,
  'API roles cannot ingest documents');

select * from finish();
rollback;

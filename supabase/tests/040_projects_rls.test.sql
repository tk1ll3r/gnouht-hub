-- Project roles (owner / editor / viewer / outsider) across projects, tasks, milestones and documents,
-- plus accent-insensitive search that respects document visibility.
begin;
select plan(26);

select tests.create_user('e0000000-0000-0000-0000-00000000000e', 'erin@example.com');   -- owner
select tests.create_user('f0000000-0000-0000-0000-00000000000f', 'frank@example.com');  -- editor
select tests.create_user('90000000-0000-0000-0000-000000000009', 'gina@example.com');   -- viewer
select tests.create_user('80000000-0000-0000-0000-000000000008', 'hank@example.com');   -- outsider

-- ── owner creates a project ──────────────────────────────────────────────
select tests.authenticate_as('e0000000-0000-0000-0000-00000000000e');
select lives_ok($$insert into public.projects (id, slug, name, kind) values ('e1000000-0000-0000-0000-000000000001', 'nt219-capstone', 'NT219 Capstone', 'course')$$,
  'a user creates a project');
select is((select role from public.project_members where user_id = 'e0000000-0000-0000-0000-00000000000e'), 'owner', 'creator becomes owner member');
select throws_ok($$insert into public.projects (owner_id, slug, name) values ('80000000-0000-0000-0000-000000000008', 'x-project', 'x')$$,
  '42501', null, 'projects cannot be created for someone else');
select lives_ok($$insert into public.tasks (title, project_id) values ('Chọn đề tài', 'e1000000-0000-0000-0000-000000000001')$$, 'owner adds a project task');
select is((select subject from public.activity where verb = 'created task'), 'Chọn đề tài', 'task creation is logged in the activity feed');

reset role;
insert into public.project_members (project_id, user_id, role) values
  ('e1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000f', 'editor'),
  ('e1000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000009', 'viewer');
insert into public.devices (id, user_id, name, secret_ciphertext) values ('e2000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', 'PC', 'v1.x');
insert into public.documents (id, owner_id, device_id, project_id, path, title, ext, size_bytes, sha256, modified_at, visibility) values
  ('e3000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', 'e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'Crypto/report.md', 'Báo cáo tiến độ', 'md', 10, repeat('a', 64), now(), 'project'),
  ('e3000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000000e', 'e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'Crypto/private.md', 'Ghi chú riêng', 'md', 10, repeat('b', 64), now(), 'private');
insert into public.document_chunks (document_id, idx, content) values
  ('e3000000-0000-0000-0000-000000000001', 0, 'Báo cáo tiến độ mã hóa AES và kiểm thử'),
  ('e3000000-0000-0000-0000-000000000002', 0, 'Báo cáo riêng tư chỉ chủ sở hữu thấy');

-- ── editor ───────────────────────────────────────────────────────────────
select tests.authenticate_as('f0000000-0000-0000-0000-00000000000f');
select is((select count(*)::int from public.projects), 1, 'editor sees the project');
select lives_ok($$update public.tasks set status = 'doing' where title = 'Chọn đề tài'$$, 'editor moves a task');
select is((select status from public.tasks where title = 'Chọn đề tài'), 'doing', 'the move is stored');
select lives_ok($$insert into public.milestones (project_id, title, due_on) values ('e1000000-0000-0000-0000-000000000001', 'Nộp proposal', current_date + 7)$$, 'editor adds a milestone');
select lives_ok($$update public.tasks set assignee_id = '90000000-0000-0000-0000-000000000009' where title = 'Chọn đề tài'$$, 'editor assigns a member');
select throws_ok($$update public.tasks set assignee_id = '80000000-0000-0000-0000-000000000008' where title = 'Chọn đề tài'$$,
  '23514', null, 'non-members cannot be assigned');
select results_eq($$with d as (delete from public.projects returning 1) select count(*)::int from d$$, $$values (0)$$, 'editors cannot delete the project');
select throws_ok($$insert into public.project_members (project_id, user_id, role) values ('e1000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000008', 'owner')$$,
  '42501', null, 'members cannot add members directly');
select is((select count(*)::int from public.documents), 1, 'editor sees only project-visible documents');

-- ── viewer ───────────────────────────────────────────────────────────────
select tests.authenticate_as('90000000-0000-0000-0000-000000000009');
select is((select count(*)::int from public.tasks where project_id is not null), 1, 'viewer reads project tasks');
-- Gina is the task's assignee: she may move her own task (see 045), but not rename it.
select throws_ok($$update public.tasks set title = 'renamed' where title = 'Chọn đề tài'$$, '42501', null,
  'viewer cannot change tasks beyond the progress of their own');
select throws_ok($$insert into public.tasks (title, project_id) values ('sneaky', 'e1000000-0000-0000-0000-000000000001')$$, '42501', null, 'viewer cannot add tasks');
select results_eq($$with u as (update public.milestones set done = true returning 1) select count(*)::int from u$$, $$values (0)$$, 'viewer cannot edit milestones');
select is((select count(*)::int from public.search_documents('bao cao')), 1, 'accent-insensitive search finds the shared report only');
select ok((select snippet from public.search_documents('bao cao')) like '%«%', 'search returns a highlighted snippet');

-- ── outsider ─────────────────────────────────────────────────────────────
select tests.authenticate_as('80000000-0000-0000-0000-000000000008');
select is((select count(*)::int from public.projects), 0, 'outsiders see no project');
select is((select count(*)::int from public.tasks), 0, 'outsiders see no project tasks');
select is((select count(*)::int from public.document_chunks), 0, 'outsiders read no document text');
select is((select count(*)::int from public.search_documents('bao cao')), 0, 'search returns nothing to outsiders');
select results_eq($$with u as (update public.documents set visibility = 'project' returning 1) select count(*)::int from u$$, $$values (0)$$, 'outsiders cannot change visibility');

-- ── owner sees everything, including private notes ───────────────────────
select tests.authenticate_as('e0000000-0000-0000-0000-00000000000e');
select is((select count(*)::int from public.search_documents('bao cao')), 2, 'owner finds her private and shared documents');

select * from finish();
rollback;

-- Projects and indexed documents: owner-only reads, server-only writes to derived tables,
-- accent-insensitive search that respects RLS, and owner consistency across tasks ↔ projects.
begin;
select plan(28);

select tests.create_user('e0000000-0000-0000-0000-00000000000e', 'erin@example.com');
select tests.create_user('f0000000-0000-0000-0000-00000000000f', 'frank@example.com');

-- Fixtures as the server would write them (service role bypasses RLS; here: postgres).
insert into public.projects (id, user_id, name, source, folder_key, folder_label)
values ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', 'Đồ án IDS', 'agent', repeat('a', 64), '…/Research/IDS');
insert into public.project_documents (id, user_id, project_id, path, kind, title, content_hash, content, items_total, items_done, items_cut)
values ('e2000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', 'e1000000-0000-0000-0000-000000000001',
        'tien-do.md', 'markdown', 'Tiến độ', repeat('b', 64), '# Tiến độ', 4, 2, 1);
insert into public.checklist_items (user_id, project_id, document_id, item_key, ord, text, status, line)
values ('e0000000-0000-0000-0000-00000000000e', 'e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001',
        '0123456789abcdef', 0, 'Viết phần Method', 'doing', 3);
insert into public.document_chunks (user_id, project_id, document_id, ord, heading, content)
values ('e0000000-0000-0000-0000-00000000000e', 'e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001',
        0, 'Tiến độ › Việc còn lại', 'Hoàn thiện phần Thảo luận trước hạn nộp abstract');
insert into public.tasks (id, user_id, title, kind, source, source_key, project_id, document_id, due_at)
values ('e3000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', 'Hạn nộp abstract', 'milestone', 'markdown',
        'md:x', 'e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', now() + interval '5 days');

select throws_ok(
  $$insert into public.project_documents (user_id, project_id, path, kind, title, content_hash)
    values ('e0000000-0000-0000-0000-00000000000e', 'e1000000-0000-0000-0000-000000000001', '../outside.md', 'markdown', 'x', repeat('c', 64))$$,
  '23514', null, 'document paths cannot climb out of the folder');
select throws_ok(
  $$insert into public.project_documents (user_id, project_id, path, kind, title, content_hash)
    values ('f0000000-0000-0000-0000-00000000000f', 'e1000000-0000-0000-0000-000000000001', 'x.md', 'markdown', 'x', repeat('c', 64))$$,
  '23503', null, 'a document cannot be attributed to someone else''s project');

-- ── Erin ──
select tests.authenticate_as('e0000000-0000-0000-0000-00000000000e');
select lives_ok($$insert into public.projects (name, color) values ('Thesis', '#0f9d8a')$$, 'owner creates a manual project');
select is((select user_id from public.projects where name = 'Thesis'), 'e0000000-0000-0000-0000-00000000000e'::uuid, 'project owner defaults to the caller');
select throws_ok($$insert into public.projects (name, source, folder_key) values ('Fake', 'agent', repeat('d', 64))$$,
  '42501', null, 'agent projects can only be created by the server');
select throws_ok($$update public.projects set items_done = 99$$, '42501', null, 'derived totals are not writable');
select lives_ok($$update public.projects set name = 'IDS thesis', status = 'paused' where id = 'e1000000-0000-0000-0000-000000000001'$$,
  'owner renames and pauses an agent project');
select throws_ok(
  $$insert into public.project_documents (user_id, project_id, path, kind, title, content_hash)
    values ('e0000000-0000-0000-0000-00000000000e', 'e1000000-0000-0000-0000-000000000001', 'y.md', 'markdown', 'y', repeat('c', 64))$$,
  '42501', null, 'documents are written only by the server');
select is((select count(*)::int from public.checklist_items), 1, 'owner reads her checklist items');
select is((select document_id from public.search_documents('tien do')), 'e2000000-0000-0000-0000-000000000001'::uuid,
  'search is accent-insensitive ("tien do" finds "Tiến độ")');
select is((select count(*)::int from public.search_documents('thao lu')), 1, 'search matches word prefixes');
select is((select count(*)::int from public.search_documents('abstract', 'e1000000-0000-0000-0000-000000000001')), 1, 'search can be scoped to a project');
select lives_ok($$select * from public.search_documents($q$foo & | ! ' :* <-> (bar$q$)$$, 'tsquery operators in the query cannot break the search');
select is((select count(*)::int from public.search_documents('***')), 0, 'a query without words returns nothing');
select lives_ok($$insert into public.tasks (title, project_id) values ('Draft outline', 'e1000000-0000-0000-0000-000000000001')$$,
  'owner links a manual task to her project');
select throws_ok($$select public.refresh_project_stats('e1000000-0000-0000-0000-000000000001')$$, '42501', null,
  'API roles cannot run the stats refresh');

-- ── Frank ──
select tests.authenticate_as('f0000000-0000-0000-0000-00000000000f');
select is((select count(*)::int from public.projects) + (select count(*)::int from public.project_documents)
          + (select count(*)::int from public.checklist_items) + (select count(*)::int from public.document_chunks), 0,
  'other users see no projects, documents, items or chunks');
select is((select count(*)::int from public.search_documents('tien do')), 0, 'search never returns other users'' chunks');
select throws_ok($$insert into public.tasks (title, project_id) values ('Hijack', 'e1000000-0000-0000-0000-000000000001')$$,
  '23503', null, 'a task cannot be linked to someone else''s project');
select results_eq($$with d as (delete from public.projects returning 1) select count(*)::int from d$$, $$values (0)$$,
  'other users cannot delete the project');
select throws_ok(
  $$select public.ingest_document('e1000000-0000-0000-0000-000000000001', '{}', '[]', '[]', '[]')$$,
  '42501', null, 'API roles cannot ingest documents');

-- ── server paths ──
reset role;
-- First sync: one dated checklist item (todo in the file).
select public.ingest_document('e1000000-0000-0000-0000-000000000001',
  jsonb_build_object('path', 'plan.md', 'kind', 'markdown', 'title', 'Plan', 'hash', repeat('e', 64), 'content', '- [ ] Draft 📅 2026-10-01',
                     'stats', jsonb_build_object('total', 1)),
  '[{"ord":0,"heading":null,"content":"Draft","line":1}]',
  '[{"key":"1111111111111111","text":"Draft","status":"todo","section":null,"line":1,"indent":0}]',
  '[{"key":"k1","title":"Draft","kind":"task","dueAt":"2026-10-01T16:59:00Z","ref":{"path":"plan.md","fileStatus":"todo"}}]');
select is((select status from public.tasks where title = 'Draft'), 'todo', 'dated checklist items become tasks');
-- The owner finishes it in the hub; a re-sync with the file still saying todo keeps "done".
update public.tasks set status = 'done' where title = 'Draft';
select public.ingest_document('e1000000-0000-0000-0000-000000000001',
  jsonb_build_object('path', 'plan.md', 'kind', 'markdown', 'title', 'Plan', 'hash', repeat('f', 64), 'content', '- [ ] Draft 📅 2026-10-02'),
  '[]', '[{"key":"1111111111111111","text":"Draft","status":"todo","section":null,"line":1,"indent":0}]',
  '[{"key":"k1","title":"Draft","kind":"task","dueAt":"2026-10-02T16:59:00Z","ref":{"path":"plan.md","fileStatus":"todo"}}]');
select is((select status || ' ' || to_char(due_at at time zone 'UTC', 'MM-DD') from public.tasks where title = 'Draft'), 'done 10-02',
  'hub-side status survives a re-sync while the date follows the file');
-- The file now marks it cut: that change wins.
select public.ingest_document('e1000000-0000-0000-0000-000000000001',
  jsonb_build_object('path', 'plan.md', 'kind', 'markdown', 'title', 'Plan', 'hash', repeat('f', 64), 'content', '- [CẮT] Draft 📅 2026-10-02'),
  '[]', '[{"key":"1111111111111111","text":"Draft","status":"cut","section":null,"line":1,"indent":0}]',
  '[{"key":"k1","title":"Draft","kind":"task","dueAt":"2026-10-02T16:59:00Z","ref":{"path":"plan.md","fileStatus":"cut"}}]');
select is((select status from public.tasks where title = 'Draft'), 'cut', 'a status change made in the file is applied');
select is((select count(*)::int from public.document_chunks where document_id = (select id from public.project_documents where path = 'plan.md')), 0,
  're-ingesting replaces the search chunks');
select public.ingest_document('e1000000-0000-0000-0000-000000000001',
  jsonb_build_object('path', 'plan.md', 'kind', 'markdown', 'title', 'Plan', 'hash', repeat('f', 64), 'content', ''), '[]', '[]', '[]');
select is((select count(*)::int from public.tasks where title = 'Draft'), 0, 'dated items removed from the file are removed from tasks');

select public.refresh_project_stats('e1000000-0000-0000-0000-000000000001');
select is((select array[items_total, items_done, items_cut] from public.projects where id = 'e1000000-0000-0000-0000-000000000001'),
  array[4, 2, 1], 'stats refresh sums document totals and records a history point');
delete from public.project_documents where id = 'e2000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.tasks where id = 'e3000000-0000-0000-0000-000000000001'), 0,
  'deleting a document removes its milestone tasks');

select * from finish();
rollback;

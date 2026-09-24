-- Source files: stored through ingest_document with language, outline, TODOs and identifier terms;
-- search finds split identifiers and can be narrowed by kind; everything stays owner-only.
begin;
select plan(13);

select tests.create_user('81000000-0000-0000-0000-000000000081', 'linh@example.com');
select tests.create_user('82000000-0000-0000-0000-000000000082', 'quan@example.com');
insert into public.projects (id, user_id, name, source, folder_key, folder_label)
values ('81100000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000081', 'Hub', 'agent', repeat('a', 64), '…/code/hub');

select lives_ok($$
  select public.ingest_document('81100000-0000-0000-0000-000000000001',
    '{"path": "src/checklist.ts", "kind": "code", "title": "checklist.ts", "hash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "content": "export function parseChecklist(text: string) {\n  // TODO: support nested lists\n}\n", "language": "typescript", "lineCount": 4,
      "outline": [{"name": "parseChecklist", "kind": "function", "line": 1, "depth": 0}],
      "todos": [{"tag": "TODO", "text": "support nested lists", "line": 2}]}'::jsonb,
    '[{"ord": 0, "heading": "parseChecklist", "content": "export function parseChecklist(text: string) {", "line": 1, "terms": "parse checklist"}]'::jsonb,
    '[]'::jsonb, '[]'::jsonb)
$$, 'the server stores a source file');
select public.ingest_document('81100000-0000-0000-0000-000000000001',
  '{"path": "notes/plan.md", "kind": "markdown", "title": "Plan", "hash": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "content": "# Plan\nchecklist parser first", "language": "markdown", "lineCount": 2,
    "outline": [{"name": "Plan", "kind": "heading", "line": 1, "depth": 0}]}'::jsonb,
  '[{"ord": 0, "heading": "Plan", "content": "checklist parser first", "line": 2}]'::jsonb, '[]'::jsonb, '[]'::jsonb);

select is((select row(kind, language, line_count, jsonb_array_length(outline), todos -> 0 ->> 'text')::text from public.project_documents where project_id = '81100000-0000-0000-0000-000000000001' and path = 'src/checklist.ts'),
  '(code,typescript,4,1,"support nested lists")', 'language, line count, outline and TODOs are stored');
select is((select terms from public.document_chunks c join public.project_documents d on d.id = c.document_id where d.project_id = '81100000-0000-0000-0000-000000000001' and d.path = 'src/checklist.ts'),
  'parse checklist', 'chunks keep their identifier terms');
select throws_ok($$update public.project_documents set outline = '{"not": "a list"}' where project_id = '81100000-0000-0000-0000-000000000001' and path = 'src/checklist.ts'$$, '23514', null,
  'the outline must be a list');
select throws_ok($$update public.project_documents set language = 'Type Script!' where project_id = '81100000-0000-0000-0000-000000000001' and path = 'src/checklist.ts'$$, '23514', null,
  'language ids are validated');

-- ── Linh ──
select tests.authenticate_as('81000000-0000-0000-0000-000000000081');
select is((select count(*)::int from public.search_documents('checklist')), 2, 'a word inside an identifier matches through its terms');
select is((select count(*)::int from public.search_documents('checklist', null, 30, false, array['code'])), 1, 'search can be narrowed to code');
select is((select count(*)::int from public.search_documents('checklist', null, 30, false, array['markdown', 'text', 'docx', 'pdf', 'pptx'])), 1,
  'or to notes');
select is((select outline -> 0 ->> 'name' from public.project_documents where project_id = '81100000-0000-0000-0000-000000000001' and path = 'src/checklist.ts'), 'parseChecklist', 'the owner reads the outline');
select throws_ok($$update public.project_documents set todos = '[]' where project_id = '81100000-0000-0000-0000-000000000001' and path = 'src/checklist.ts'$$, '42501', null,
  'derived columns are not writable through the API');

-- ── Quân ──
select tests.authenticate_as('82000000-0000-0000-0000-000000000082');
select is((select count(*)::int from public.project_documents), 0, 'other users see no files');
select is((select count(*)::int from public.search_documents('checklist')), 0, 'or search hits');
select throws_ok($$select public.ingest_document('81100000-0000-0000-0000-000000000001', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)$$,
  '42501', null, 'API roles cannot ingest documents');

select * from finish();
rollback;

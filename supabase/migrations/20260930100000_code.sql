-- M7: source code in watched folders (opt-in on the PC with `project add --code`) for the file
-- workspace: language, outline and TODO comments per document, identifier-aware search, kind filters.

alter table public.project_documents drop constraint project_documents_kind_check;
alter table public.project_documents add constraint project_documents_kind_check
  check (kind in ('markdown', 'text', 'docx', 'pdf', 'pptx', 'code'));

alter table public.project_documents
  -- highlight.js language id ("typescript", "markdown"), null for plain text and office files.
  add column language text check (language ~ '^[a-z0-9+#-]{1,24}$'),
  add column line_count integer not null default 0 check (line_count >= 0),
  -- [{name, kind, line, depth}]: headings of notes, declarations of source files.
  add column outline jsonb not null default '[]'::jsonb
    check (jsonb_typeof(outline) = 'array' and jsonb_array_length(outline) <= 500 and pg_column_size(outline) <= 65536),
  -- [{tag, text, line}]: TODO/FIXME comments of source files.
  add column todos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(todos) = 'array' and jsonb_array_length(todos) <= 200 and pg_column_size(todos) <= 65536);

create index project_documents_todos_idx on public.project_documents (project_id) where todos <> '[]'::jsonb;

-- Split identifiers ("parseChecklist" → "parse checklist") are searchable without being shown.
alter table public.document_chunks add column terms text check (char_length(terms) <= 4000);
drop index public.document_chunks_fts_idx;
alter table public.document_chunks drop column fts;
alter table public.document_chunks add column fts tsvector generated always as (
  setweight(to_tsvector('simple'::regconfig, private.search_fold(heading)), 'A')
  || setweight(to_tsvector('simple'::regconfig, private.search_fold(content)), 'B')
  || setweight(to_tsvector('simple'::regconfig, private.search_fold(terms)), 'C')
) stored;
create index document_chunks_fts_idx on public.document_chunks using gin (fts);

-- Search can be narrowed to kinds of files ("notes" or "code").
drop function public.search_documents(text, uuid, integer, boolean);
create function public.search_documents(
  p_query text, p_project uuid default null, p_limit integer default 30, p_any boolean default false, p_kinds text[] default null)
returns table (chunk_id bigint, document_id uuid, project_id uuid, heading text, content text, line integer, rank real)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.document_id, c.project_id, c.heading, c.content, c.line, ts_rank_cd(c.fts, q.tsq) as rank
  from public.document_chunks c
  cross join (select private.search_tsquery(p_query, p_any) as tsq) q
  where q.tsq is not null
    and c.fts @@ q.tsq
    and (p_project is null or c.project_id = p_project)
    and (p_kinds is null or exists (
      select 1 from public.project_documents d where d.id = c.document_id and d.kind = any (p_kinds)))
  order by rank desc, c.id
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
revoke all on function public.search_documents(text, uuid, integer, boolean, text[]) from public, anon;
grant execute on function public.search_documents(text, uuid, integer, boolean, text[]) to authenticated, service_role;

-- Same as before, plus language, line count, outline, TODOs and chunk terms.
create or replace function public.ingest_document(p_project uuid, p_document jsonb, p_chunks jsonb, p_items jsonb, p_deadlines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_course uuid;
  v_doc uuid;
  v_prev jsonb;
begin
  select user_id, course_id into v_user, v_course from public.projects where id = p_project;
  if v_user is null then
    raise exception 'project % not found', p_project;
  end if;

  insert into public.project_documents as d (
    user_id, project_id, path, kind, title, content_hash, size_bytes, modified_at, content, truncated, redactions,
    reference_date, items_total, items_done, items_doing, items_attention, items_cut, error, indexed_at,
    language, line_count, outline, todos)
  values (
    v_user, p_project, p_document ->> 'path', p_document ->> 'kind', p_document ->> 'title', p_document ->> 'hash',
    coalesce((p_document ->> 'sizeBytes')::bigint, 0), (p_document ->> 'modifiedAt')::timestamptz,
    coalesce(p_document ->> 'content', ''), coalesce((p_document ->> 'truncated')::boolean, false),
    coalesce((p_document ->> 'redactions')::int, 0), (p_document ->> 'referenceDate')::date,
    coalesce((p_document -> 'stats' ->> 'total')::int, 0), coalesce((p_document -> 'stats' ->> 'done')::int, 0),
    coalesce((p_document -> 'stats' ->> 'doing')::int, 0), coalesce((p_document -> 'stats' ->> 'attention')::int, 0),
    coalesce((p_document -> 'stats' ->> 'cut')::int, 0), p_document ->> 'error', now(),
    p_document ->> 'language', coalesce((p_document ->> 'lineCount')::int, 0),
    coalesce(p_document -> 'outline', '[]'::jsonb), coalesce(p_document -> 'todos', '[]'::jsonb))
  on conflict (project_id, path) do update
    set kind = excluded.kind, title = excluded.title, content_hash = excluded.content_hash, size_bytes = excluded.size_bytes,
        modified_at = excluded.modified_at, content = excluded.content, truncated = excluded.truncated,
        redactions = excluded.redactions, reference_date = excluded.reference_date, items_total = excluded.items_total,
        items_done = excluded.items_done, items_doing = excluded.items_doing, items_attention = excluded.items_attention,
        items_cut = excluded.items_cut, error = excluded.error, indexed_at = excluded.indexed_at,
        language = excluded.language, line_count = excluded.line_count, outline = excluded.outline, todos = excluded.todos
  returning id into v_doc;

  delete from public.document_chunks where document_id = v_doc;
  insert into public.document_chunks (user_id, project_id, document_id, ord, heading, content, line, terms)
  select v_user, p_project, v_doc, (c ->> 'ord')::int, c ->> 'heading', c ->> 'content', coalesce((c ->> 'line')::int, 1),
         nullif(c ->> 'terms', '')
  from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) as c;

  -- Previous state is captured before the delete (a single statement cannot delete and re-insert the same keys).
  select coalesce(jsonb_object_agg(item_key, jsonb_build_object('status', status, 'first', first_seen_at, 'changed', status_changed_at)), '{}'::jsonb)
    into v_prev
  from public.checklist_items where document_id = v_doc;
  delete from public.checklist_items where document_id = v_doc;
  insert into public.checklist_items (user_id, project_id, document_id, item_key, ord, text, status, section, line, indent, first_seen_at, status_changed_at)
  select v_user, p_project, v_doc, i ->> 'key', (x.ord - 1)::int, i ->> 'text', i ->> 'status', i ->> 'section',
         (i ->> 'line')::int, coalesce((i ->> 'indent')::smallint, 0),
         coalesce((v_prev -> (i ->> 'key') ->> 'first')::timestamptz, now()),
         case when v_prev -> (i ->> 'key') ->> 'status' = i ->> 'status'
              then (v_prev -> (i ->> 'key') ->> 'changed')::timestamptz else now() end
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as x(i, ord)
  on conflict (document_id, item_key) do nothing;

  -- Dated items become tasks. Rows that vanished from the file are removed; the hub-side status survives
  -- re-syncs unless the file's own status (checklist items) changed since the last sync.
  delete from public.tasks t
  where t.document_id = v_doc
    and t.source_key not in (
      select 'md:' || v_doc || ':' || (d ->> 'key') from jsonb_array_elements(coalesce(p_deadlines, '[]'::jsonb)) as d);
  insert into public.tasks as t (user_id, title, kind, status, due_at, source, source_key, source_ref, project_id, document_id, course_id)
  select v_user, d ->> 'title', d ->> 'kind', coalesce(d -> 'ref' ->> 'fileStatus', 'todo'), (d ->> 'dueAt')::timestamptz,
         'markdown', 'md:' || v_doc || ':' || (d ->> 'key'), coalesce(d -> 'ref', '{}'::jsonb), p_project, v_doc, v_course
  from jsonb_array_elements(coalesce(p_deadlines, '[]'::jsonb)) as d
  on conflict (user_id, source, source_key) do update
    set title = excluded.title,
        due_at = excluded.due_at,
        source_ref = excluded.source_ref,
        status = case
          when excluded.source_ref ->> 'fileStatus' is not null
           and excluded.source_ref ->> 'fileStatus' is distinct from t.source_ref ->> 'fileStatus'
          then excluded.status else t.status end,
        course_id = coalesce(t.course_id, excluded.course_id);

  return v_doc;
end;
$$;

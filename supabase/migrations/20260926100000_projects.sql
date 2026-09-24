-- M3: projects, indexed documents (checklists, milestones, full-text search chunks) and progress history.
--
-- Agent-indexed projects are created by trusted server code when the agent reports a watched folder;
-- users can also create manual projects. Document content arrives already redacted from the agent and
-- is only readable by the owner (M4 extends reads to project members).

-- ───────────────────────────── search helpers ─────────────────────────────

-- unaccent() is only STABLE (its dictionary could change), so it cannot back a generated column. The
-- dictionary is fixed here, which makes the wrapper safe to declare IMMUTABLE (the documented pattern).
create function private.search_fold(p_text text) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_text, '')));
$$;

-- User input → prefix tsquery. Only folded alphanumeric runs survive, so tsquery syntax cannot be injected.
create function private.search_tsquery(p_query text) returns tsquery
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when count(*) = 0 then null
              else to_tsquery('simple'::regconfig, string_agg(t || ':*', ' & '))
         end
  from (
    select t
    from regexp_split_to_table(private.search_fold(left(p_query, 200)), '[^[:alnum:]]+') as t
    where t <> ''
    limit 12
  ) terms;
$$;
grant execute on function private.search_fold(text), private.search_tsquery(text) to authenticated, service_role;

-- ───────────────────────────── projects ─────────────────────────────

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 2000),
  color text not null default '#7c3aed' check (color ~ '^#[0-9a-fA-F]{6}$'),
  course_id uuid,
  status text not null default 'active' check (status in ('active', 'paused', 'done', 'archived')),
  due_on date,
  source text not null default 'manual' check (source in ('manual', 'agent')),
  -- Agent projects: sha256 of the folder's absolute path (the path itself never leaves the PC).
  folder_key text check (folder_key ~ '^[0-9a-f]{64}$'),
  folder_label text check (char_length(folder_label) <= 200),
  device_id uuid,
  last_synced_at timestamptz,
  -- Checklist totals over every document, maintained by public.refresh_project_stats().
  items_total integer not null default 0,
  items_done integer not null default 0,
  items_doing integer not null default 0,
  items_attention integer not null default 0,
  items_cut integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, folder_key),
  check ((source = 'agent') = (folder_key is not null)),
  foreign key (course_id, user_id) references public.courses (id, user_id) on delete set null (course_id),
  foreign key (device_id, user_id) references public.devices (id, user_id) on delete set null (device_id)
);
create index projects_user_idx on public.projects (user_id, status);
create trigger projects_updated_at before update on public.projects
  for each row execute function private.set_updated_at();

alter table public.projects enable row level security;
revoke all on public.projects from anon, authenticated;
grant select, delete on public.projects to authenticated;
grant insert (name, description, color, course_id, status, due_on) on public.projects to authenticated;
grant update (name, description, color, course_id, status, due_on) on public.projects to authenticated;
create policy "owners read projects" on public.projects
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owners create manual projects" on public.projects
  for insert to authenticated with check (user_id = (select auth.uid()) and source = 'manual');
create policy "owners update projects" on public.projects
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owners delete projects" on public.projects
  for delete to authenticated using (user_id = (select auth.uid()));

-- ───────────────────────────── documents ─────────────────────────────

create table public.project_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null,
  -- Relative, forward-slash path inside the watched folder (a label; validated by the API).
  path text not null check (char_length(path) between 1 and 500 and path !~ '(^/|\\|(^|/)\.\.?(/|$))'),
  kind text not null check (kind in ('markdown', 'text', 'docx', 'pdf', 'pptx')),
  title text not null check (char_length(title) between 1 and 300),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  modified_at timestamptz,
  -- Extracted, redacted text (Markdown for .md files). Rendered as Markdown without raw HTML.
  content text not null default '' check (char_length(content) <= 120000),
  truncated boolean not null default false,
  redactions integer not null default 0 check (redactions >= 0),
  reference_date date,
  items_total integer not null default 0,
  items_done integer not null default 0,
  items_doing integer not null default 0,
  items_attention integer not null default 0,
  items_cut integer not null default 0,
  error text check (char_length(error) <= 200),
  indexed_at timestamptz not null default now(),
  unique (id, user_id),
  unique (project_id, path),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);
create index project_documents_user_idx on public.project_documents (user_id);

create table public.checklist_items (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  project_id uuid not null,
  document_id uuid not null,
  item_key text not null check (item_key ~ '^[0-9a-f]{16}$'),
  ord integer not null,
  text text not null check (char_length(text) between 1 and 300),
  status text not null check (status in ('todo', 'doing', 'attention', 'done', 'cut')),
  section text check (char_length(section) <= 300),
  line integer not null check (line > 0),
  indent smallint not null default 0,
  first_seen_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  unique (document_id, item_key),
  foreign key (document_id, user_id) references public.project_documents (id, user_id) on delete cascade,
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);
create index checklist_items_project_idx on public.checklist_items (project_id, status);

create table public.document_chunks (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  project_id uuid not null,
  document_id uuid not null,
  ord integer not null,
  heading text check (char_length(heading) <= 300),
  content text not null check (char_length(content) between 1 and 8000),
  line integer not null default 1,
  fts tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig, private.search_fold(heading)), 'A')
    || setweight(to_tsvector('simple'::regconfig, private.search_fold(content)), 'B')
  ) stored,
  foreign key (document_id, user_id) references public.project_documents (id, user_id) on delete cascade,
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);
create index document_chunks_fts_idx on public.document_chunks using gin (fts);
create index document_chunks_document_idx on public.document_chunks (document_id, ord);

create table public.project_progress_daily (
  project_id uuid not null,
  user_id uuid not null,
  day date not null,
  total integer not null,
  done integer not null,
  doing integer not null,
  attention integer not null,
  cut integer not null,
  primary key (project_id, day),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade
);

-- Everything below is written only by trusted server code (agent ingestion).
do $$
declare
  t text;
begin
  foreach t in array array['project_documents', 'checklist_items', 'document_chunks', 'project_progress_daily'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy "owners read %1$s" on public.%1$I for select to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- ───────────────────────────── tasks ↔ projects ─────────────────────────────

alter table public.tasks
  add column project_id uuid,
  -- Milestones parsed from a document disappear with it.
  add column document_id uuid,
  add constraint tasks_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete set null (project_id),
  add constraint tasks_document_fk foreign key (document_id, user_id)
    references public.project_documents (id, user_id) on delete cascade,
  add constraint tasks_document_is_markdown check (document_id is null or source = 'markdown');
create index tasks_project_idx on public.tasks (project_id) where project_id is not null;
grant insert (project_id), update (project_id) on public.tasks to authenticated;

-- ───────────────────────────── search ─────────────────────────────

-- SECURITY INVOKER: runs under the caller's RLS, so it only ever sees the caller's chunks.
create function public.search_documents(p_query text, p_project uuid default null, p_limit integer default 30)
returns table (chunk_id bigint, document_id uuid, project_id uuid, heading text, content text, line integer, rank real)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.document_id, c.project_id, c.heading, c.content, c.line, ts_rank(c.fts, q.tsq) as rank
  from public.document_chunks c
  cross join (select private.search_tsquery(p_query) as tsq) q
  where q.tsq is not null
    and c.fts @@ q.tsq
    and (p_project is null or c.project_id = p_project)
  order by rank desc, c.id
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
revoke all on function public.search_documents(text, uuid, integer) from public, anon;
grant execute on function public.search_documents(text, uuid, integer) to authenticated, service_role;

-- ───────────────────────────── ingestion ─────────────────────────────

-- Stores one analysed document atomically: the document row, its search chunks, its checklist items
-- (keeping first-seen / status-changed times per stable item key) and its dated items as tasks.
-- The caller (agent endpoint) has already authenticated the device and checked project ownership.
create function public.ingest_document(p_project uuid, p_document jsonb, p_chunks jsonb, p_items jsonb, p_deadlines jsonb)
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
    reference_date, items_total, items_done, items_doing, items_attention, items_cut, error, indexed_at)
  values (
    v_user, p_project, p_document ->> 'path', p_document ->> 'kind', p_document ->> 'title', p_document ->> 'hash',
    coalesce((p_document ->> 'sizeBytes')::bigint, 0), (p_document ->> 'modifiedAt')::timestamptz,
    coalesce(p_document ->> 'content', ''), coalesce((p_document ->> 'truncated')::boolean, false),
    coalesce((p_document ->> 'redactions')::int, 0), (p_document ->> 'referenceDate')::date,
    coalesce((p_document -> 'stats' ->> 'total')::int, 0), coalesce((p_document -> 'stats' ->> 'done')::int, 0),
    coalesce((p_document -> 'stats' ->> 'doing')::int, 0), coalesce((p_document -> 'stats' ->> 'attention')::int, 0),
    coalesce((p_document -> 'stats' ->> 'cut')::int, 0), p_document ->> 'error', now())
  on conflict (project_id, path) do update
    set kind = excluded.kind, title = excluded.title, content_hash = excluded.content_hash, size_bytes = excluded.size_bytes,
        modified_at = excluded.modified_at, content = excluded.content, truncated = excluded.truncated,
        redactions = excluded.redactions, reference_date = excluded.reference_date, items_total = excluded.items_total,
        items_done = excluded.items_done, items_doing = excluded.items_doing, items_attention = excluded.items_attention,
        items_cut = excluded.items_cut, error = excluded.error, indexed_at = excluded.indexed_at
  returning id into v_doc;

  delete from public.document_chunks where document_id = v_doc;
  insert into public.document_chunks (user_id, project_id, document_id, ord, heading, content, line)
  select v_user, p_project, v_doc, (c ->> 'ord')::int, c ->> 'heading', c ->> 'content', coalesce((c ->> 'line')::int, 1)
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
revoke all on function public.ingest_document(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_document(uuid, jsonb, jsonb, jsonb, jsonb) to service_role;

-- ───────────────────────────── stats ─────────────────────────────

-- Recomputes a project's checklist totals and records today's point of the progress history
-- (in the owner's time zone). Called by the ingestion endpoint after every change.
create function public.refresh_project_stats(p_project uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_tz text;
  v record;
begin
  select p.user_id, coalesce(pr.timezone, 'Asia/Ho_Chi_Minh')
    into v_user, v_tz
  from public.projects p
  left join public.profiles pr on pr.id = p.user_id
  where p.id = p_project;
  if v_user is null then
    return;
  end if;

  select coalesce(sum(items_total), 0)::int as total, coalesce(sum(items_done), 0)::int as done,
         coalesce(sum(items_doing), 0)::int as doing, coalesce(sum(items_attention), 0)::int as attention,
         coalesce(sum(items_cut), 0)::int as cut
    into v
  from public.project_documents
  where project_id = p_project;

  update public.projects
     set items_total = v.total, items_done = v.done, items_doing = v.doing, items_attention = v.attention,
         items_cut = v.cut, last_synced_at = now()
   where id = p_project;

  if v.total > 0 then
    insert into public.project_progress_daily as d (project_id, user_id, day, total, done, doing, attention, cut)
    values (p_project, v_user, (now() at time zone v_tz)::date, v.total, v.done, v.doing, v.attention, v.cut)
    on conflict (project_id, day) do update
      set total = excluded.total, done = excluded.done, doing = excluded.doing,
          attention = excluded.attention, cut = excluded.cut;
  end if;
end;
$$;
revoke all on function public.refresh_project_stats(uuid) from public, anon, authenticated;
grant execute on function public.refresh_project_stats(uuid) to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

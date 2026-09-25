-- M3 (continued): folders on a PC synced into projects by the agent, on top of the M3 model.
--
-- * A watched folder becomes (or is linked to) a project. Its files become documents owned by the member
--   whose PC synced them; each member decides whether their files are visible to the project
--   (project_members.shares_documents), so notes stay private unless shared.
-- * Documents keep what the workspace needs: kind, language, line count, outline, TODO comments, and their
--   text as contiguous chunks (concatenated in order they give the file back; each knows its first line).
-- * Checklist items are tracked per item (first seen, status changes); project totals and a daily progress
--   history count shared documents only, so every member sees the same numbers.
-- * Dated items in shared files become project milestones (source 'markdown').

-- ───────────────────────────── session guard ─────────────────────────────

-- User-callable SECURITY DEFINER functions bypass RLS, so they check the caller's session themselves. These
-- start permissive; the M6 migration gives them their real bodies (live session, two-step sign-in).
create function private.session_allowed() returns boolean
language sql stable security definer set search_path = ''
as $$
  select true;
$$;
create function private.require_session() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.session_allowed() then
    raise exception 'sign-in required (session ended or two-step sign-in missing)' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.session_allowed(), private.require_session() from public, anon;
grant execute on function private.session_allowed(), private.require_session() to authenticated, service_role;

-- ───────────────────────────── search helpers ─────────────────────────────

-- User input → prefix tsquery in the hub_search configuration. Only alphanumeric runs survive, so tsquery
-- syntax cannot be injected; "tien do" matches "Tiến độ" and "check" matches "checklist". Questions (p_any)
-- match any word and let the rank order results.
create function private.chunk_tsquery(p_query text, p_any boolean default false) returns tsquery
language sql
stable
parallel safe
set search_path = ''
as $$
  select case when count(*) = 0 then null
              else to_tsquery('public.hub_search'::regconfig, string_agg(t || ':*', case when p_any then ' | ' else ' & ' end))
         end
  from (
    select distinct t
    from regexp_split_to_table(lower(extensions.unaccent(left(coalesce(p_query, ''), 200))), '[^[:alnum:]]+') as t
    where t <> '' and (not p_any or length(t) > 1)
    limit 12
  ) terms;
$$;
revoke all on function private.chunk_tsquery(text, boolean) from public, anon;
grant execute on function private.chunk_tsquery(text, boolean) to authenticated, service_role;

-- ───────────────────────────── projects ─────────────────────────────

alter table public.projects
  -- sha256 of the watched folder's absolute path, for projects created from a PC folder.
  add column folder_key text check (folder_key ~ '^[0-9a-f]{64}$'),
  add column folder_label text check (char_length(folder_label) <= 200),
  add column last_synced_at timestamptz,
  -- Checklist totals over the project's shared documents (server-maintained).
  add column items_total integer not null default 0 check (items_total >= 0),
  add column items_done integer not null default 0 check (items_done >= 0),
  add column items_doing integer not null default 0 check (items_doing >= 0),
  add column items_attention integer not null default 0 check (items_attention >= 0),
  add column items_cut integer not null default 0 check (items_cut >= 0);
create unique index projects_folder_idx on public.projects (owner_id, folder_key) where folder_key is not null;

-- Users create projects with the editable columns only; folder links and totals are server-owned.
revoke insert on public.projects from authenticated;
grant insert (id, slug, name, kind, description, course_id, color, status, due_on) on public.projects to authenticated;

-- Whether this member's synced files are visible to the other members.
alter table public.project_members add column shares_documents boolean not null default false;

-- ───────────────────────────── documents ─────────────────────────────

-- Paths are relative to a watched folder, and one PC can watch several folders, so identity is
-- (device, folder, path). Documents inserted without a folder key (tests, future uploads) use ''.
alter table public.documents drop constraint documents_device_id_path_key;
alter table public.documents
  add column root_key text not null default '' check (root_key = '' or root_key ~ '^[0-9a-f]{64}$'),
  add column kind text not null default 'text' check (kind in ('markdown', 'text', 'tex', 'docx', 'pdf', 'pptx', 'xlsx', 'code')),
  -- highlight.js language id ("typescript", "markdown"), null for office files and plain text.
  add column language text check (language ~ '^[a-z0-9+#-]{1,24}$'),
  add column line_count integer not null default 0 check (line_count >= 0),
  -- [{name, kind, line, depth}]: headings of notes, declarations of source files.
  add column outline jsonb not null default '[]'::jsonb
    check (jsonb_typeof(outline) = 'array' and jsonb_array_length(outline) <= 500 and pg_column_size(outline) <= 65536),
  -- [{tag, text, line}]: TODO/FIXME comments of source files.
  add column todos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(todos) = 'array' and jsonb_array_length(todos) <= 200 and pg_column_size(todos) <= 65536),
  add column redactions integer not null default 0 check (redactions >= 0),
  add column truncated boolean not null default false,
  add column error text check (char_length(error) <= 200),
  add constraint documents_device_root_path_key unique (device_id, root_key, path);
create index documents_todos_idx on public.documents (project_id) where todos <> '[]'::jsonb;

-- Chunks carry the line they start on, the heading or symbol they sit under, and split identifiers
-- ("parseChecklist" → "parse checklist") so words inside names are searchable without being shown.
alter table public.document_chunks
  add column line integer not null default 1 check (line >= 1),
  add column heading text check (char_length(heading) <= 300),
  add column terms text check (char_length(terms) <= 4000);
drop index public.document_chunks_tsv_idx;
alter table public.document_chunks drop column tsv;
alter table public.document_chunks add column tsv tsvector generated always as (
  setweight(to_tsvector('public.hub_search'::regconfig, coalesce(heading, '')), 'A')
  || setweight(to_tsvector('public.hub_search'::regconfig, content), 'B')
  || setweight(to_tsvector('public.hub_search'::regconfig, coalesce(terms, '')), 'C')
) stored;
create index document_chunks_tsv_idx on public.document_chunks using gin (tsv);

-- ───────────────────────────── checklist items & progress ─────────────────────────────

create table public.checklist_items (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents (id) on delete cascade,
  -- Stable per file + section + text, so ticking or moving an item keeps its identity.
  item_key text not null check (item_key ~ '^[0-9a-f]{16}$'),
  ord integer not null,
  text text not null check (char_length(text) between 1 and 1000),
  status text not null check (status in ('todo', 'doing', 'attention', 'done', 'cut')),
  section text check (char_length(section) <= 300),
  line integer not null,
  indent smallint not null default 0,
  first_seen_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  unique (document_id, item_key)
);
alter table public.checklist_items enable row level security;
revoke all on public.checklist_items from anon, authenticated;
grant select on public.checklist_items to authenticated;
create policy "readers read checklist items" on public.checklist_items
  for select to authenticated using (private.can_read_document(document_id));

create table public.project_progress_daily (
  project_id uuid not null references public.projects (id) on delete cascade,
  day date not null,
  total integer not null,
  done integer not null,
  doing integer not null,
  attention integer not null,
  cut integer not null,
  primary key (project_id, day)
);
alter table public.project_progress_daily enable row level security;
revoke all on public.project_progress_daily from anon, authenticated;
grant select on public.project_progress_daily to authenticated;
create policy "members read progress" on public.project_progress_daily
  for select to authenticated using (private.is_project_member(project_id));

-- ───────────────────────────── search ─────────────────────────────

-- Passage-level search with prefix matching, optionally any-word (for AI retrieval) and narrowed by kind.
-- SECURITY INVOKER: RLS on documents and chunks decides what the caller can find.
create function public.search_chunks(
  p_query text, p_project uuid default null, p_limit integer default 30, p_any boolean default false, p_kinds text[] default null)
returns table (document_id uuid, idx integer, project_id uuid, heading text, content text, line integer, rank real)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.document_id, c.idx, d.project_id, c.heading, c.content, c.line, ts_rank_cd(c.tsv, q.tsq) as rank
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  cross join (select private.chunk_tsquery(p_query, p_any) as tsq) q
  where q.tsq is not null
    and c.tsv @@ q.tsq
    and (p_project is null or d.project_id = p_project)
    and (p_kinds is null or d.kind = any (p_kinds))
  order by rank desc, d.modified_at desc, c.idx
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
revoke all on function public.search_chunks(text, uuid, integer, boolean, text[]) from public, anon;
grant execute on function public.search_chunks(text, uuid, integer, boolean, text[]) to authenticated, service_role;

-- ───────────────────────────── ingestion ─────────────────────────────

-- Recomputes a project's totals from its shared documents and records today's point of the progress
-- history (in the project owner's time zone).
create function public.refresh_project_stats(p_project uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v record;
begin
  select coalesce(pr.timezone, 'Asia/Ho_Chi_Minh') into v_tz
  from public.projects p left join public.profiles pr on pr.id = p.owner_id
  where p.id = p_project;
  if not found then
    return;
  end if;
  select coalesce(sum((checklist ->> 'total')::int), 0)::int as total, coalesce(sum((checklist ->> 'done')::int), 0)::int as done,
         coalesce(sum((checklist ->> 'doing')::int), 0)::int as doing, coalesce(sum((checklist ->> 'attention')::int), 0)::int as attention,
         coalesce(sum((checklist ->> 'cut')::int), 0)::int as cut
    into v
  from public.documents
  where project_id = p_project and visibility = 'project' and checklist is not null;

  update public.projects
     set items_total = v.total, items_done = v.done, items_doing = v.doing, items_attention = v.attention, items_cut = v.cut
   where id = p_project;
  if v.total > 0 then
    insert into public.project_progress_daily as d (project_id, day, total, done, doing, attention, cut)
    values (p_project, (now() at time zone v_tz)::date, v.total, v.done, v.doing, v.attention, v.cut)
    on conflict (project_id, day) do update
      set total = excluded.total, done = excluded.done, doing = excluded.doing, attention = excluded.attention, cut = excluded.cut;
  end if;
end;
$$;

-- Stores one analysed file atomically: the document, its chunks, its checklist items (keeping first-seen
-- and status-changed times per item) and, when the file is shared with the project, its dated items as
-- milestones. The agent endpoint has authenticated the device and resolved the project.
create function public.ingest_document(
  p_device uuid, p_project uuid, p_root text, p_document jsonb, p_chunks jsonb, p_items jsonb, p_milestones jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_visibility text := 'private';
  v_doc uuid;
  v_prev jsonb;
begin
  select user_id into v_owner from public.devices where id = p_device;
  if v_owner is null then
    raise exception 'device % not found', p_device;
  end if;
  if p_project is not null then
    select case when m.shares_documents then 'project' else 'private' end into v_visibility
    from public.project_members m where m.project_id = p_project and m.user_id = v_owner;
    if not found then
      raise exception 'the device owner is not a member of project %', p_project using errcode = '42501';
    end if;
  end if;

  insert into public.documents as d (
    owner_id, device_id, root_key, project_id, path, title, ext, kind, language, size_bytes, sha256, modified_at,
    visibility, excerpt, checklist, line_count, outline, todos, redactions, truncated, error, indexed_at)
  values (
    v_owner, p_device, coalesce(p_root, ''), p_project, p_document ->> 'path', p_document ->> 'title', p_document ->> 'ext',
    p_document ->> 'kind', p_document ->> 'language', coalesce((p_document ->> 'sizeBytes')::bigint, 0), p_document ->> 'sha256',
    (p_document ->> 'modifiedAt')::timestamptz, v_visibility, p_document ->> 'excerpt',
    case when jsonb_typeof(p_document -> 'checklist') = 'object' then p_document -> 'checklist' end,
    coalesce((p_document ->> 'lineCount')::int, 0), coalesce(p_document -> 'outline', '[]'::jsonb),
    coalesce(p_document -> 'todos', '[]'::jsonb), coalesce((p_document ->> 'redactions')::int, 0),
    coalesce((p_document ->> 'truncated')::boolean, false), p_document ->> 'error', now())
  on conflict (device_id, root_key, path) do update
    set project_id = excluded.project_id, title = excluded.title, ext = excluded.ext, kind = excluded.kind,
        language = excluded.language, size_bytes = excluded.size_bytes, sha256 = excluded.sha256,
        modified_at = excluded.modified_at, visibility = excluded.visibility, excerpt = excluded.excerpt,
        checklist = excluded.checklist, line_count = excluded.line_count, outline = excluded.outline,
        todos = excluded.todos, redactions = excluded.redactions, truncated = excluded.truncated,
        error = excluded.error, indexed_at = excluded.indexed_at
  returning id into v_doc;

  delete from public.document_chunks where document_id = v_doc;
  insert into public.document_chunks (document_id, idx, content, line, heading, terms)
  select v_doc, (c ->> 'idx')::int, c ->> 'content', coalesce((c ->> 'line')::int, 1), c ->> 'heading', nullif(c ->> 'terms', '')
  from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) as c;

  -- Previous state is captured before the delete (one statement cannot delete and re-insert the same keys).
  select coalesce(jsonb_object_agg(item_key, jsonb_build_object('status', status, 'first', first_seen_at, 'changed', status_changed_at)), '{}'::jsonb)
    into v_prev
  from public.checklist_items where document_id = v_doc;
  delete from public.checklist_items where document_id = v_doc;
  insert into public.checklist_items (document_id, item_key, ord, text, status, section, line, indent, first_seen_at, status_changed_at)
  select v_doc, i ->> 'key', (x.ord - 1)::int, i ->> 'text', i ->> 'status', i ->> 'section',
         (i ->> 'line')::int, coalesce((i ->> 'indent')::smallint, 0),
         coalesce((v_prev -> (i ->> 'key') ->> 'first')::timestamptz, now()),
         case when v_prev -> (i ->> 'key') ->> 'status' = i ->> 'status'
              then (v_prev -> (i ->> 'key') ->> 'changed')::timestamptz else now() end
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as x(i, ord)
  on conflict (document_id, item_key) do nothing;

  -- Milestones from this file: replaced on every sync, and only kept while the file is shared (members can
  -- read milestones, so a private note must not create them).
  delete from public.milestones m
  where m.source = 'markdown' and m.source_ref ->> 'documentId' = v_doc::text
    and (v_visibility <> 'project' or m.project_id is distinct from p_project
         or m.source_key not in (select 'md:' || v_doc || ':' || (x ->> 'key') from jsonb_array_elements(coalesce(p_milestones, '[]'::jsonb)) as x));
  if v_visibility = 'project' then
    insert into public.milestones as m (project_id, title, due_on, starts_on, hard, done, source, source_key, source_ref)
    select p_project, x ->> 'title', (x ->> 'dueDate')::date, (x ->> 'startDate')::date, coalesce((x ->> 'hard')::boolean, false),
           coalesce((x ->> 'done')::boolean, false), 'markdown', 'md:' || v_doc || ':' || (x ->> 'key'),
           jsonb_build_object('documentId', v_doc, 'path', p_document ->> 'path', 'line', (x ->> 'line')::int, 'origin', x ->> 'origin')
    from jsonb_array_elements(coalesce(p_milestones, '[]'::jsonb)) as x
    on conflict (project_id, source, source_key) do update
      set title = excluded.title, due_on = excluded.due_on, starts_on = excluded.starts_on, hard = excluded.hard,
          done = excluded.done, source_ref = excluded.source_ref;
  end if;

  return v_doc;
end;
$$;

-- A member shows or hides their own synced files in a project. Hiding removes the milestones those files
-- created; showing asks the agent to send them again (their hash is cleared) so milestones come back.
create function public.set_document_sharing(p_project uuid, p_share boolean) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  perform private.require_session();
  update public.project_members set shares_documents = p_share where project_id = p_project and user_id = v_user;
  if not found then
    raise exception 'not a member of this project' using errcode = '42501';
  end if;
  update public.documents
     set visibility = case when p_share then 'project' else 'private' end,
         sha256 = case when p_share then repeat('0', 64) else sha256 end
   where project_id = p_project and owner_id = v_user;
  get diagnostics v_count = row_count;
  if not p_share then
    delete from public.milestones m
    where m.project_id = p_project and m.source = 'markdown'
      and (m.source_ref ->> 'documentId')::uuid in (select id from public.documents where project_id = p_project and owner_id = v_user);
  end if;
  perform public.refresh_project_stats(p_project);
  perform private.audit(case when p_share then 'project.share_files' else 'project.hide_files' end, 'project', p_project::text);
  return v_count;
end;
$$;

revoke all on function public.refresh_project_stats(uuid), public.ingest_document(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.refresh_project_stats(uuid), public.ingest_document(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.set_document_sharing(uuid, boolean) from public, anon;
grant execute on function public.set_document_sharing(uuid, boolean) to authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

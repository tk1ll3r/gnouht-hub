-- M3: projects (with member roles, used by groups in M4), milestones, project tasks, indexed documents,
-- Vietnamese-friendly full-text search and an activity feed.

-- ───────────────────────────── search configuration ─────────────────────────────
-- `simple` + unaccent: "bao cao" matches "Báo cáo" and no language-specific stemming mangles Vietnamese.
create text search configuration public.hub_search (copy = pg_catalog.simple);
alter text search configuration public.hub_search
  alter mapping for hword, hword_part, word with extensions.unaccent, simple;

-- ───────────────────────────── projects & membership ─────────────────────────────

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (char_length(name) between 1 and 100),
  kind text not null default 'personal' check (kind in ('course', 'research', 'ctf', 'personal')),
  description text check (char_length(description) <= 2000),
  course_id uuid references public.courses (id) on delete set null,
  color text not null default '#2458e6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  status text not null default 'active' check (status in ('active', 'done', 'archived')),
  due_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);
create trigger projects_updated_at before update on public.projects
  for each row execute function private.set_updated_at();

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

-- Role lookups for RLS. SECURITY DEFINER avoids recursive RLS on project_members; search_path is empty.
create function private.project_role(p_project uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.project_members where project_id = p_project and user_id = auth.uid();
$$;
create function private.is_project_member(p_project uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.project_members where project_id = p_project and user_id = auth.uid());
$$;
create function private.can_edit_project(p_project uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.project_members where project_id = p_project and user_id = auth.uid() and role in ('owner', 'editor'));
$$;
revoke all on function private.project_role(uuid), private.is_project_member(uuid), private.can_edit_project(uuid) from public, anon;
grant execute on function private.project_role(uuid), private.is_project_member(uuid), private.can_edit_project(uuid) to authenticated, service_role;

-- The creator becomes the owner member automatically.
create function private.add_project_owner() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;
create trigger projects_add_owner after insert on public.projects
  for each row execute function private.add_project_owner();

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
revoke all on public.projects, public.project_members from anon, authenticated;
grant select, insert, delete on public.projects to authenticated;
grant update (slug, name, kind, description, course_id, color, status, due_on) on public.projects to authenticated;
grant select on public.project_members to authenticated;

create policy "members read projects" on public.projects
  for select to authenticated using (private.is_project_member(id));
create policy "users create their own projects" on public.projects
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "owners and editors update projects" on public.projects
  for update to authenticated using (private.can_edit_project(id)) with check (private.can_edit_project(id));
create policy "owners delete projects" on public.projects
  for delete to authenticated using (owner_id = (select auth.uid()));
create policy "members see co-members" on public.project_members
  for select to authenticated using (private.is_project_member(project_id));

-- A linked course must belong to the project owner.
create function private.check_project_course() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.course_id is not null and not exists (select 1 from public.courses where id = new.course_id and user_id = new.owner_id) then
    raise exception 'course does not belong to the project owner' using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger projects_check_course before insert or update of course_id on public.projects
  for each row execute function private.check_project_course();

-- ───────────────────────────── milestones ─────────────────────────────

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  due_on date not null,
  starts_on date,
  hard boolean not null default false,
  done boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'markdown')),
  source_key text check (char_length(source_key) <= 300),
  source_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, source, source_key)
);
alter table public.milestones enable row level security;
revoke all on public.milestones from anon, authenticated;
grant select, delete on public.milestones to authenticated;
grant insert (project_id, title, due_on, starts_on, hard, done) on public.milestones to authenticated;
grant update (title, due_on, starts_on, hard, done) on public.milestones to authenticated;
create policy "members read milestones" on public.milestones
  for select to authenticated using (private.is_project_member(project_id));
create policy "editors add milestones" on public.milestones
  for insert to authenticated with check (private.can_edit_project(project_id) and source = 'manual');
create policy "editors update milestones" on public.milestones
  for update to authenticated using (private.can_edit_project(project_id)) with check (private.can_edit_project(project_id));
create policy "editors delete manual milestones" on public.milestones
  for delete to authenticated using (private.can_edit_project(project_id) and source = 'manual');

-- ───────────────────────────── project tasks ─────────────────────────────

alter table public.tasks add column project_id uuid references public.projects (id) on delete cascade;
alter table public.tasks add column assignee_id uuid references auth.users (id) on delete set null;
create index tasks_project_idx on public.tasks (project_id) where project_id is not null;
grant insert (project_id, assignee_id) on public.tasks to authenticated;
grant update (assignee_id) on public.tasks to authenticated;

-- Personal tasks stay owner-only; project tasks are visible to members and editable by editors.
drop policy "owners read tasks" on public.tasks;
drop policy "owners create manual tasks" on public.tasks;
drop policy "owners update tasks" on public.tasks;
drop policy "owners delete manual tasks" on public.tasks;
create policy "read own or project tasks" on public.tasks
  for select to authenticated
  using (user_id = (select auth.uid()) or (project_id is not null and private.is_project_member(project_id)));
create policy "create manual tasks" on public.tasks
  for insert to authenticated
  with check (user_id = (select auth.uid()) and source = 'manual' and (project_id is null or private.can_edit_project(project_id)));
create policy "update own or project tasks" on public.tasks
  for update to authenticated
  using ((project_id is null and user_id = (select auth.uid())) or (project_id is not null and private.can_edit_project(project_id)))
  with check ((project_id is null and user_id = (select auth.uid())) or (project_id is not null and private.can_edit_project(project_id)));
create policy "delete manual tasks" on public.tasks
  for delete to authenticated
  using (source = 'manual' and ((project_id is null and user_id = (select auth.uid())) or (project_id is not null and private.can_edit_project(project_id))));

-- Assignees must be members of the task's project.
create function private.check_task_project() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null and (new.project_id is null or not exists (
    select 1 from public.project_members where project_id = new.project_id and user_id = new.assignee_id)) then
    raise exception 'assignee must be a project member' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger tasks_check_project before insert or update of assignee_id, project_id on public.tasks
  for each row execute function private.check_task_project();

-- ───────────────────────────── documents ─────────────────────────────

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  device_id uuid not null,
  project_id uuid references public.projects (id) on delete set null,
  path text not null check (char_length(path) between 1 and 1000),
  title text not null check (char_length(title) between 1 and 300),
  ext text not null check (ext ~ '^[a-z0-9]{1,8}$'),
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  modified_at timestamptz not null,
  visibility text not null default 'private' check (visibility in ('private', 'project')),
  excerpt text check (char_length(excerpt) <= 600),
  checklist jsonb check (pg_column_size(checklist) <= 2048),
  storage_path text check (char_length(storage_path) <= 500),
  summary text check (char_length(summary) <= 4000),
  indexed_at timestamptz not null default now(),
  unique (device_id, path),
  foreign key (device_id, owner_id) references public.devices (id, user_id) on delete cascade
);
create index documents_owner_idx on public.documents (owner_id, modified_at desc);
create index documents_project_idx on public.documents (project_id);

create table public.document_chunks (
  document_id uuid not null references public.documents (id) on delete cascade,
  idx integer not null check (idx between 0 and 999),
  content text not null check (char_length(content) <= 4000),
  tsv tsvector generated always as (to_tsvector('public.hub_search', content)) stored,
  primary key (document_id, idx)
);
create index document_chunks_tsv_idx on public.document_chunks using gin (tsv);

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
revoke all on public.documents, public.document_chunks from anon, authenticated;
grant select on public.documents, public.document_chunks to authenticated;
grant update (visibility, project_id) on public.documents to authenticated;

create function private.can_read_document(p_document uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document
      and (d.owner_id = auth.uid() or (d.visibility = 'project' and d.project_id is not null and private.is_project_member(d.project_id)))
  );
$$;
revoke all on function private.can_read_document(uuid) from public, anon;
grant execute on function private.can_read_document(uuid) to authenticated, service_role;

create policy "owners and project members read documents" on public.documents
  for select to authenticated
  using (owner_id = (select auth.uid()) or (visibility = 'project' and project_id is not null and private.is_project_member(project_id)));
create policy "owners share documents with their projects" on public.documents
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (project_id is null or private.is_project_member(project_id)));
create policy "readers read chunks" on public.document_chunks
  for select to authenticated using (private.can_read_document(document_id));

-- Ranked search over everything the caller may read (RLS applies: SECURITY INVOKER).
create function public.search_documents(q text, p_project uuid default null, p_limit integer default 30)
returns table (document_id uuid, title text, path text, project_id uuid, ext text, modified_at timestamptz, snippet text, rank real)
language sql
stable
set search_path = ''
as $$
  with query as (select websearch_to_tsquery('public.hub_search', left(q, 200)) as tsq),
  hits as (
    select c.document_id, c.content, ts_rank(c.tsv, query.tsq) as rank,
           row_number() over (partition by c.document_id order by ts_rank(c.tsv, query.tsq) desc) as n
    from public.document_chunks c, query
    where c.tsv @@ query.tsq
  )
  select d.id, d.title, d.path, d.project_id, d.ext, d.modified_at,
         ts_headline('public.hub_search', h.content, (select tsq from query),
                     'StartSel=«, StopSel=», MaxWords=30, MinWords=12, MaxFragments=2'),
         h.rank
  from hits h
  join public.documents d on d.id = h.document_id
  where h.n = 1 and (p_project is null or d.project_id = p_project)
  order by h.rank desc, d.modified_at desc
  limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function public.search_documents(text, uuid, integer) to authenticated;

-- ───────────────────────────── activity ─────────────────────────────

create table public.activity (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  verb text not null check (char_length(verb) <= 60),
  subject text check (char_length(subject) <= 300),
  at timestamptz not null default now()
);
create index activity_project_idx on public.activity (project_id, at desc);
alter table public.activity enable row level security;
revoke all on public.activity from anon, authenticated;
grant select on public.activity to authenticated;
create policy "members read activity" on public.activity
  for select to authenticated using (private.is_project_member(project_id));

-- Task changes inside projects are recorded automatically.
create function private.log_task_activity() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.source = 'manual' then
    insert into public.activity (project_id, actor_id, verb, subject) values (new.project_id, auth.uid(), 'created task', new.title);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity (project_id, actor_id, verb, subject)
    values (new.project_id, auth.uid(), case new.status when 'done' then 'completed' else 'moved to ' || new.status end, new.title);
  end if;
  return new;
end;
$$;
create trigger tasks_activity after insert or update of status on public.tasks
  for each row execute function private.log_task_activity();

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

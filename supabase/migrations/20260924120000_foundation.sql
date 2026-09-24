-- M1 foundation: personal workspace (profile, semester, courses, timetable, calendars, tasks, briefs),
-- closed registration and an append-only audit log.
--
-- Conventions used in every migration:
--   * RLS is enabled on every table; anon gets nothing; authenticated gets explicit, minimal grants.
--   * Owner consistency is enforced with composite foreign keys (child.user_id = parent.user_id), so
--     even service-role writes cannot link one user's row to another user's parent.
--   * SECURITY DEFINER helpers live in the non-exposed `private` schema with an empty search_path.

create extension if not exists unaccent with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- ───────────────────────────── helpers ─────────────────────────────

create function private.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ───────────────────────────── audit log ─────────────────────────────

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  entity text check (char_length(entity) <= 80),
  entity_id text check (char_length(entity_id) <= 200),
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 8192),
  ip inet
);
create index audit_log_actor_at_idx on public.audit_log (actor_id, at desc);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
create policy "users read their own audit entries" on public.audit_log
  for select to authenticated using (actor_id = (select auth.uid()));

-- Writes go through this function (from triggers or trusted server code); nobody can update or delete rows.
create function private.audit(p_action text, p_entity text, p_entity_id text, p_meta jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb));
end;
$$;
revoke all on function private.audit(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function private.audit(text, text, text, jsonb) to service_role;

-- ───────────────────────────── closed registration ─────────────────────────────

create table public.signup_allowlist (
  email text primary key check (email = lower(email) and email like '%_@_%'),
  note text,
  created_at timestamptz not null default now()
);
alter table public.signup_allowlist enable row level security;
revoke all on public.signup_allowlist from anon, authenticated;
grant select on public.signup_allowlist to supabase_auth_admin;
create policy "auth admin reads the allowlist" on public.signup_allowlist
  for select to supabase_auth_admin using (true);

-- Supabase Auth calls this before creating any user (email, magic link or Google).
-- Returning an `error` object rejects the sign-up. Invites are added to the check in the groups migration.
create function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_email text := lower(event -> 'user' ->> 'email');
begin
  if v_email is not null and exists (select 1 from public.signup_allowlist a where a.email = v_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'Registration is invite-only. Ask the hub owner for an invite.')
  );
end;
$$;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

-- ───────────────────────────── profiles ─────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  timezone text not null default 'Asia/Ho_Chi_Minh' check (char_length(timezone) between 1 and 64),
  day_start time not null default '07:00',
  day_end time not null default '23:00',
  -- UIT class periods: [{"period":1,"start":"07:30","end":"08:15"}, …]; validated by the app.
  period_times jsonb not null default '[
    {"period":1,"start":"07:30","end":"08:15"},{"period":2,"start":"08:15","end":"09:00"},
    {"period":3,"start":"09:00","end":"09:45"},{"period":4,"start":"10:00","end":"10:45"},
    {"period":5,"start":"10:45","end":"11:30"},{"period":6,"start":"13:00","end":"13:45"},
    {"period":7,"start":"13:45","end":"14:30"},{"period":8,"start":"14:30","end":"15:15"},
    {"period":9,"start":"15:30","end":"16:15"},{"period":10,"start":"16:15","end":"17:00"}
  ]'::jsonb check (jsonb_typeof(period_times) = 'array' and jsonb_array_length(period_times) <= 20),
  busy_buffer_minutes smallint not null default 10 check (busy_buffer_minutes between 0 and 120),
  email_digest boolean not null default true,
  ai_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (day_end > day_start)
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, timezone, day_start, day_end, period_times, busy_buffer_minutes, email_digest, ai_consent_at)
  on public.profiles to authenticated;
create policy "users read their profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "users update their profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), ''), 80)
  );
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ───────────────────────────── semesters & courses ─────────────────────────────

create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  -- Dates without classes (holidays, exam weeks).
  skip_dates date[] not null default '{}' check (cardinality(skip_dates) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (ends_on > starts_on and ends_on - starts_on <= 366)
);
create unique index semesters_one_current_idx on public.semesters (user_id) where is_current;
create trigger semesters_updated_at before update on public.semesters
  for each row execute function private.set_updated_at();

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  semester_id uuid not null,
  code text not null check (code ~ '^[A-Za-z0-9._-]{2,20}$'),
  class_code text check (char_length(class_code) <= 40),
  name text not null check (char_length(name) between 1 and 160),
  credits smallint check (credits between 0 and 20),
  lecturer text check (char_length(lecturer) <= 120),
  room text check (char_length(room) <= 60),
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- Importance multiplier used when ranking this course's deadlines.
  weight numeric(3, 1) not null default 1.0 check (weight between 0.5 and 3.0),
  moodle_course_id bigint,
  url text check (url ~ '^https://' and char_length(url) <= 500),
  source text not null default 'manual' check (source in ('manual', 'moodle', 'portal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (semester_id, code, class_code),
  foreign key (semester_id, user_id) references public.semesters (id, user_id) on delete cascade
);
create index courses_user_idx on public.courses (user_id, semester_id);
create trigger courses_updated_at before update on public.courses
  for each row execute function private.set_updated_at();

create table public.course_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  period_start smallint check (period_start between 1 and 20),
  period_end smallint check (period_end between 1 and 20),
  start_time time,
  end_time time,
  starts_on date, -- null = semester start
  ends_on date, -- null = semester end
  week_interval smallint not null default 1 check (week_interval between 1 and 4),
  room text check (char_length(room) <= 60),
  kind text not null default 'lecture' check (kind in ('lecture', 'lab', 'exam', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (course_id, user_id) references public.courses (id, user_id) on delete cascade,
  check (
    (period_start is not null and period_end is not null and period_end >= period_start)
    or (start_time is not null and end_time is not null and end_time > start_time)
  ),
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);
create index course_sessions_course_idx on public.course_sessions (course_id);
create trigger course_sessions_updated_at before update on public.course_sessions
  for each row execute function private.set_updated_at();

-- Owners manage their own semester data end to end.
do $$
declare
  t text;
begin
  foreach t in array array['semesters', 'courses', 'course_sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format(
      'create policy "owners manage %1$s" on public.%1$I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- ───────────────────────────── calendars ─────────────────────────────

create table public.calendar_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('google', 'ics')),
  -- `moodle` feeds become tasks (deadlines); everything else becomes busy/free events.
  flavor text not null default 'generic' check (flavor in ('generic', 'google', 'moodle')),
  name text not null check (char_length(name) between 1 and 80),
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  enabled boolean not null default true,
  account_label text check (char_length(account_label) <= 200),
  scope text check (char_length(scope) <= 500),
  -- Google: [{"id": "...", "summary": "...", "selected": true}]
  calendars jsonb not null default '[]'::jsonb check (jsonb_typeof(calendars) = 'array'),
  status text not null default 'active' check (status in ('active', 'error', 'revoked')),
  last_synced_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  sync_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create trigger calendar_sources_updated_at before update on public.calendar_sources
  for each row execute function private.set_updated_at();
alter table public.calendar_sources enable row level security;
revoke all on public.calendar_sources from anon, authenticated;
-- Created only by the server after OAuth or URL validation; users may rename, recolour, toggle or delete.
grant select, delete on public.calendar_sources to authenticated;
grant update (name, color, enabled, calendars) on public.calendar_sources to authenticated;
create policy "owners read calendar sources" on public.calendar_sources
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owners edit calendar sources" on public.calendar_sources
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owners delete calendar sources" on public.calendar_sources
  for delete to authenticated using (user_id = (select auth.uid()));

-- Encrypted credentials (Google refresh tokens, secret iCal URLs). No policies: invisible to every API role.
create table public.integration_secrets (
  source_id uuid primary key,
  user_id uuid not null,
  ciphertext text not null check (char_length(ciphertext) <= 8192),
  key_version smallint not null default 1,
  updated_at timestamptz not null default now(),
  foreign key (source_id, user_id) references public.calendar_sources (id, user_id) on delete cascade
);
alter table public.integration_secrets enable row level security;
revoke all on public.integration_secrets from anon, authenticated;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_id uuid not null,
  external_id text not null check (char_length(external_id) <= 1024),
  calendar_id text check (char_length(calendar_id) <= 1024),
  title text not null default '(no title)' check (char_length(title) <= 500),
  location text check (char_length(location) <= 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  busy boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (source_id, external_id),
  foreign key (source_id, user_id) references public.calendar_sources (id, user_id) on delete cascade,
  check (ends_at >= starts_at)
);
create index events_user_time_idx on public.events (user_id, starts_at);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
grant select on public.events to authenticated;
create policy "owners read events" on public.events
  for select to authenticated using (user_id = (select auth.uid()));

-- ───────────────────────────── tasks ─────────────────────────────

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  notes text check (char_length(notes) <= 5000),
  kind text not null default 'task' check (kind in ('task', 'assignment', 'quiz', 'exam', 'report', 'milestone')),
  status text not null default 'todo' check (status in ('todo', 'doing', 'attention', 'done', 'cut')),
  due_at timestamptz,
  estimate_hours numeric(5, 2) check (estimate_hours > 0 and estimate_hours <= 500),
  progress numeric(4, 3) not null default 0 check (progress between 0 and 1),
  source text not null default 'manual' check (source in ('manual', 'moodle', 'markdown')),
  source_key text check (char_length(source_key) <= 300),
  -- Where a synced task came from: {"url": …} for Moodle, {"path": …, "line": …, "section": …} for Markdown.
  source_ref jsonb not null default '{}'::jsonb check (pg_column_size(source_ref) <= 4096),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, source_key),
  foreign key (course_id, user_id) references public.courses (id, user_id) on delete set null (course_id),
  check ((source = 'manual') = (source_key is null))
);
create index tasks_open_idx on public.tasks (user_id, due_at) where status not in ('done', 'cut');
create trigger tasks_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

create function private.tasks_completed_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' then
    -- OLD is only defined for UPDATE, so branch on the operation instead of relying on short-circuiting.
    if tg_op = 'INSERT' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status is distinct from 'done' then
      new.completed_at := now();
    end if;
    new.progress := 1;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger tasks_completed_at before insert or update of status on public.tasks
  for each row execute function private.tasks_completed_at();

alter table public.tasks enable row level security;
revoke all on public.tasks from anon, authenticated;
grant select, delete on public.tasks to authenticated;
grant insert (course_id, title, notes, kind, status, due_at, estimate_hours, progress) on public.tasks to authenticated;
grant update (course_id, title, notes, kind, status, due_at, estimate_hours, progress) on public.tasks to authenticated;
create policy "owners read tasks" on public.tasks
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owners create manual tasks" on public.tasks
  for insert to authenticated with check (user_id = (select auth.uid()) and source = 'manual');
create policy "owners update tasks" on public.tasks
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Synced tasks come back on the next sync, so only manual ones can be deleted (synced ones can be cut).
create policy "owners delete manual tasks" on public.tasks
  for delete to authenticated using (user_id = (select auth.uid()) and source = 'manual');

-- ───────────────────────────── briefs ─────────────────────────────

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  for_date date not null,
  kind text not null check (kind in ('heuristic', 'ai')),
  headline text not null check (char_length(headline) <= 500),
  markdown text not null check (char_length(markdown) <= 20000),
  created_at timestamptz not null default now(),
  unique (user_id, for_date, kind)
);
alter table public.briefs enable row level security;
revoke all on public.briefs from anon, authenticated;
grant select on public.briefs to authenticated;
create policy "owners read briefs" on public.briefs
  for select to authenticated using (user_id = (select auth.uid()));

-- ───────────────────────────── service role ─────────────────────────────

-- Trusted server code (cron sync, agent ingestion) uses the service role, which bypasses RLS.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

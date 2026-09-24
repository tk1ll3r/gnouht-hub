-- M4: study groups, email-bound invites (which are also the only way past closed registration besides
-- the allow-list), read-only project sharing with project-scoped RLS, and opt-in free/busy sharing.
--
-- Membership checks live in SECURITY DEFINER helpers so policies on one table never recurse through
-- policies on another. Set-returning helpers are wrapped in (select …) so Postgres evaluates them once
-- per statement instead of once per row.

-- ───────────────────────────── tables ─────────────────────────────

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 1000),
  color text not null default '#0f9d8a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger groups_updated_at before update on public.groups
  for each row execute function private.set_updated_at();

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  -- Opt-in: when true, the group's free-time finder counts this member's busy blocks (never their titles).
  share_busy boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  -- sha256 of the link token; the token itself is shown once to the inviter and emailed to the invitee.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index group_invites_email_idx on public.group_invites (email) where accepted_at is null and revoked_at is null;
create index group_invites_group_idx on public.group_invites (group_id);

create table public.project_shares (
  project_id uuid not null references public.projects (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  shared_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, group_id)
);
create index project_shares_group_idx on public.project_shares (group_id);

-- ───────────────────────────── helpers ─────────────────────────────

create function private.my_group_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select group_id from public.group_members where user_id = (select auth.uid());
$$;

create function private.is_group_owner(p_group uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = (select auth.uid()) and role = 'owner');
$$;

create function private.my_email() returns text
language sql stable security definer set search_path = ''
as $$
  select lower(email) from auth.users where id = (select auth.uid());
$$;

-- Groups with a live invite addressed to the caller (so the invite page can show the group's name).
create function private.invited_group_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select group_id from public.group_invites
  where email = private.my_email() and accepted_at is null and revoked_at is null and expires_at > now();
$$;

-- Projects other people shared with a group the caller belongs to.
create function private.shared_project_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select s.project_id
  from public.project_shares s
  join public.group_members m on m.group_id = s.group_id
  where m.user_id = (select auth.uid());
$$;

revoke all on function private.my_group_ids(), private.is_group_owner(uuid), private.my_email(),
  private.invited_group_ids(), private.shared_project_ids() from public, anon;
grant execute on function private.my_group_ids(), private.is_group_owner(uuid), private.my_email(),
  private.invited_group_ids(), private.shared_project_ids() to authenticated, service_role;

-- ───────────────────────────── group policies ─────────────────────────────

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.project_shares enable row level security;
revoke all on public.groups, public.group_members, public.group_invites, public.project_shares from anon, authenticated;

grant select, delete on public.groups to authenticated;
grant update (name, description, color) on public.groups to authenticated;
create policy "members and invitees read groups" on public.groups
  for select to authenticated
  using (id in (select private.my_group_ids()) or id in (select private.invited_group_ids()));
create policy "owners edit groups" on public.groups
  for update to authenticated using (private.is_group_owner(id)) with check (private.is_group_owner(id));
create policy "owners delete groups" on public.groups
  for delete to authenticated using (private.is_group_owner(id));

grant select, delete on public.group_members to authenticated;
grant update (share_busy) on public.group_members to authenticated;
create policy "members read the roster" on public.group_members
  for select to authenticated using (group_id in (select private.my_group_ids()));
create policy "members change their own sharing" on public.group_members
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "members leave, owners remove" on public.group_members
  for delete to authenticated using (user_id = (select auth.uid()) or private.is_group_owner(group_id));

-- The token hash is never readable through the API.
grant select (id, group_id, email, invited_by, expires_at, accepted_by, accepted_at, revoked_at, created_at) on public.group_invites to authenticated;
grant update (revoked_at) on public.group_invites to authenticated;
create policy "owners and invitees read invites" on public.group_invites
  for select to authenticated using (private.is_group_owner(group_id) or email = private.my_email());
create policy "owners revoke invites" on public.group_invites
  for update to authenticated using (private.is_group_owner(group_id)) with check (private.is_group_owner(group_id));

grant select, insert, delete on public.project_shares to authenticated;
create policy "members read shares" on public.project_shares
  for select to authenticated using (shared_by = (select auth.uid()) or group_id in (select private.my_group_ids()));
create policy "owners share their projects with their groups" on public.project_shares
  for insert to authenticated
  with check (
    shared_by = (select auth.uid())
    and group_id in (select private.my_group_ids())
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
create policy "sharers and group owners unshare" on public.project_shares
  for delete to authenticated using (shared_by = (select auth.uid()) or private.is_group_owner(group_id));

-- A group always keeps an owner: the last one cannot leave or be removed (deleting the group still works,
-- because the cascade runs after the group row is gone).
create function private.keep_group_owner() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'owner'
     and exists (select 1 from public.groups where id = old.group_id)
     and not exists (select 1 from public.group_members where group_id = old.group_id and role = 'owner' and user_id <> old.user_id) then
    raise exception 'the last owner cannot leave the group; delete the group instead' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
create trigger group_members_keep_owner before delete on public.group_members
  for each row execute function private.keep_group_owner();

-- Leaving a group withdraws the projects you shared with it.
create function private.unshare_on_leave() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.project_shares where group_id = old.group_id and shared_by = old.user_id;
  return old;
end;
$$;
create trigger group_members_unshare after delete on public.group_members
  for each row execute function private.unshare_on_leave();

-- ───────────────────────────── project-scoped reads ─────────────────────────────

drop policy "owners read projects" on public.projects;
create policy "owners and group members read projects" on public.projects
  for select to authenticated
  using (user_id = (select auth.uid()) or id in (select private.shared_project_ids()));

do $$
declare
  t text;
begin
  foreach t in array array['project_documents', 'checklist_items', 'document_chunks', 'project_progress_daily'] loop
    execute format('drop policy "owners read %1$s" on public.%1$I', t);
    execute format(
      'create policy "owners and group members read %1$s" on public.%1$I for select to authenticated
         using (user_id = (select auth.uid()) or project_id in (select private.shared_project_ids()))', t);
  end loop;
end;
$$;

-- Deadlines of shared projects are visible (read-only) to the group.
drop policy "owners read tasks" on public.tasks;
create policy "owners and group members read tasks" on public.tasks
  for select to authenticated
  using (user_id = (select auth.uid()) or (project_id is not null and project_id in (select private.shared_project_ids())));

-- ───────────────────────────── RPCs ─────────────────────────────

create function public.create_group(p_name text, p_description text default null, p_color text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_group uuid;
begin
  if v_user is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if (select count(*) from public.group_members where user_id = v_user) >= 20 then
    raise exception 'you are already in 20 groups' using errcode = 'P0001';
  end if;
  insert into public.groups (name, description, color, created_by)
  values (trim(p_name), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_color, '#0f9d8a'), v_user)
  returning id into v_group;
  insert into public.group_members (group_id, user_id, role) values (v_group, v_user, 'owner');
  perform private.audit('group.create', 'group', v_group::text);
  return v_group;
end;
$$;

-- Returns the one-time link token. Invites are bound to an email address; creating one lets that address
-- register (see the sign-up hook) and join this group only.
create function public.create_group_invite(p_group uuid, p_email text, p_days integer default 7)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(trim(p_email));
  v_token text;
begin
  if v_user is null or not private.is_group_owner(p_group) then
    raise exception 'only group owners can invite' using errcode = '42501';
  end if;
  if not public.hit_rate_limit('invite:' || v_user, 30, 3600) then
    raise exception 'too many invites, try again later' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.group_members m join auth.users u on u.id = m.user_id
             where m.group_id = p_group and lower(u.email) = v_email) then
    raise exception 'already a member' using errcode = '23505';
  end if;
  if (select count(*) from public.group_invites
      where group_id = p_group and accepted_at is null and revoked_at is null and expires_at > now()) >= 50 then
    raise exception 'too many pending invites' using errcode = 'P0001';
  end if;
  -- A new invite replaces any pending one for the same address.
  update public.group_invites set revoked_at = now()
  where group_id = p_group and email = v_email and accepted_at is null and revoked_at is null;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');
  insert into public.group_invites (group_id, email, token_hash, invited_by, expires_at)
  values (p_group, v_email, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_user,
          now() + make_interval(days => least(greatest(coalesce(p_days, 7), 1), 14)));
  perform private.audit('group.invite', 'group', p_group::text, jsonb_build_object('email', v_email));
  return v_token;
end;
$$;

-- Joins the group of a live invite addressed to the caller's own email.
create function public.accept_group_invite(p_invite uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_invite public.group_invites%rowtype;
begin
  if v_user is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into v_invite from public.group_invites where id = p_invite for update;
  if not found or v_invite.revoked_at is not null or v_invite.accepted_at is not null or v_invite.expires_at <= now() then
    raise exception 'this invite is no longer valid' using errcode = 'P0002';
  end if;
  if v_invite.email is distinct from private.my_email() then
    raise exception 'this invite was sent to another address' using errcode = '42501';
  end if;
  if (select count(*) from public.group_members where group_id = v_invite.group_id) >= 30 then
    raise exception 'the group is full' using errcode = 'P0001';
  end if;
  insert into public.group_members (group_id, user_id, role) values (v_invite.group_id, v_user, 'member')
  on conflict do nothing;
  update public.group_invites set accepted_by = v_user, accepted_at = now() where id = p_invite;
  perform private.audit('group.join', 'group', v_invite.group_id::text);
  return v_invite.group_id;
end;
$$;

-- Display names and roles of a group's members, for members only. Emails and other profile fields stay private.
create function public.group_roster(p_group uuid)
returns table (user_id uuid, display_name text, role text, share_busy boolean, joined_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, coalesce(nullif(p.display_name, ''), 'Member'), m.role, m.share_busy, m.joined_at
  from public.group_members m
  left join public.profiles p on p.id = m.user_id
  where m.group_id = p_group
    and exists (select 1 from public.group_members me where me.group_id = p_group and me.user_id = (select auth.uid()))
  order by m.role = 'owner' desc, m.joined_at;
$$;

revoke all on function public.create_group(text, text, text), public.create_group_invite(uuid, text, integer),
  public.accept_group_invite(uuid), public.group_roster(uuid) from public, anon;
grant execute on function public.create_group(text, text, text), public.create_group_invite(uuid, text, integer),
  public.accept_group_invite(uuid), public.group_roster(uuid) to authenticated;

-- ───────────────────────────── closed registration + invites ─────────────────────────────

create or replace function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(event -> 'user' ->> 'email');
begin
  if v_email is not null and (
    exists (select 1 from public.signup_allowlist a where a.email = v_email)
    or exists (select 1 from public.group_invites i
               where i.email = v_email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'Registration is invite-only. Ask the hub owner for an invite.')
  );
end;
$$;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- M4: study groups and team projects.
--
-- * Groups (optionally for a course, e.g. "NT219.Q11") with email-bound invites, which are also the only
--   way past closed registration besides the allow-list, and opt-in free/busy sharing.
-- * A project can be run by a group: linking them makes every group member a project member with a default
--   role (members who join later are added, members who leave are removed). The project owner (team lead)
--   changes roles per person: editor (can plan and assign) or viewer (reads, works on their own tasks).
-- * Per-task permissions: each project task has an assignee and a permission level.
--     team      owner, editors and the assignee may change it (default)
--     assignee  only the assignee (and the owner) may change it
--     owner     locked: only the project owner may change it
--   An assignee who is not an editor may update status, progress, notes and the estimate of their own task,
--   nothing else; only the owner changes a task's permission level.
--
-- Membership checks live in SECURITY DEFINER helpers so policies never recurse through each other.

-- ───────────────────────────── groups ─────────────────────────────

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 1000),
  -- The class this group studies together, as UIT writes it ("NT219.Q11"); free text, optional.
  course_code text check (char_length(course_code) <= 40),
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

-- A project run by a group, and the role new members get.
create table public.project_groups (
  project_id uuid not null references public.projects (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  default_role text not null default 'viewer' check (default_role in ('editor', 'viewer')),
  linked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, group_id)
);
create index project_groups_group_idx on public.project_groups (group_id);

-- Which group brought a member into a project (null: added directly), so unlinking removes only them.
alter table public.project_members add column via_group uuid;

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

-- Whether the caller may change a task, from its project, creator, assignee and permission level.
create function private.can_change_task(p_project uuid, p_creator uuid, p_assignee uuid, p_permission text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when p_project is null then p_creator = (select auth.uid())
    else coalesce(private.project_role(p_project) = 'owner', false)
      or (p_permission = 'team' and (private.can_edit_project(p_project) or p_assignee = (select auth.uid())))
      or (p_permission = 'assignee' and p_assignee = (select auth.uid()))
  end;
$$;

revoke all on function private.my_group_ids(), private.is_group_owner(uuid), private.my_email(),
  private.invited_group_ids(), private.can_change_task(uuid, uuid, uuid, text) from public, anon;
grant execute on function private.my_group_ids(), private.is_group_owner(uuid), private.my_email(),
  private.invited_group_ids(), private.can_change_task(uuid, uuid, uuid, text) to authenticated, service_role;

-- ───────────────────────────── group policies ─────────────────────────────

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.project_groups enable row level security;
revoke all on public.groups, public.group_members, public.group_invites, public.project_groups from anon, authenticated;

grant select, delete on public.groups to authenticated;
grant update (name, description, course_code, color) on public.groups to authenticated;
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

-- Links are made and removed through RPCs; members of either side can see them.
grant select on public.project_groups to authenticated;
create policy "project and group members read links" on public.project_groups
  for select to authenticated
  using (private.is_project_member(project_id) or group_id in (select private.my_group_ids()));

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

-- ───────────────────────────── group ↔ project membership ─────────────────────────────

create function private.sync_linked_group() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_members (project_id, user_id, role, via_group)
    select new.project_id, m.user_id, new.default_role, new.group_id
    from public.group_members m where m.group_id = new.group_id
    on conflict (project_id, user_id) do nothing;
    return new;
  end if;
  delete from public.project_members
  where project_id = old.project_id and via_group = old.group_id and role <> 'owner';
  return old;
end;
$$;
create trigger project_groups_sync after insert or delete on public.project_groups
  for each row execute function private.sync_linked_group();

create function private.sync_group_member() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_members (project_id, user_id, role, via_group)
    select l.project_id, new.user_id, l.default_role, l.group_id
    from public.project_groups l where l.group_id = new.group_id
    on conflict (project_id, user_id) do nothing;
    return new;
  end if;
  delete from public.project_members
  where user_id = old.user_id and via_group = old.group_id and role <> 'owner';
  return old;
end;
$$;
create trigger group_members_sync_projects after insert or delete on public.group_members
  for each row execute function private.sync_group_member();

-- Someone leaving a project stops being the assignee of its tasks.
create function private.unassign_on_leave() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.tasks set assignee_id = null where project_id = old.project_id and assignee_id = old.user_id;
  return old;
end;
$$;
create trigger project_members_unassign after delete on public.project_members
  for each row execute function private.unassign_on_leave();

-- ───────────────────────────── per-task permissions ─────────────────────────────

alter table public.tasks
  add column permission text not null default 'team' check (permission in ('team', 'assignee', 'owner'));
grant insert (permission), update (permission) on public.tasks to authenticated;

drop policy "update own or project tasks" on public.tasks;
create policy "change tasks the caller may change" on public.tasks
  for update to authenticated
  using (private.can_change_task(project_id, user_id, assignee_id, permission))
  with check (private.can_change_task(project_id, user_id, assignee_id, permission));

drop policy "delete manual tasks" on public.tasks;
create policy "delete manual tasks the caller may change" on public.tasks
  for delete to authenticated
  using (source = 'manual' and (
    (project_id is null and user_id = (select auth.uid()))
    or (project_id is not null and (
      private.project_role(project_id) = 'owner' or (permission = 'team' and private.can_edit_project(project_id))))));

-- Column rules RLS cannot express: an assignee who is not an editor changes only the progress of their own
-- work, and only the owner restricts or unlocks a task.
create function private.guard_task_permissions() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
begin
  -- Server code (no signed-in user) and our own maintenance triggers (nested) are trusted.
  if (select auth.uid()) is null or new.project_id is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' or old.project_id is distinct from new.project_id then
    if new.permission <> 'team' and private.project_role(new.project_id) is distinct from 'owner' then
      raise exception 'only the project owner can restrict a task' using errcode = '42501';
    end if;
    return new;
  end if;
  v_role := private.project_role(old.project_id);
  if v_role = 'owner' then
    return new;
  end if;
  if new.permission is distinct from old.permission then
    raise exception 'only the project owner changes who may edit a task' using errcode = '42501';
  end if;
  if v_role = 'editor' and old.permission = 'team' then
    return new;
  end if;
  if (new.title, new.kind, new.due_at, new.assignee_id, new.course_id)
     is distinct from (old.title, old.kind, old.due_at, old.assignee_id, old.course_id) then
    raise exception 'as the assignee you can update status, progress, notes and the estimate' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger tasks_guard_permissions before insert or update on public.tasks
  for each row execute function private.guard_task_permissions();

-- Assignments show up in the project's activity feed.
create function private.log_task_assignment() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.project_id is null or new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;
  insert into public.activity (project_id, actor_id, verb, subject)
  values (new.project_id, (select auth.uid()),
          case when new.assignee_id is null then 'unassigned'
               else left('assigned to ' || coalesce((select nullif(display_name, '') from public.profiles where id = new.assignee_id), 'a member'), 60) end,
          new.title);
  return new;
end;
$$;
create trigger tasks_log_assignment after update of assignee_id on public.tasks
  for each row execute function private.log_task_assignment();

-- ───────────────────────────── RPCs: groups ─────────────────────────────

create function public.create_group(p_name text, p_description text default null, p_color text default null, p_course_code text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_group uuid;
begin
  perform private.require_session();
  if v_user is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if (select count(*) from public.group_members where user_id = v_user) >= 20 then
    raise exception 'you are already in 20 groups' using errcode = 'P0001';
  end if;
  insert into public.groups (name, description, course_code, color, created_by)
  values (trim(p_name), nullif(trim(coalesce(p_description, '')), ''), nullif(upper(trim(coalesce(p_course_code, ''))), ''),
          coalesce(p_color, '#0f9d8a'), v_user)
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
  perform private.require_session();
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
  perform private.require_session();
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
    and (select private.session_allowed())
  order by m.role = 'owner' desc, m.joined_at;
$$;

-- ───────────────────────────── RPCs: team projects ─────────────────────────────

-- The project owner hands the project to a group they belong to; every member joins with default_role.
create function public.link_group_project(p_project uuid, p_group uuid, p_role text default 'viewer') returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_session();
  if private.project_role(p_project) is distinct from 'owner' then
    raise exception 'only the project owner can add a group' using errcode = '42501';
  end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = (select auth.uid())) then
    raise exception 'you are not in that group' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'role must be editor or viewer' using errcode = '22023';
  end if;
  insert into public.project_groups (project_id, group_id, default_role, linked_by)
  values (p_project, p_group, p_role, (select auth.uid()))
  on conflict (project_id, group_id) do update set default_role = excluded.default_role;
  insert into public.activity (project_id, actor_id, verb, subject)
  values (p_project, (select auth.uid()), 'added group', (select name from public.groups where id = p_group));
  perform private.audit('project.link_group', 'project', p_project::text, jsonb_build_object('group', p_group));
end;
$$;

create function public.unlink_group_project(p_project uuid, p_group uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_session();
  if private.project_role(p_project) is distinct from 'owner' and not private.is_group_owner(p_group) then
    raise exception 'only the project owner or the group owner can remove the link' using errcode = '42501';
  end if;
  delete from public.project_groups where project_id = p_project and group_id = p_group;
  perform private.audit('project.unlink_group', 'project', p_project::text, jsonb_build_object('group', p_group));
end;
$$;

-- Members of a project with display names, roles and how they joined, for members only.
create function public.project_roster(p_project uuid)
returns table (user_id uuid, display_name text, role text, via_group uuid, shares_documents boolean, joined_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, coalesce(nullif(p.display_name, ''), 'Member'), m.role, m.via_group, m.shares_documents, m.joined_at
  from public.project_members m
  left join public.profiles p on p.id = m.user_id
  where m.project_id = p_project and private.is_project_member(p_project) and (select private.session_allowed())
  order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, m.joined_at;
$$;

-- The owner makes a member an editor or a viewer. Ownership itself is not changed here.
create function public.set_project_member_role(p_project uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_session();
  if private.project_role(p_project) is distinct from 'owner' then
    raise exception 'only the project owner changes roles' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'role must be editor or viewer' using errcode = '22023';
  end if;
  update public.project_members set role = p_role where project_id = p_project and user_id = p_user and role <> 'owner';
  if not found then
    raise exception 'no such member (the owner keeps the owner role)' using errcode = 'P0002';
  end if;
  insert into public.activity (project_id, actor_id, verb, subject)
  values (p_project, (select auth.uid()), 'made ' || p_role,
          (select coalesce(nullif(display_name, ''), 'Member') from public.profiles where id = p_user));
  perform private.audit('project.set_role', 'project', p_project::text, jsonb_build_object('member', p_user, 'role', p_role));
end;
$$;

-- The owner adds someone who shares a group with them (so members cannot be looked up by email here).
create function public.add_project_member(p_project uuid, p_user uuid, p_role text default 'viewer') returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_session();
  if private.project_role(p_project) is distinct from 'owner' then
    raise exception 'only the project owner adds members' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'role must be editor or viewer' using errcode = '22023';
  end if;
  if not exists (select 1 from public.group_members a join public.group_members b on b.group_id = a.group_id
                 where a.user_id = (select auth.uid()) and b.user_id = p_user) then
    raise exception 'you can add people from your groups only' using errcode = '42501';
  end if;
  if (select count(*) from public.project_members where project_id = p_project) >= 50 then
    raise exception 'a project has at most 50 members' using errcode = 'P0001';
  end if;
  insert into public.project_members (project_id, user_id, role) values (p_project, p_user, p_role)
  on conflict (project_id, user_id) do nothing;
  perform private.audit('project.add_member', 'project', p_project::text, jsonb_build_object('member', p_user));
end;
$$;

-- The owner removes a member, or a member leaves. The owner cannot leave their own project.
create function public.remove_project_member(p_project uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_session();
  if p_user <> (select auth.uid()) and private.project_role(p_project) is distinct from 'owner' then
    raise exception 'only the project owner removes members' using errcode = '42501';
  end if;
  delete from public.project_members where project_id = p_project and user_id = p_user and role <> 'owner';
  if not found then
    raise exception 'no such member (the owner cannot leave; delete the project instead)' using errcode = 'P0002';
  end if;
  perform private.audit('project.remove_member', 'project', p_project::text, jsonb_build_object('member', p_user));
end;
$$;

revoke all on function public.create_group(text, text, text, text), public.create_group_invite(uuid, text, integer),
  public.accept_group_invite(uuid), public.group_roster(uuid), public.link_group_project(uuid, uuid, text),
  public.unlink_group_project(uuid, uuid), public.project_roster(uuid), public.set_project_member_role(uuid, uuid, text),
  public.add_project_member(uuid, uuid, text), public.remove_project_member(uuid, uuid) from public, anon;
grant execute on function public.create_group(text, text, text, text), public.create_group_invite(uuid, text, integer),
  public.accept_group_invite(uuid), public.group_roster(uuid), public.link_group_project(uuid, uuid, text),
  public.unlink_group_project(uuid, uuid), public.project_roster(uuid), public.set_project_member_role(uuid, uuid, text),
  public.add_project_member(uuid, uuid, text), public.remove_project_member(uuid, uuid) to authenticated;

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

-- M6: sessions checked by the database, two-step sign-in it enforces, and account deletion that keeps
-- groups intact.
--
-- Every table and every callable SECURITY DEFINER function requires
--   * a live session: the JWT's session must still exist in auth.sessions, so "sign out everywhere"
--     (or a revoked session) stops data access at once instead of when the access token expires; and
--   * once the user has a verified TOTP factor, an aal2 session whose code went through the hub's own
--     rate-limited form. Supabase Auth does not limit TOTP guesses per account (one challenge accepts
--     any number of attempts), so an aal2 session obtained by guessing codes directly against Auth is
--     not enough: only the hub marks sessions in private.mfa_sessions, after at most 8 tries per
--     10 minutes.

create table private.mfa_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  verified_at timestamptz not null default now()
);
alter table private.mfa_sessions enable row level security;

create function private.session_state() returns text
language sql stable security definer set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid,
           nullif((select auth.jwt()) ->> 'session_id', '')::uuid as sid,
           coalesce((select auth.jwt()) ->> 'aal', 'aal1') as aal
  )
  select case
    when not exists (
      select 1 from me join auth.sessions s on s.id = me.sid and s.user_id = me.uid
      where s.not_after is null or s.not_after > now()
    ) then 'ended'
    when not exists (select 1 from me join auth.mfa_factors f on f.user_id = me.uid where f.status = 'verified') then 'ok'
    when (select aal from me) = 'aal2'
     and exists (select 1 from me join private.mfa_sessions m on m.session_id = me.sid and m.user_id = me.uid) then 'ok'
    else 'mfa'
  end
  from me;
$$;

create function private.session_allowed() returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.session_state() = 'ok';
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
revoke all on function private.session_state(), private.session_allowed(), private.require_session() from public, anon;
grant execute on function private.session_state(), private.session_allowed(), private.require_session() to authenticated, service_role;

-- For the web app: 'ok', 'mfa' (the TOTP step is still needed) or 'ended' (the session was revoked).
create function public.session_status() returns text
language sql stable security definer set search_path = ''
as $$
  select private.session_state();
$$;
revoke all on function public.session_status() from public, anon;
grant execute on function public.session_status() to authenticated;

-- Called by the hub (service role) right after its rate-limited form verified a TOTP code.
create function public.mark_mfa_session(p_user uuid, p_session uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from auth.sessions where id = p_session and user_id = p_user and aal = 'aal2') then
    return false;
  end if;
  insert into private.mfa_sessions (session_id, user_id) values (p_session, p_user)
  on conflict (session_id) do update set verified_at = now();
  return true;
end;
$$;
revoke all on function public.mark_mfa_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_mfa_session(uuid, uuid) to service_role;

-- Restrictive policies are ANDed with the permissive ones on every table the API can reach.
do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format(
      'create policy "live session, two-step when enrolled" on public.%I as restrictive for all to authenticated
         using ((select private.session_allowed())) with check ((select private.session_allowed()))', t);
  end loop;
end;
$$;

-- SECURITY DEFINER functions bypass RLS, so the ones users can call check it themselves.
create or replace function public.create_group(p_name text, p_description text default null, p_color text default null)
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
  insert into public.groups (name, description, color, created_by)
  values (trim(p_name), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_color, '#0f9d8a'), v_user)
  returning id into v_group;
  insert into public.group_members (group_id, user_id, role) values (v_group, v_user, 'owner');
  perform private.audit('group.create', 'group', v_group::text);
  return v_group;
end;
$$;
create or replace function public.create_group_invite(p_group uuid, p_email text, p_days integer default 7)
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
create or replace function public.accept_group_invite(p_invite uuid) returns uuid
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
create or replace function public.group_roster(p_group uuid)
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

create or replace function public.cancel_ai_job(p_job uuid) returns boolean
language sql security definer set search_path = ''
as $$
  with c as (
    update public.ai_jobs set status = 'cancelled', finished_at = now(), messages = '[]'::jsonb
    where id = p_job and user_id = (select auth.uid()) and status = 'queued' and (select private.session_allowed())
    returning 1)
  select exists (select 1 from c);
$$;

-- Before an account is deleted: groups it owns pass to the longest-standing member, or are deleted when
-- nobody else is in them (the last-owner guard would otherwise block the cascade).
create function public.prepare_account_deletion(p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  g record;
  v_heir uuid;
begin
  for g in select group_id from public.group_members where user_id = p_user and role = 'owner' loop
    if exists (select 1 from public.group_members where group_id = g.group_id and role = 'owner' and user_id <> p_user) then
      continue;
    end if;
    select user_id into v_heir from public.group_members
     where group_id = g.group_id and user_id <> p_user order by joined_at limit 1;
    if v_heir is null then
      delete from public.groups where id = g.group_id;
    else
      update public.group_members set role = 'owner' where group_id = g.group_id and user_id = v_heir;
    end if;
  end loop;
end;
$$;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

-- Marks for sessions that no longer exist are dropped with the rest of the housekeeping.
create or replace function private.prune_agent_data() returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.quota_snapshots where captured_at < now() - interval '14 days';
  delete from public.agent_nonces where seen_at < now() - interval '10 minutes';
  delete from public.device_pairing_codes where expires_at < now() - interval '1 day';
  delete from public.rate_limits where window_start < now() - interval '1 day';
  delete from public.ai_jobs where created_at < now() - interval '30 days';
  delete from private.mfa_sessions m where not exists (select 1 from auth.sessions s where s.id = m.session_id);
$$;

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

-- Earlier migrations created permissive placeholders for these two; this gives them their real bodies.
create or replace function private.session_allowed() returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.session_state() = 'ok';
$$;

create or replace function private.require_session() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.session_allowed() then
    raise exception 'sign-in required (session ended or two-step sign-in missing)' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.session_state() from public, anon;
grant execute on function private.session_state() to authenticated, service_role;

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

-- User-callable SECURITY DEFINER functions (groups, team projects, sharing, AI) call
-- private.require_session() or private.session_allowed(), so the rule above covers them too.

-- Before an account is deleted, what others depend on changes hands: groups it owns pass to the
-- longest-standing member (or are deleted when nobody else is in them), and team projects it owns pass to
-- the longest-standing editor, else member, so the team keeps its tasks and milestones. Solo projects go
-- with the account.
create function public.prepare_account_deletion(p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  g record;
  p record;
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

  for p in select id from public.projects where owner_id = p_user loop
    select user_id into v_heir from public.project_members
     where project_id = p.id and user_id <> p_user
     order by role = 'editor' desc, joined_at limit 1;
    if v_heir is not null then
      update public.project_members set role = 'owner', via_group = null where project_id = p.id and user_id = v_heir;
      update public.projects set owner_id = v_heir, folder_key = null, folder_label = null where id = p.id;
      insert into public.activity (project_id, actor_id, verb, subject)
      values (p.id, null, 'new owner', (select coalesce(nullif(display_name, ''), 'Member') from public.profiles where id = v_heir));
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

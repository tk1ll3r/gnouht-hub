-- Test helpers shared by every pgTAP file. This file intentionally runs outside a transaction so the
-- helpers stay available to the files that follow (the local DB is reset before each test run).
create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Creates an auth user (the profile trigger fires as in production) and returns its id.
create or replace function tests.create_user(p_id uuid, p_email text) returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          jsonb_build_object('full_name', split_part(p_email, '@', 1)), '{}'::jsonb, now(), now())
  returning id;
$$;

-- A row in auth.sessions for the user (one per label), as Auth creates at sign-in. The database checks
-- that the JWT's session is still live, so every simulated request needs one.
create or replace function tests.session_for(p_user uuid, p_label text default 'default', p_aal text default 'aal1') returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := md5(p_user::text || ':' || p_label)::uuid;
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal)
  values (v_id, p_user, now(), now(), p_aal::auth.aal_level)
  on conflict (id) do update set aal = excluded.aal;
  return v_id;
end;
$$;

-- Acts as a signed-in user for the rest of the transaction (what PostgREST does per request).
create or replace function tests.authenticate_as(p_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'session_id', tests.session_for(p_id))::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Same, with an explicit assurance level (aal1 after a magic link, aal2 after the TOTP step) and a
-- session label, so one user can have several sessions.
create or replace function tests.authenticate_as_aal(p_id uuid, p_aal text, p_session text default 'default') returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal, 'session_id', tests.session_for(p_id, p_session, p_aal))::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.authenticate_as_anon() returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

select plan(1);
select pass('test helpers installed');
select * from finish();

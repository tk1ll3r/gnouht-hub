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

-- Acts as a signed-in user for the rest of the transaction (what PostgREST does per request).
create or replace function tests.authenticate_as(p_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
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

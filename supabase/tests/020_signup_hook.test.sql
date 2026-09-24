-- Closed registration: the before-user-created hook only admits allow-listed emails.
begin;
select plan(5);

insert into public.signup_allowlist (email) values ('owner@gnouht.space');

select is(
  public.hook_before_user_created('{"user": {"email": "owner@gnouht.space"}}'::jsonb),
  '{}'::jsonb,
  'allow-listed email may sign up');
select is(
  public.hook_before_user_created('{"user": {"email": "Owner@GNOUHT.space"}}'::jsonb),
  '{}'::jsonb,
  'email comparison is case-insensitive');
select is(
  (public.hook_before_user_created('{"user": {"email": "stranger@example.com"}}'::jsonb) -> 'error' ->> 'http_code')::int,
  403,
  'unknown email is rejected with 403');
select is(
  (public.hook_before_user_created('{"user": {"phone": "+84000000000"}}'::jsonb) -> 'error' ->> 'http_code')::int,
  403,
  'sign-ups without an email are rejected');

select tests.authenticate_as_anon();
select throws_ok(
  $$select public.hook_before_user_created('{"user": {"email": "owner@gnouht.space"}}'::jsonb)$$,
  '42501', null, 'API roles cannot call the hook');

select * from finish();
rollback;

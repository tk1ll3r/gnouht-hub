-- Live sessions and two-step sign-in: once a TOTP factor is verified, aal1 sessions see and change
-- nothing and callable SECURITY DEFINER functions refuse them; an aal2 session works only after the hub
-- marked it (its code went through the rate-limited form). Revoked sessions lose access at once.
-- Users without MFA are unaffected.
begin;
select plan(26);

select tests.create_user('60000000-0000-0000-0000-000000000006', 'mai@example.com');   -- MFA enrolled
select tests.create_user('70000000-0000-0000-0000-000000000007', 'nam@example.com');   -- no MFA
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), '60000000-0000-0000-0000-000000000006', 'Phone', 'totp', 'verified', now(), now(), 'x');
insert into public.tasks (user_id, title) values ('60000000-0000-0000-0000-000000000006', 'Mai task'), ('70000000-0000-0000-0000-000000000007', 'Nam task');

-- ── Mai with only the first factor ──
select tests.authenticate_as_aal('60000000-0000-0000-0000-000000000006', 'aal1');
select is((select count(*)::int from public.tasks), 0, 'an aal1 session of an enrolled user reads nothing');
select is((select count(*)::int from public.profiles), 0, 'not even her profile');
select throws_ok($$insert into public.tasks (title) values ('sneaky')$$, '42501', null, 'writes are refused too');
select results_eq($$with u as (update public.tasks set title = 'x' returning 1) select count(*)::int from u$$, $$values (0)$$, 'updates match no rows');
select throws_ok($$select public.create_group('Test')$$, '42501', null, 'callable functions refuse aal1 sessions');
select is((select count(*)::int from public.group_roster(gen_random_uuid())), 0, 'the roster function returns nothing');

select is(public.session_status(), 'mfa', 'session_status tells the web app the TOTP step is missing');

-- ── Mai with a code guessed directly against Auth: aal2, but never through the hub's form ──
select tests.authenticate_as_aal('60000000-0000-0000-0000-000000000006', 'aal2');
select is((select count(*)::int from public.tasks), 0, 'an aal2 session the hub did not mark reads nothing');
select throws_ok($$select public.create_group('Test')$$, '42501', null, 'and cannot call functions');
select throws_ok($$select public.mark_mfa_session('60000000-0000-0000-0000-000000000006', md5('60000000-0000-0000-0000-000000000006:default')::uuid)$$,
  '42501', null, 'users cannot mark their own session');

-- ── the hub marks the session after its rate-limited form verified the code ──
reset role;
select is(public.mark_mfa_session('60000000-0000-0000-0000-000000000006', tests.session_for('60000000-0000-0000-0000-000000000006', 'phone', 'aal1')),
  false, 'an aal1 session cannot be marked');
select is(public.mark_mfa_session('70000000-0000-0000-0000-000000000007', tests.session_for('60000000-0000-0000-0000-000000000006', 'default', 'aal2')),
  false, 'a session is only marked for its own user');
select is(public.mark_mfa_session('60000000-0000-0000-0000-000000000006', tests.session_for('60000000-0000-0000-0000-000000000006', 'default', 'aal2')),
  true, 'an aal2 session is marked');
select tests.authenticate_as_aal('60000000-0000-0000-0000-000000000006', 'aal2');
select is(public.session_status(), 'ok', 'session_status is ok');
select is((select title from public.tasks), 'Mai task', 'the marked aal2 session reads her data');
select lives_ok($$insert into public.tasks (title) values ('allowed')$$, 'and writes it');
select lives_ok($$select public.create_group('Study')$$, 'and calls functions');

select tests.authenticate_as_aal('60000000-0000-0000-0000-000000000006', 'aal2', 'laptop');
select is((select count(*)::int from public.tasks), 0, 'her other aal2 session, not marked, still reads nothing');

-- ── Nam has no factor: nothing changes for him ──
select tests.authenticate_as_aal('70000000-0000-0000-0000-000000000007', 'aal1');
select is((select title from public.tasks), 'Nam task', 'users without MFA keep working at aal1');
select lives_ok($$select public.create_group('Nam group')$$, 'including callable functions');

-- ── revoked sessions (sign out, sign out everywhere) stop working before the JWT expires ──
reset role;
delete from auth.sessions where id = md5('70000000-0000-0000-0000-000000000007:default')::uuid;
select set_config('request.jwt.claims', json_build_object('sub', '70000000-0000-0000-0000-000000000007', 'role', 'authenticated',
  'session_id', md5('70000000-0000-0000-0000-000000000007:default')::uuid)::text, true);
set local role authenticated;
select is((select count(*)::int from public.tasks), 0, 'a JWT whose session was revoked reads nothing');
select is(public.session_status(), 'ended', 'session_status reports the ended session');
select throws_ok($$select public.create_group('After sign-out')$$, '42501', null, 'and cannot call functions');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '70000000-0000-0000-0000-000000000007', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from public.tasks), 0, 'a JWT without a session id reads nothing');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '70000000-0000-0000-0000-000000000007', 'role', 'authenticated',
  'session_id', md5('60000000-0000-0000-0000-000000000006:default')::uuid)::text, true);
set local role authenticated;
select is((select count(*)::int from public.tasks), 0, 'another user''s session id does not count');

-- ── account deletion keeps groups intact ──
reset role;
insert into public.group_members (group_id, user_id, role) select id, '70000000-0000-0000-0000-000000000007', 'member' from public.groups where name = 'Study';
select public.prepare_account_deletion('60000000-0000-0000-0000-000000000006');
delete from auth.users where id = '60000000-0000-0000-0000-000000000006';
select is((select role from public.group_members m join public.groups g on g.id = m.group_id where g.name = 'Study' and m.user_id = '70000000-0000-0000-0000-000000000007'),
  'owner', 'a deleted owner''s group passes to the remaining member');

select * from finish();
rollback;

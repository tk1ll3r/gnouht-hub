-- Row-level security for the personal workspace: every user sees and changes only their own rows,
-- cannot forge ownership, cannot reach server-only tables, and anonymous callers get nothing.
begin;
select plan(34);

-- ── fixtures (as postgres) ───────────────────────────────────────────────
select tests.create_user('a0000000-0000-0000-0000-00000000000a', 'alice@example.com');
select tests.create_user('b0000000-0000-0000-0000-00000000000b', 'bob@example.com');

insert into public.semesters (id, user_id, name, starts_on, ends_on, is_current)
values ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'HK1 2026-2027', '2026-09-07', '2026-12-27', true);
insert into public.courses (id, user_id, semester_id, code, class_code, name)
values ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'NT219', 'NT219.Q11', 'Cryptography');
insert into public.calendar_sources (id, user_id, kind, flavor, name)
values ('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'ics', 'moodle', 'Moodle');
insert into public.integration_secrets (source_id, user_id, ciphertext)
values ('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'v1:opaque');
insert into public.events (user_id, source_id, external_id, title, starts_at, ends_at)
values ('a0000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001', 'evt-1', 'Club meeting', now(), now() + interval '1 hour');
insert into public.tasks (id, user_id, course_id, title, kind, source, source_key, due_at)
values ('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000001',
        'Lab 3 (from Moodle)', 'assignment', 'moodle', 'moodle:lab3', now() + interval '2 days');

select is((select count(*)::int from public.profiles where id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b')), 2, 'profiles are created by the auth.users trigger');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a'), 'alice', 'display name defaults from metadata');

-- ── Alice works in her own workspace ─────────────────────────────────────
select tests.authenticate_as('a0000000-0000-0000-0000-00000000000a');

select lives_ok(
  $$insert into public.course_sessions (course_id, weekday, period_start, period_end)
    values ('a2000000-0000-0000-0000-000000000001', 2, 1, 3)$$,
  'owner can add a timetable session to her course');
select lives_ok(
  $$insert into public.tasks (title, due_at) values ('Read chapter 4', now() + interval '1 day')$$,
  'owner can create a manual task');
select is((select user_id from public.tasks where title = 'Read chapter 4'),
  'a0000000-0000-0000-0000-00000000000a'::uuid, 'user_id defaults to the caller');
select throws_ok(
  $$insert into public.tasks (title, source, source_key) values ('Fake sync', 'moodle', 'x')$$,
  '42501', null, 'owner cannot create synced tasks (source columns are not granted)');
select lives_ok(
  $$update public.tasks set status = 'done' where id = 'a4000000-0000-0000-0000-000000000001'$$,
  'owner can complete a synced task');
select ok((select completed_at is not null and progress = 1 from public.tasks where id = 'a4000000-0000-0000-0000-000000000001'),
  'completing a task stamps completed_at and progress');
select results_eq(
  $$with d as (delete from public.tasks where id = 'a4000000-0000-0000-0000-000000000001' returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'synced tasks cannot be deleted (only cut)');
select results_eq(
  $$with d as (delete from public.tasks where title = 'Read chapter 4' returning 1) select count(*)::int from d$$,
  $$values (1)$$,
  'manual tasks can be deleted');
select throws_ok(
  $$update public.tasks set source = 'manual' where id = 'a4000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'owner cannot rewrite the source of a synced task');
select lives_ok(
  $$update public.profiles set display_name = 'Alice N.', day_start = '06:30' where id = 'a0000000-0000-0000-0000-00000000000a'$$,
  'owner can edit her profile settings');
select throws_ok(
  $$update public.profiles set id = 'b0000000-0000-0000-0000-00000000000b' where id = 'a0000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'profile id is not updatable');
select lives_ok(
  $$update public.calendar_sources set name = 'UIT Moodle', enabled = false where id = 'a3000000-0000-0000-0000-000000000001'$$,
  'owner can rename and disable a calendar source');
select throws_ok(
  $$update public.calendar_sources set sync_state = '{"x":1}' where id = 'a3000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'sync state is server-only');
select throws_ok(
  $$insert into public.calendar_sources (user_id, kind, name) values ('a0000000-0000-0000-0000-00000000000a', 'ics', 'x')$$,
  '42501', null, 'calendar sources are created only by the server');
select throws_ok($$select * from public.integration_secrets$$, '42501', null, 'secrets are unreadable even by their owner');
select throws_ok(
  $$insert into public.events (user_id, source_id, external_id, starts_at, ends_at)
    values ('a0000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001', 'x', now(), now())$$,
  '42501', null, 'events are written only by the sync job');
select throws_ok(
  $$insert into public.audit_log (action) values ('forged')$$,
  '42501', null, 'the audit log is append-only from trusted code');
select is((select count(*)::int from public.events), 1, 'owner reads her events');

-- ── Bob cannot see or touch Alice's data ─────────────────────────────────
select tests.authenticate_as('b0000000-0000-0000-0000-00000000000b');

select is((select count(*)::int from public.semesters), 0, 'other users see no semesters');
select is((select count(*)::int from public.courses), 0, 'other users see no courses');
select is((select count(*)::int from public.course_sessions), 0, 'other users see no sessions');
select is((select count(*)::int from public.tasks), 0, 'other users see no tasks');
select is((select count(*)::int from public.events), 0, 'other users see no events');
select is((select count(*)::int from public.calendar_sources), 0, 'other users see no calendar sources');
select is((select count(*)::int from public.profiles), 1, 'users see only their own profile');
select results_eq(
  $$with u as (update public.courses set name = 'pwned' returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'other users cannot update courses');
select results_eq(
  $$with d as (delete from public.semesters returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'other users cannot delete semesters');
select throws_ok(
  $$insert into public.courses (semester_id, code, name) values ('a1000000-0000-0000-0000-000000000001', 'NT101', 'Intrusion')$$,
  '23503', null, 'a course cannot be attached to someone else''s semester (composite FK)');
select throws_ok(
  $$insert into public.tasks (user_id, title) values ('a0000000-0000-0000-0000-00000000000a', 'planted')$$,
  '42501', null, 'ownership cannot be forged on insert');
select throws_ok(
  $$insert into public.tasks (title, course_id) values ('link', 'a2000000-0000-0000-0000-000000000001')$$,
  '23503', null, 'a task cannot reference someone else''s course');

-- ── anonymous callers get nothing ────────────────────────────────────────
select tests.authenticate_as_anon();
select throws_ok($$select * from public.tasks$$, '42501', null, 'anon cannot read tasks');
select throws_ok($$select * from public.profiles$$, '42501', null, 'anon cannot read profiles');

select * from finish();
rollback;

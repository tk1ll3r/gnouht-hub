-- Study groups: invites bound to an email (and admitted by the sign-up hook), membership-scoped reads,
-- read-only project sharing, owner protections and a roster that reveals only display names.
begin;
select plan(39);

select tests.create_user('10000000-0000-0000-0000-000000000001', 'gina@example.com');   -- group owner
select tests.create_user('20000000-0000-0000-0000-000000000002', 'hung@example.com');   -- invited member
select tests.create_user('30000000-0000-0000-0000-000000000003', 'ivan@example.com');   -- outsider

-- Gina's project with a document, a checklist item and a milestone (as ingestion would store them).
insert into public.projects (id, user_id, name) values ('10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Thesis');
insert into public.projects (id, user_id, name) values ('10000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', 'Private diary');
insert into public.project_documents (id, user_id, project_id, path, kind, title, content_hash, content)
values ('10000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1',
        'plan.md', 'markdown', 'Plan', repeat('a', 64), 'Kế hoạch');
insert into public.document_chunks (user_id, project_id, document_id, ord, content)
values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000d1', 0, 'Kế hoạch thực nghiệm');
insert into public.tasks (user_id, title, project_id, due_at) values ('10000000-0000-0000-0000-000000000001', 'Submit draft', '10000000-0000-0000-0000-0000000000a1', now() + interval '3 days');
insert into public.tasks (user_id, title, due_at) values ('10000000-0000-0000-0000-000000000001', 'Personal errand', now() + interval '1 day');

-- ── Gina creates a group and invites Hung ──
select tests.authenticate_as('10000000-0000-0000-0000-000000000001');
select lives_ok($$select public.create_group('NT219 study group', 'Crypto labs')$$, 'a user creates a group');
select is((select role from public.group_members where user_id = '10000000-0000-0000-0000-000000000001'), 'owner', 'the creator becomes its owner');
select throws_ok($$insert into public.groups (name) values ('direct')$$, '42501', null, 'groups are created only through create_group');
select throws_ok($$insert into public.group_members (group_id, user_id) select id, '30000000-0000-0000-0000-000000000003' from public.groups$$,
  '42501', null, 'nobody can add members directly');
select ok(length((select public.create_group_invite((select id from public.groups), 'Hung@Example.com'))) >= 32, 'owner creates an invite and gets a long token');
select is((select email from public.group_invites), 'hung@example.com', 'invite emails are normalised');
select set_config('tests.invite_id', (select id::text from public.group_invites), true);
select throws_ok($$select token_hash from public.group_invites$$, '42501', null, 'token hashes are not readable');
select lives_ok($$insert into public.project_shares (project_id, group_id) select '10000000-0000-0000-0000-0000000000a1', id from public.groups$$,
  'owner shares a project with her group');
select throws_ok($$select public.create_group_invite((select id from public.groups), 'not-an-email')$$, '23514', null, 'invalid emails are rejected');

-- ── the sign-up hook admits invited addresses only ──
reset role;
select is(public.hook_before_user_created('{"user": {"email": "hung@example.com"}}'::jsonb), '{}'::jsonb, 'an invited email may register');
select is((public.hook_before_user_created('{"user": {"email": "ivan+x@example.com"}}'::jsonb) -> 'error' ->> 'http_code')::int, 403,
  'an uninvited email still may not');
update public.group_invites set revoked_at = now() where email = 'hung@example.com';
select is((public.hook_before_user_created('{"user": {"email": "hung@example.com"}}'::jsonb) -> 'error' ->> 'http_code')::int, 403,
  'a revoked invite no longer admits');
update public.group_invites set revoked_at = null where email = 'hung@example.com';

-- ── Ivan (outsider) sees nothing and cannot use Hung's invite ──
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.groups) + (select count(*)::int from public.group_members) + (select count(*)::int from public.group_invites), 0,
  'outsiders see no group, member or invite');
select throws_ok(format('select public.accept_group_invite(%L)', current_setting('tests.invite_id')), '42501', null,
  'an invite cannot be accepted from another address');
select is((select count(*)::int from public.projects where id = '10000000-0000-0000-0000-0000000000a1'), 0, 'outsiders cannot read the shared project');
select is((select count(*)::int from public.group_roster((select group_id from public.project_shares limit 1))), 0, 'outsiders get an empty roster');

-- ── Hung sees the pending invite, then joins ──
select tests.authenticate_as('20000000-0000-0000-0000-000000000002');
select is((select name from public.groups), 'NT219 study group', 'an invitee can see the group he is invited to');
select is((select count(*)::int from public.projects), 0, 'but not its projects before joining');
select lives_ok(format('select public.accept_group_invite(%L)', (select id from public.group_invites limit 1)), 'the invitee accepts');
select throws_ok(format('select public.accept_group_invite(%L)', (select id from public.group_invites limit 1)), 'P0002', null, 'invites are single-use');
select is((select count(*)::int from public.group_members), 2, 'members see the whole roster');
select is((select array_agg(display_name order by role desc) from public.group_roster((select id from public.groups))), array['gina', 'hung'],
  'the roster shows display names');
select is((select count(*)::int from public.profiles where id = '10000000-0000-0000-0000-000000000001'), 0,
  'other members'' profiles (time zone, settings) stay unreadable');
select is((select count(*)::int from public.projects), 1, 'members read the shared project only (not the private one)');
select is((select count(*)::int from public.project_documents) + (select count(*)::int from public.document_chunks), 2,
  'members read documents and chunks of the shared project');
select is((select count(*)::int from public.search_documents('ke hoach')), 1, 'members can search shared documents');
select is((select title from public.tasks), 'Submit draft', 'members see the shared project''s deadlines but not personal tasks');
select results_eq($$with u as (update public.tasks set status = 'done' returning 1) select count(*)::int from u$$, $$values (0)$$,
  'members cannot change the owner''s tasks');
select results_eq($$with u as (update public.projects set name = 'hijacked' returning 1) select count(*)::int from u$$, $$values (0)$$,
  'members cannot edit the shared project');
select throws_ok($$insert into public.project_shares (project_id, group_id) select '10000000-0000-0000-0000-0000000000a2', id from public.groups$$,
  '42501', null, 'members cannot share someone else''s project');
select lives_ok($$update public.group_members set share_busy = true where user_id = '20000000-0000-0000-0000-000000000002'$$, 'a member opts in to free/busy sharing');
select results_eq($$with u as (update public.group_members set share_busy = true where user_id = '10000000-0000-0000-0000-000000000001' returning 1) select count(*)::int from u$$,
  $$values (0)$$, 'nobody can change another member''s sharing');
select results_eq($$with d as (delete from public.group_members where user_id = '10000000-0000-0000-0000-000000000001' returning 1) select count(*)::int from d$$,
  $$values (0)$$, 'members cannot remove the owner');
select throws_ok($$select public.create_group_invite((select id from public.groups), 'ivan@example.com')$$, '42501', null, 'members cannot invite');

-- ── owner protections ──
select tests.authenticate_as('10000000-0000-0000-0000-000000000001');
select throws_ok($$delete from public.group_members where user_id = '10000000-0000-0000-0000-000000000001'$$, 'P0001', null,
  'the last owner cannot leave');
select lives_ok($$delete from public.group_members where user_id = '20000000-0000-0000-0000-000000000002'$$, 'the owner removes a member');
select tests.authenticate_as('20000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.projects) + (select count(*)::int from public.tasks), 0, 'a removed member loses access immediately');
select tests.authenticate_as('10000000-0000-0000-0000-000000000001');
select lives_ok($$delete from public.groups$$, 'the owner deletes the group (the owner guard allows the cascade)');
select is((select count(*)::int from public.project_shares), 0, 'shares disappear with the group');

select * from finish();
rollback;

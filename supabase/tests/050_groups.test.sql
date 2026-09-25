-- Study groups and team projects: invites bound to an email (and admitted by the sign-up hook), members of a
-- group linked to a project become project members with the default role, leave with the group, and see only
-- what the project shares; owner protections and rosters that reveal display names only.
begin;
select plan(41);

select tests.create_user('10000000-0000-0000-0000-000000000001', 'gina@example.com');   -- group owner, team lead
select tests.create_user('20000000-0000-0000-0000-000000000002', 'hung@example.com');   -- invited member
select tests.create_user('30000000-0000-0000-0000-000000000003', 'ivan@example.com');   -- outsider

-- Gina's team project and a private one, a shared and a private document, a milestone and tasks.
select tests.authenticate_as('10000000-0000-0000-0000-000000000001');
insert into public.projects (id, slug, name, kind) values
  ('10000000-0000-0000-0000-0000000000a1', 'nt219-capstone', 'NT219 capstone', 'course'),
  ('10000000-0000-0000-0000-0000000000a2', 'diary', 'Private diary', 'personal');
insert into public.tasks (title, project_id, due_at) values ('Submit draft', '10000000-0000-0000-0000-0000000000a1', now() + interval '3 days');
insert into public.tasks (title, due_at) values ('Personal errand', now() + interval '1 day');
insert into public.milestones (project_id, title, due_on) values ('10000000-0000-0000-0000-0000000000a1', 'Proposal', current_date + 7);
reset role;
insert into public.devices (id, user_id, name, secret_ciphertext) values ('10000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-000000000001', 'PC', 'v1.x');
insert into public.documents (id, owner_id, device_id, project_id, path, title, ext, size_bytes, sha256, modified_at, visibility) values
  ('10000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000e1',
   '10000000-0000-0000-0000-0000000000a1', 'plan.md', 'Plan', 'md', 10, repeat('a', 64), now(), 'project'),
  ('10000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000e1',
   '10000000-0000-0000-0000-0000000000a1', 'notes.md', 'Notes', 'md', 10, repeat('b', 64), now(), 'private');
insert into public.document_chunks (document_id, idx, content) values
  ('10000000-0000-0000-0000-0000000000d1', 0, 'Kế hoạch thực nghiệm'),
  ('10000000-0000-0000-0000-0000000000d2', 0, 'Kế hoạch riêng');

-- ── Gina creates a course group and invites Hung ──
select tests.authenticate_as('10000000-0000-0000-0000-000000000001');
select lives_ok($$select public.create_group('NT219 team', 'Crypto labs', null, 'nt219.q11')$$, 'a user creates a group for a course');
select is((select row(role, g.course_code)::text from public.group_members m join public.groups g on g.id = m.group_id), '(owner,NT219.Q11)',
  'the creator owns it and the course code is normalised');
select throws_ok($$insert into public.groups (name) values ('direct')$$, '42501', null, 'groups are created only through create_group');
select throws_ok($$insert into public.group_members (group_id, user_id) select id, '30000000-0000-0000-0000-000000000003' from public.groups$$,
  '42501', null, 'nobody can add group members directly');
select ok(length((select public.create_group_invite((select id from public.groups), 'Hung@Example.com'))) >= 32, 'owner creates an invite and gets a long token');
select is((select email from public.group_invites), 'hung@example.com', 'invite emails are normalised');
select set_config('tests.invite_id', (select id::text from public.group_invites), true);
select throws_ok($$select token_hash from public.group_invites$$, '42501', null, 'token hashes are not readable');
select throws_ok($$select public.create_group_invite((select id from public.groups), 'not-an-email')$$, '23514', null, 'invalid emails are rejected');
select lives_ok($$select public.link_group_project('10000000-0000-0000-0000-0000000000a1', (select id from public.groups), 'viewer')$$,
  'the lead runs the project with her group');
select throws_ok($$select public.link_group_project('10000000-0000-0000-0000-0000000000a1', (select id from public.groups), 'owner')$$,
  '22023', null, 'a group cannot hand out ownership');

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
select is((select count(*)::int from public.projects), 0, 'outsiders cannot read the team project');
select is((select count(*)::int from public.project_roster('10000000-0000-0000-0000-0000000000a1')), 0, 'outsiders get an empty project roster');

-- ── Hung sees the pending invite, then joins and becomes a project member ──
select tests.authenticate_as('20000000-0000-0000-0000-000000000002');
select is((select name from public.groups), 'NT219 team', 'an invitee can see the group he is invited to');
select is((select count(*)::int from public.projects), 0, 'but not its projects before joining');
select lives_ok(format('select public.accept_group_invite(%L)', (select id from public.group_invites limit 1)), 'the invitee accepts');
select throws_ok(format('select public.accept_group_invite(%L)', (select id from public.group_invites limit 1)), 'P0002', null, 'invites are single-use');
select is((select array_agg(display_name order by role desc) from public.group_roster((select id from public.groups))), array['gina', 'hung'],
  'the group roster shows display names');
select is((select role from public.project_members where user_id = '20000000-0000-0000-0000-000000000002'), 'viewer',
  'joining the group makes him a project member with the default role');
select is((select array_agg(role order by role) from public.project_roster('10000000-0000-0000-0000-0000000000a1')), array['owner', 'viewer'],
  'the project roster lists both members');
select is((select count(*)::int from public.profiles where id = '10000000-0000-0000-0000-000000000001'), 0,
  'other members'' profiles (time zone, settings) stay unreadable');
select is((select count(*)::int from public.projects), 1, 'members read the team project only (not the private one)');
select is((select title from public.documents), 'Plan', 'members read shared documents, not private notes');
select is((select count(*)::int from public.search_chunks('ke hoach')), 1, 'members find shared passages only');
select is((select title from public.tasks), 'Submit draft', 'members see project tasks but not personal ones');
select is((select title from public.milestones), 'Proposal', 'members see milestones');
select results_eq($$with u as (update public.tasks set status = 'done' returning 1) select count(*)::int from u$$, $$values (0)$$,
  'viewers cannot change tasks that are not theirs');
select results_eq($$with u as (update public.projects set name = 'hijacked' returning 1) select count(*)::int from u$$, $$values (0)$$,
  'viewers cannot edit the project');
select throws_ok($$select public.set_project_member_role('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000002', 'editor')$$,
  '42501', null, 'members cannot promote themselves');
select lives_ok($$update public.group_members set share_busy = true where user_id = '20000000-0000-0000-0000-000000000002'$$, 'a member opts in to free/busy sharing');
select results_eq($$with d as (delete from public.group_members where user_id = '10000000-0000-0000-0000-000000000001' returning 1) select count(*)::int from d$$,
  $$values (0)$$, 'members cannot remove the group owner');

-- ── owner protections, roles and leaving ──
select tests.authenticate_as('10000000-0000-0000-0000-000000000001');
select lives_ok($$select public.set_project_member_role('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000002', 'editor')$$,
  'the lead makes a member an editor');
select throws_ok($$delete from public.group_members where user_id = '10000000-0000-0000-0000-000000000001'$$, 'P0001', null,
  'the last group owner cannot leave');
select lives_ok($$delete from public.group_members where user_id = '20000000-0000-0000-0000-000000000002'$$, 'the owner removes a member from the group');
select tests.authenticate_as('20000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.projects) + (select count(*)::int from public.tasks) + (select count(*)::int from public.documents), 0,
  'a removed member loses project access immediately');
select tests.authenticate_as('10000000-0000-0000-0000-000000000001');
select lives_ok($$delete from public.groups$$, 'the owner deletes the group (the owner guard allows the cascade)');
select is((select count(*)::int from public.project_members where project_id = '10000000-0000-0000-0000-0000000000a1'), 1,
  'the project keeps only its owner after the group is gone');

select * from finish();
rollback;

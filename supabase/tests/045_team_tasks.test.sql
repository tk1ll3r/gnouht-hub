-- Per-task permissions in a team project: lead (owner), deputy (editor), two members (viewers).
--   team      owner, editors and the assignee may change the task
--   assignee  only the assignee and the owner
--   owner     locked: only the owner
-- An assignee who is not an editor changes status, progress, notes and the estimate only.
begin;
select plan(30);

select tests.create_user('a1000000-0000-0000-0000-00000000000a', 'lead@example.com');
select tests.create_user('b1000000-0000-0000-0000-00000000000b', 'deputy@example.com');
select tests.create_user('c1000000-0000-0000-0000-00000000000c', 'an@example.com');
select tests.create_user('d1000000-0000-0000-0000-00000000000d', 'binh@example.com');
update public.profiles set display_name = 'An' where id = 'c1000000-0000-0000-0000-00000000000c';

select tests.authenticate_as('a1000000-0000-0000-0000-00000000000a');
insert into public.projects (id, slug, name, kind) values ('a2000000-0000-0000-0000-000000000001', 'nt101-lab', 'NT101 lab', 'course');
reset role;
insert into public.project_members (project_id, user_id, role) values
  ('a2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000b', 'editor'),
  ('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000c', 'viewer'),
  ('a2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000d', 'viewer');

-- ── the lead plans the work ──
select tests.authenticate_as('a1000000-0000-0000-0000-00000000000a');
select lives_ok($$insert into public.tasks (title, project_id, assignee_id) values
  ('Team task', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000c')$$, 'the lead assigns a team task to An');
select lives_ok($$insert into public.tasks (title, project_id, assignee_id, permission) values
  ('An only', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000c', 'assignee')$$, 'the lead restricts a task to its assignee');
select lives_ok($$insert into public.tasks (title, project_id, assignee_id, permission) values
  ('Locked', 'a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000c', 'owner')$$, 'the lead locks a task');
select is((select verb from public.activity where subject = 'Team task' order by id desc limit 1), 'created task', 'task creation is logged');

-- ── An, a viewer, works on what is assigned to her ──
select tests.authenticate_as('c1000000-0000-0000-0000-00000000000c');
select lives_ok($$update public.tasks set status = 'doing', progress = 0.5, notes = 'half way' where title = 'Team task'$$,
  'the assignee updates the progress of her team task');
select is((select status from public.tasks where title = 'Team task'), 'doing', 'the change is stored');
select throws_ok($$update public.tasks set title = 'Renamed' where title = 'Team task'$$, '42501', null, 'but cannot rename it');
select throws_ok($$update public.tasks set due_at = now() + interval '30 days' where title = 'Team task'$$, '42501', null, 'or move its deadline');
select throws_ok($$update public.tasks set assignee_id = 'd1000000-0000-0000-0000-00000000000d' where title = 'Team task'$$, '42501', null,
  'or hand it to someone else');
select throws_ok($$update public.tasks set permission = 'team' where title = 'An only'$$, '42501', null, 'or change who may edit it');
select lives_ok($$update public.tasks set status = 'done' where title = 'An only'$$, 'she updates the task restricted to her');
select results_eq($$with u as (update public.tasks set status = 'doing' where title = 'Locked' returning 1) select count(*)::int from u$$,
  $$values (0)$$, 'a locked task stays unchanged even for its assignee');
select throws_ok($$insert into public.tasks (title, project_id) values ('sneaky', 'a2000000-0000-0000-0000-000000000001')$$, '42501', null,
  'viewers do not create project tasks');

-- ── Bình, a viewer without tasks, changes nothing ──
select tests.authenticate_as('d1000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.tasks), 3, 'members read every project task');
select results_eq($$with u as (update public.tasks set status = 'cut' returning 1) select count(*)::int from u$$, $$values (0)$$,
  'a member cannot change tasks that are not assigned to them');

-- ── the deputy plans team tasks but respects restricted ones ──
select tests.authenticate_as('b1000000-0000-0000-0000-00000000000b');
select lives_ok($$update public.tasks set title = 'Team task v2', due_at = now() + interval '5 days' where title = 'Team task'$$,
  'the editor edits a team task');
select lives_ok($$update public.tasks set assignee_id = 'd1000000-0000-0000-0000-00000000000d' where title = 'Team task v2'$$,
  'the editor reassigns it');
select is((select verb from public.activity where subject = 'Team task v2' and verb like 'assigned%' order by id desc limit 1), 'assigned to binh',
  'the reassignment is logged with the new assignee''s name');
select results_eq($$with u as (update public.tasks set title = 'x' where title in ('An only', 'Locked') returning 1) select count(*)::int from u$$,
  $$values (0)$$, 'editors cannot touch tasks restricted to an assignee or locked');
select throws_ok($$update public.tasks set permission = 'owner' where title = 'Team task v2'$$, '42501', null,
  'only the lead changes task permissions');
select throws_ok($$insert into public.tasks (title, project_id, permission) values ('x', 'a2000000-0000-0000-0000-000000000001', 'owner')$$,
  '42501', null, 'editors cannot create locked tasks');
select results_eq($$with d as (delete from public.tasks where title = 'Locked' returning 1) select count(*)::int from d$$, $$values (0)$$,
  'editors cannot delete a locked task');
select throws_ok($$select public.remove_project_member('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000c')$$,
  '42501', null, 'editors cannot remove members');

-- ── the lead keeps full control ──
select tests.authenticate_as('a1000000-0000-0000-0000-00000000000a');
select lives_ok($$update public.tasks set status = 'done', permission = 'team' where title = 'Locked'$$, 'the lead updates and unlocks the locked task');
select throws_ok($$select public.set_project_member_role('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a', 'viewer')$$,
  'P0002', null, 'the lead cannot demote the owner role');
select throws_ok($$select public.add_project_member('a2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000d', 'viewer')$$,
  '42501', null, 'members can only be added from the lead''s groups');
select lives_ok($$select public.remove_project_member('a2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000d')$$,
  'the lead removes a member');
select is((select assignee_id from public.tasks where title = 'Team task v2'), null, 'the removed member''s tasks become unassigned');
select throws_ok($$select public.remove_project_member('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a')$$,
  'P0002', null, 'the lead cannot leave her own project');

-- ── a member can leave ──
select tests.authenticate_as('c1000000-0000-0000-0000-00000000000c');
select lives_ok($$select public.remove_project_member('a2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000c')$$,
  'a member leaves the project');

select * from finish();
rollback;

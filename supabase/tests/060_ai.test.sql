-- AI jobs: server-only queueing with consent, concurrency and budget checks; device-bound claiming and
-- completion; prompts wiped after use; owner-only reads.
begin;
select plan(24);

select tests.create_user('40000000-0000-0000-0000-000000000004', 'kim@example.com');
select tests.create_user('50000000-0000-0000-0000-000000000005', 'lan@example.com');
insert into public.devices (id, user_id, name, secret_ciphertext) values
  ('40000000-0000-0000-0000-0000000000d4', '40000000-0000-0000-0000-000000000004', 'Kim PC', 'v1.x'),
  ('50000000-0000-0000-0000-0000000000d5', '50000000-0000-0000-0000-000000000005', 'Lan PC', 'v1.x');

-- Helper: a small prompt (≈30 characters → ~10 tokens) plus 100 output tokens.
create function pg_temp.enqueue(p_user uuid, p_kind text default 'ask_docs') returns uuid language sql as $$
  select public.enqueue_ai_job(p_user, p_kind, '[{"role":"user","content":"Tóm tắt tiến độ dự án này"}]'::jsonb, 100, 600);
$$;

-- ── queueing ──
select throws_like($$select pg_temp.enqueue('40000000-0000-0000-0000-000000000004')$$, '%not enabled%', 'jobs need the user''s AI consent');
update public.profiles set ai_consent_at = now(), ai_daily_tokens = 400 where id in ('40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000005');
select ok(pg_temp.enqueue('40000000-0000-0000-0000-000000000004') is not null, 'a consenting user''s job is queued');
select is((select reserved_tokens from public.ai_jobs where user_id = '40000000-0000-0000-0000-000000000004' limit 1) between 100 and 150, true,
  'the reservation covers the prompt estimate and the output cap');
select lives_ok($$select pg_temp.enqueue('40000000-0000-0000-0000-000000000004')$$, 'a second job fits the budget');
select lives_ok($$select pg_temp.enqueue('40000000-0000-0000-0000-000000000004')$$, 'a third job fits the budget');
select throws_like($$select pg_temp.enqueue('40000000-0000-0000-0000-000000000004')$$, '%three AI jobs%', 'at most three jobs wait at once');

-- ── API roles ──
select set_config('tests.kim_job', (select id::text from public.ai_jobs where user_id = '40000000-0000-0000-0000-000000000004' order by created_at limit 1), true);
select tests.authenticate_as('40000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.ai_jobs), 3, 'owners read their jobs');
select throws_ok($$select public.enqueue_ai_job('40000000-0000-0000-0000-000000000004', 'ask_docs', '[]'::jsonb, 100, 600)$$, '42501', null,
  'users cannot queue prompts directly');
select throws_ok($$select * from public.claim_ai_job('40000000-0000-0000-0000-0000000000d4')$$, '42501', null, 'users cannot claim jobs');
select throws_ok($$update public.ai_jobs set status = 'done'$$, '42501', null, 'users cannot change jobs');
select throws_ok($$insert into public.ai_jobs (user_id, kind, messages, max_output_tokens, reserved_tokens, expires_at)
                   values ('40000000-0000-0000-0000-000000000004', 'brief', '[]', 100, 0, now())$$, '42501', null, 'users cannot insert jobs');
select is(public.cancel_ai_job((select id from public.ai_jobs order by created_at desc limit 1)), true, 'owners cancel a waiting job');
select tests.authenticate_as('50000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.ai_jobs), 0, 'other users see no jobs');
select is(public.cancel_ai_job(current_setting('tests.kim_job')::uuid), false, 'other users cannot cancel them');

-- ── claiming and completing (service role paths) ──
reset role;
select is((select count(*)::int from public.claim_ai_job('50000000-0000-0000-0000-0000000000d5')), 0, 'a device only gets its owner''s jobs');
select is((select kind from public.claim_ai_job('40000000-0000-0000-0000-0000000000d4')), 'ask_docs', 'the owner''s device claims the oldest job');
select is((select status from public.ai_jobs where device_id = '40000000-0000-0000-0000-0000000000d4'), 'running', 'the claimed job is running');
select throws_ok(
  format('select public.complete_ai_job(%L, %L, true, %L, 10, 20, %L, null)', '50000000-0000-0000-0000-0000000000d5',
         (select id from public.ai_jobs where status = 'running'), 'answer', 'm'),
  'P0002', null, 'another device cannot complete the job');
select lives_ok(
  format('select public.complete_ai_job(%L, %L, true, %L, 30, 70, %L, null)', '40000000-0000-0000-0000-0000000000d4',
         (select id from public.ai_jobs where status = 'running'), E'Tiến độ ổn.\u0007', 'cc/sonnet'),
  'the device completes its job');
select is((select array[status, output, messages::text, used_tokens::text] from public.ai_jobs where device_id = '40000000-0000-0000-0000-0000000000d4'),
  array['done', 'Tiến độ ổn.', '[]', '100'], 'results are stored, control characters stripped, actual usage recorded and the prompt wiped');

-- Budget: 400 tokens/day; one job used 100, one is queued (~110), one was cancelled (released).
select lives_ok($$select pg_temp.enqueue('40000000-0000-0000-0000-000000000004')$$, 'cancelled jobs release their reservation');
select throws_like($$select pg_temp.enqueue('40000000-0000-0000-0000-000000000004')$$, '%budget%', 'the daily budget cannot be exceeded');

-- A brief also becomes today's AI brief.
update public.profiles set ai_daily_tokens = 5000 where id = '50000000-0000-0000-0000-000000000005';
select pg_temp.enqueue('50000000-0000-0000-0000-000000000005', 'brief');
select public.complete_ai_job('50000000-0000-0000-0000-0000000000d5', (select id from public.claim_ai_job('50000000-0000-0000-0000-0000000000d5')),
  true, E'Hôm nay tập trung vào Lab 3.\nChi tiết…', 50, 50, 'm', null);
select is((select headline from public.briefs where user_id = '50000000-0000-0000-0000-000000000005' and kind = 'ai'), 'Hôm nay tập trung vào Lab 3.',
  'a finished brief is stored as today''s AI brief');

-- Expired jobs are closed at the next claim.
update public.ai_jobs set expires_at = now() - interval '1 minute' where user_id = '40000000-0000-0000-0000-000000000004' and status = 'queued';
select is((select count(*)::int from public.claim_ai_job('40000000-0000-0000-0000-0000000000d4')), 0, 'expired jobs are not handed out');

select * from finish();
rollback;

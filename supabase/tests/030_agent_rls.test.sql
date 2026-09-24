-- Agent tables: device secrets never reach API roles, quota data is per-owner, rate limiter works.
begin;
select plan(13);

select tests.create_user('c0000000-0000-0000-0000-00000000000c', 'carol@example.com');
select tests.create_user('d0000000-0000-0000-0000-00000000000d', 'dave@example.com');
insert into public.devices (id, user_id, name, secret_ciphertext)
values ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'Carol PC', 'v1.opaque');
insert into public.quota_snapshots (user_id, device_id, connection_id, provider, account_label, window_label, remaining_pct, captured_at)
values ('c0000000-0000-0000-0000-00000000000c', 'c1000000-0000-0000-0000-000000000001', 'conn-1', 'claude', 'ca…@x.com', 'Weekly (7d)', 40, now() - interval '1 hour'),
       ('c0000000-0000-0000-0000-00000000000c', 'c1000000-0000-0000-0000-000000000001', 'conn-1', 'claude', 'ca…@x.com', 'Weekly (7d)', 35, now());
insert into public.usage_daily (user_id, day, provider, model, requests) values ('c0000000-0000-0000-0000-00000000000c', current_date, 'claude', 'opus', 12);

select throws_ok(
  $$insert into public.quota_snapshots (user_id, device_id, connection_id, provider, account_label, window_label, captured_at)
    values ('d0000000-0000-0000-0000-00000000000d', 'c1000000-0000-0000-0000-000000000001', 'x', 'x', 'x', 'x', now())$$,
  '23503', null, 'snapshots cannot be attributed to another user''s device');

select tests.authenticate_as('c0000000-0000-0000-0000-00000000000c');
select is((select name from public.devices), 'Carol PC', 'owner sees her device');
select throws_ok($$select secret_ciphertext from public.devices$$, '42501', null, 'device secret is not readable');
select throws_ok($$select * from public.devices$$, '42501', null, 'select * fails because the secret column is not granted');
select throws_ok($$update public.devices set name = 'x'$$, '42501', null, 'devices cannot be edited from the API');
select is((select remaining_pct from public.quota_latest where connection_id = 'conn-1'), 35::double precision, 'quota_latest returns the newest snapshot');
select is((select requests from public.usage_daily), 12, 'owner reads her usage');
select lives_ok($$insert into public.manual_quotas (name, limit_value) values ('Kaggle GPU', 30)$$, 'owner adds a manual quota');
select throws_ok($$select * from public.agent_nonces$$, '42501', null, 'nonces are server-only');
select throws_ok($$select public.hit_rate_limit('x', 1, 60)$$, '42501', null, 'API roles cannot call the rate limiter');

select tests.authenticate_as('d0000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.quota_latest), 0, 'other users see no quota');
select results_eq($$with d as (delete from public.devices returning 1) select count(*)::int from d$$, $$values (0)$$, 'other users cannot revoke the device');

reset role;
select is(
  array[public.hit_rate_limit('t', 2, 60), public.hit_rate_limit('t', 2, 60), public.hit_rate_limit('t', 2, 60)],
  array[true, true, false],
  'rate limiter allows N calls per window');

select * from finish();
rollback;

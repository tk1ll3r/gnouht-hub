-- M2: local agent devices (pairing, signed requests, replay protection), rate limiting and AI quota data.

-- ───────────────────────────── rate limiting ─────────────────────────────

create table public.rate_limits (
  bucket text primary key check (char_length(bucket) <= 200),
  window_start timestamptz not null,
  hits integer not null
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Fixed-window counter. Returns true when the call is allowed. Called only by trusted server code.
create function public.hit_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- ───────────────────────────── devices ─────────────────────────────

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  platform text check (char_length(platform) <= 40),
  agent_version text check (char_length(agent_version) <= 20),
  -- HMAC key, encrypted with APP_ENC_KEY (AAD `device:<id>`); the server needs it to verify signatures.
  secret_ciphertext text not null check (char_length(secret_ciphertext) <= 1000),
  status jsonb not null default '{}'::jsonb check (pg_column_size(status) <= 4096),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index devices_user_idx on public.devices (user_id);
alter table public.devices enable row level security;
revoke all on public.devices from anon, authenticated;
-- The secret column is deliberately not granted.
grant select (id, user_id, name, platform, agent_version, status, last_seen_at, created_at) on public.devices to authenticated;
grant delete on public.devices to authenticated;
create policy "owners read devices" on public.devices
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owners revoke devices" on public.devices
  for delete to authenticated using (user_id = (select auth.uid()));

create table public.device_pairing_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.device_pairing_codes enable row level security;
revoke all on public.device_pairing_codes from anon, authenticated;

create table public.agent_nonces (
  device_id uuid not null references public.devices (id) on delete cascade,
  nonce text not null check (char_length(nonce) <= 64),
  seen_at timestamptz not null default now(),
  primary key (device_id, nonce)
);
create index agent_nonces_seen_idx on public.agent_nonces (seen_at);
alter table public.agent_nonces enable row level security;
revoke all on public.agent_nonces from anon, authenticated;

-- ───────────────────────────── AI quota ─────────────────────────────

create table public.quota_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  device_id uuid not null,
  connection_id text not null check (char_length(connection_id) <= 100),
  provider text not null check (char_length(provider) <= 60),
  account_label text not null check (char_length(account_label) <= 120),
  plan text check (char_length(plan) <= 80),
  window_label text not null check (char_length(window_label) <= 60),
  used double precision,
  total double precision,
  remaining_pct double precision check (remaining_pct between 0 and 100),
  reset_at timestamptz,
  unlimited boolean not null default false,
  captured_at timestamptz not null,
  foreign key (device_id, user_id) references public.devices (id, user_id) on delete cascade
);
create index quota_snapshots_latest_idx on public.quota_snapshots (user_id, connection_id, window_label, captured_at desc);

create table public.usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  provider text not null check (char_length(provider) <= 60),
  model text not null check (char_length(model) <= 120),
  requests integer not null default 0 check (requests >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 4) not null default 0 check (cost_usd >= 0),
  primary key (user_id, day, provider, model)
);

create table public.manual_quotas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  unit text not null default 'hours' check (char_length(unit) between 1 and 20),
  used numeric(10, 2) not null default 0 check (used >= 0),
  limit_value numeric(10, 2) not null check (limit_value > 0),
  resets_on date,
  updated_at timestamptz not null default now()
);
create trigger manual_quotas_updated_at before update on public.manual_quotas
  for each row execute function private.set_updated_at();

alter table public.quota_snapshots enable row level security;
alter table public.usage_daily enable row level security;
alter table public.manual_quotas enable row level security;
revoke all on public.quota_snapshots, public.usage_daily, public.manual_quotas from anon, authenticated;
grant select on public.quota_snapshots, public.usage_daily to authenticated;
grant select, insert, update, delete on public.manual_quotas to authenticated;
create policy "owners read quota snapshots" on public.quota_snapshots
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owners read usage" on public.usage_daily
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owners manage manual quotas" on public.manual_quotas
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Latest value per account window, for the dashboard.
create view public.quota_latest with (security_invoker = true) as
  select distinct on (user_id, connection_id, window_label) *
  from public.quota_snapshots
  order by user_id, connection_id, window_label, captured_at desc;
grant select on public.quota_latest to authenticated;

-- Housekeeping: keep 14 days of snapshots and 10 minutes of nonces.
create function private.prune_agent_data() returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.quota_snapshots where captured_at < now() - interval '14 days';
  delete from public.agent_nonces where seen_at < now() - interval '10 minutes';
  delete from public.device_pairing_codes where expires_at < now() - interval '1 day';
  delete from public.rate_limits where window_start < now() - interval '1 day';
$$;
revoke all on function private.prune_agent_data() from public, anon, authenticated;
select cron.schedule('hub-prune-agent-data', '17 * * * *', 'select private.prune_agent_data()');

-- Moodle web-service deadlines use their own task source key namespace; courses remember the Moodle id.
create unique index courses_moodle_idx on public.courses (user_id, moodle_course_id) where moodle_course_id is not null;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

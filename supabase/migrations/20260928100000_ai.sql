-- M5: AI jobs. The hub builds every prompt (from data the user can read), reserves token budget
-- atomically, and queues the job; the owner's agent claims it, sends it to the local 9router and returns
-- the answer. Prompts are wiped once a job finishes, so stored excerpts do not outlive their use.

alter table public.profiles
  add column ai_daily_tokens integer not null default 150000 check (ai_daily_tokens between 0 and 2000000),
  add column ai_language text not null default 'vi' check (ai_language in ('vi', 'en'));
grant update (ai_daily_tokens, ai_language) on public.profiles to authenticated;

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('brief', 'project_summary', 'ask_docs')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'expired', 'cancelled')),
  -- The project a summary is about (a project the user can read, possibly shared with them).
  subject_id uuid references public.projects (id) on delete cascade,
  question text check (char_length(question) <= 500),
  -- [{role, content}] built by the hub; emptied when the job finishes.
  messages jsonb not null check (jsonb_typeof(messages) = 'array' and pg_column_size(messages) <= 98304),
  -- ask_docs: the excerpts cited as [1], [2], … (ids and titles only, for links).
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and pg_column_size(sources) <= 16384),
  max_output_tokens integer not null check (max_output_tokens between 64 and 4096),
  reserved_tokens integer not null check (reserved_tokens >= 0),
  used_tokens integer check (used_tokens >= 0),
  model text check (char_length(model) <= 120),
  output text check (char_length(output) <= 20000),
  error text check (char_length(error) <= 300),
  device_id uuid references public.devices (id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz not null
);
create index ai_jobs_user_idx on public.ai_jobs (user_id, created_at desc);
create index ai_jobs_active_idx on public.ai_jobs (user_id, created_at) where status in ('queued', 'running');
create index ai_jobs_subject_idx on public.ai_jobs (subject_id, created_at desc) where subject_id is not null;

alter table public.ai_jobs enable row level security;
revoke all on public.ai_jobs from anon, authenticated;
grant select on public.ai_jobs to authenticated;
create policy "owners read their AI jobs" on public.ai_jobs
  for select to authenticated using (user_id = (select auth.uid()));

-- Tokens a user has committed today (in their time zone): actual usage of finished jobs, the reservation
-- of queued/running ones. Failed, expired and cancelled jobs release their reservation.
create function private.ai_tokens_today(p_user uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(coalesce(j.used_tokens, j.reserved_tokens)), 0)::int
  from public.ai_jobs j
  join public.profiles p on p.id = j.user_id
  where j.user_id = p_user
    and j.status in ('queued', 'running', 'done')
    and j.created_at >= (date_trunc('day', now() at time zone p.timezone) at time zone p.timezone);
$$;

-- Queues a job after checking consent, the per-user concurrency cap and the daily budget. The advisory
-- lock serialises enqueues per user, so two concurrent requests cannot both pass the budget check.
create function public.enqueue_ai_job(
  p_user uuid, p_kind text, p_messages jsonb, p_max_output integer, p_ttl_seconds integer,
  p_subject uuid default null, p_question text default null, p_sources jsonb default '[]'::jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_reserve integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_user::text, 0));
  select * into v_profile from public.profiles where id = p_user;
  if not found or v_profile.ai_consent_at is null then
    raise exception 'AI is not enabled for this account' using errcode = 'P0001', hint = 'consent';
  end if;
  if (select count(*) from public.ai_jobs where user_id = p_user and status in ('queued', 'running') and expires_at > now()) >= 3 then
    raise exception 'three AI jobs are already waiting' using errcode = 'P0001', hint = 'busy';
  end if;
  -- Rough input estimate (≈3 characters per token for mixed Vietnamese/English) plus the output cap.
  v_reserve := ceil(length(p_messages::text) / 3.0)::int + p_max_output;
  if private.ai_tokens_today(p_user) + v_reserve > v_profile.ai_daily_tokens then
    raise exception 'daily AI budget reached' using errcode = 'P0001', hint = 'budget';
  end if;
  insert into public.ai_jobs (user_id, kind, messages, max_output_tokens, reserved_tokens, expires_at, subject_id, question, sources)
  values (p_user, p_kind, p_messages, p_max_output, v_reserve, now() + make_interval(secs => least(greatest(p_ttl_seconds, 60), 86400)),
          p_subject, p_question, coalesce(p_sources, '[]'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- Hands the oldest waiting job of the device owner to that device. SKIP LOCKED lets two devices poll at
-- once without taking the same job. Stale work is expired first.
create function public.claim_ai_job(p_device uuid)
returns table (id uuid, kind text, messages jsonb, max_output_tokens integer, model text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
begin
  select d.user_id into v_user from public.devices d where d.id = p_device;
  if v_user is null then
    raise exception 'unknown device' using errcode = 'P0002';
  end if;
  update public.ai_jobs j set status = 'expired', finished_at = now(), messages = '[]'::jsonb
   where j.user_id = v_user and j.status = 'queued' and j.expires_at <= now();
  -- An agent that crashed mid-job: give up after five minutes.
  update public.ai_jobs j set status = 'failed', error = 'the agent did not finish the job', finished_at = now(), messages = '[]'::jsonb
   where j.user_id = v_user and j.status = 'running' and j.claimed_at < now() - interval '5 minutes';

  return query
  update public.ai_jobs j
     set status = 'running', device_id = p_device, claimed_at = now()
   where j.id = (
     select q.id from public.ai_jobs q
      where q.user_id = v_user and q.status = 'queued' and q.expires_at > now()
      order by q.created_at
      for update skip locked
      limit 1)
  returning j.id, j.kind, j.messages, j.max_output_tokens, j.model;
end;
$$;

-- Stores the result from the device that claimed the job. A brief also becomes today's `ai` brief.
create function public.complete_ai_job(
  p_device uuid, p_job uuid, p_ok boolean, p_output text, p_prompt_tokens integer default null,
  p_completion_tokens integer default null, p_model text default null, p_error text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.ai_jobs%rowtype;
  v_tz text;
  v_output text := left(regexp_replace(coalesce(p_output, ''), '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]', '', 'g'), 20000);
begin
  select * into v_job from public.ai_jobs where id = p_job for update;
  if not found or v_job.status <> 'running' or v_job.device_id is distinct from p_device then
    raise exception 'job is not running on this device' using errcode = 'P0002';
  end if;
  update public.ai_jobs
     set status = case when p_ok and v_output <> '' then 'done' else 'failed' end,
         output = case when p_ok then nullif(v_output, '') end,
         error = case when p_ok and v_output <> '' then null else left(coalesce(p_error, 'empty answer'), 300) end,
         used_tokens = case
           when p_prompt_tokens is not null or p_completion_tokens is not null
             then greatest(coalesce(p_prompt_tokens, 0), 0) + greatest(coalesce(p_completion_tokens, 0), 0)
           when p_ok then v_job.reserved_tokens
           else 0 end,
         model = left(p_model, 120),
         finished_at = now(),
         messages = '[]'::jsonb
   where id = p_job;

  if v_job.kind = 'brief' and p_ok and v_output <> '' then
    select coalesce(timezone, 'Asia/Ho_Chi_Minh') into v_tz from public.profiles where id = v_job.user_id;
    insert into public.briefs (user_id, for_date, kind, headline, markdown)
    values (v_job.user_id, (now() at time zone v_tz)::date, 'ai', left(split_part(v_output, E'\n', 1), 500), left(v_output, 20000))
    on conflict (user_id, for_date, kind) do update set headline = excluded.headline, markdown = excluded.markdown, created_at = now();
  end if;
end;
$$;

-- Owners can withdraw a job that no device has picked up yet.
create function public.cancel_ai_job(p_job uuid) returns boolean
language sql security definer set search_path = ''
as $$
  with c as (
    update public.ai_jobs set status = 'cancelled', finished_at = now(), messages = '[]'::jsonb
    where id = p_job and user_id = (select auth.uid()) and status = 'queued' and (select private.session_allowed())
    returning 1)
  select exists (select 1 from c);
$$;

revoke all on function public.enqueue_ai_job(uuid, text, jsonb, integer, integer, uuid, text, jsonb), public.claim_ai_job(uuid),
  public.complete_ai_job(uuid, uuid, boolean, text, integer, integer, text, text), public.cancel_ai_job(uuid),
  private.ai_tokens_today(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_ai_job(uuid, text, jsonb, integer, integer, uuid, text, jsonb), public.claim_ai_job(uuid),
  public.complete_ai_job(uuid, uuid, boolean, text, integer, integer, text, text), private.ai_tokens_today(uuid) to service_role;
grant execute on function public.cancel_ai_job(uuid) to authenticated;

-- Keep 30 days of AI history.
create or replace function private.prune_agent_data() returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.quota_snapshots where captured_at < now() - interval '14 days';
  delete from public.agent_nonces where seen_at < now() - interval '10 minutes';
  delete from public.device_pairing_codes where expires_at < now() - interval '1 day';
  delete from public.rate_limits where window_start < now() - interval '1 day';
  delete from public.ai_jobs where created_at < now() - interval '30 days';
$$;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

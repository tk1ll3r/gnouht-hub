-- Scheduled jobs: pg_cron calls the app's cron endpoints over HTTPS with pg_net.
-- The bearer secret lives in Supabase Vault and is read when each job runs, so it never appears in
-- cron.job or in migration files.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Run once per environment (see docs/runbook.md):
--   select vault.create_secret('<CRON_SECRET>', 'hub_cron_secret');
--   select private.schedule_hub_jobs('https://hub.gnouht.space');
create function private.schedule_hub_jobs(p_base_url text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers text := $h$jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'hub_cron_secret'))$h$;
begin
  if p_base_url !~ '^https?://[^/\s]+$' then
    raise exception 'base url must look like https://host (no trailing slash)';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'hub_cron_secret') then
    raise exception 'store the cron secret first: select vault.create_secret(''<secret>'', ''hub_cron_secret'')';
  end if;

  perform cron.schedule(
    'hub-sync-calendars',
    '*/15 * * * *',
    format($c$select net.http_post(url := %L, headers := %s, body := '{}'::jsonb, timeout_milliseconds := 55000)$c$,
           p_base_url || '/api/cron/sync-calendars', v_headers)
  );
  -- 23:30 UTC = 06:30 in Vietnam (UTC+7, no daylight saving).
  perform cron.schedule(
    'hub-daily-brief',
    '30 23 * * *',
    format($c$select net.http_post(url := %L, headers := %s, body := '{}'::jsonb, timeout_milliseconds := 55000)$c$,
           p_base_url || '/api/cron/daily-brief', v_headers)
  );
end;
$$;
revoke all on function private.schedule_hub_jobs(text) from public, anon, authenticated;

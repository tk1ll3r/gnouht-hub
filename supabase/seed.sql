-- Local development seed (applied by `supabase db reset`). Never used in production.
-- Registration is invite-only, so the local owner and a test friend are allow-listed.
insert into public.signup_allowlist (email, note) values
  ('owner@example.com', 'local dev owner'),
  ('friend@example.com', 'local dev friend')
on conflict do nothing;

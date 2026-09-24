# Runbook

## Local stack (Windows + WSL)

- Docker Engine and the Linux Supabase CLI live in WSL `Ubuntu-24.04`; `scripts/supabase.mjs` forwards
  `npm run db:*` there. Do **not** run `wsl --shutdown` casually: it also stops 9router.
- `npm run db:start` / `db:stop` / `db:reset` (re-applies migrations + `supabase/seed.sql`).
- `node scripts/dev-env.mjs` regenerates `apps/web/.env.local` and keeps existing app secrets.
- Mailpit (local email): http://127.0.0.1:54324. Studio: http://127.0.0.1:54323.
- Registration is invite-only. Local seed allow-lists `owner@example.com` and `friend@example.com`.

## Production setup (once)

1. **Supabase**: create project `gnouht-hub` (ap-southeast-1), then `supabase link` and `supabase db push`.
   - Auth → Hooks: enable *Before User Created* → `public.hook_before_user_created`.
   - Auth → Email templates: paste `supabase/templates/*.html` (links go to `/auth/confirm`).
   - Auth → SMTP: Resend (`smtp.resend.com`, user `resend`, the API key), sender `noreply@gnouht.space`.
   - Auth → URL config: site `https://hub.gnouht.space`, redirect `https://hub.gnouht.space/auth/callback`.
   - Auth → MFA: enable TOTP.
   - Allow-list the owner: `insert into public.signup_allowlist (email) values ('<you>');`
2. **Vercel**: import the GitHub repo, root `apps/web`, add every variable from `apps/web/.env.example`
   with `vercel env add` (production values; generate `APP_ENC_KEY` and `CRON_SECRET` fresh).
3. **DNS** for `gnouht.space`: `hub` CNAME → Vercel; Resend DKIM/SPF records; `_dmarc` TXT
   `v=DMARC1; p=none; rua=mailto:dmarc@gnouht.space` (tighten to `quarantine` after a clean month).
   If the domain already has an SPF record, merge into a single `v=spf1 … ~all` record.
4. **Google Cloud**: OAuth client (Web). Redirect URIs:
   `https://<project>.supabase.co/auth/v1/callback` (sign-in) and
   `https://hub.gnouht.space/api/integrations/google/callback` (Calendar). Consent screen External and
   **In production** (in Testing, refresh tokens expire after 7 days). Scopes: `openid email profile`,
   `calendar.readonly`, `calendar.freebusy`.
5. **Cron** (SQL editor):
   ```sql
   select vault.create_secret('<CRON_SECRET>', 'hub_cron_secret');
   select private.schedule_hub_jobs('https://hub.gnouht.space');
   ```

## Key rotation (`APP_ENC_KEY`)

Set `APP_ENC_KEY_PREVIOUS`/`_VERSION` to the old key, put a new key in `APP_ENC_KEY` with a higher
`APP_ENC_KEY_VERSION`, and deploy. Old ciphertexts keep decrypting. Reconnect or re-save integrations to
re-encrypt them, then remove the previous key.

## Incident basics

- Suspected token leak: disconnect the integration in Settings (this revokes it at Google), then rotate
  `APP_ENC_KEY` and `CRON_SECRET`.
- Review `public.audit_log` for sign-ins and integration changes.

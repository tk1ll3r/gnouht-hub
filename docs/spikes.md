# Spike results

## 9router v0.5.81 (local, 127.0.0.1:20128)

Findings come from reading the installed package (`%APPDATA%\npm\node_modules\9router`), not from logging in.

- `GET /api/health` → `{"ok":true}`, no auth needed. `GET /api/auth/status` → `{requireLogin, hasPassword, …}`.
- Dashboard APIs need the `auth_token` cookie from `POST /api/auth/login {"password": "…"}` (24 h, httpOnly).
  **With no password set, the default `123456` (or `INITIAL_PASSWORD`) is accepted.** The owner should set
  a password; the agent stores it in Windows Credential Manager.
- `GET /api/providers` → `{connections: [...]}`. apiKey, accessToken, refreshToken and idToken are stripped,
  but other fields (e.g. `providerSpecificData`) are returned as-is. **The agent keeps an allow-list:**
  `id, provider, name, email, isActive`.
- `GET /api/usage/stats?period=today|24h|7d|30d|60d|all` →
  `{totalRequests, totalPromptTokens, totalCompletionTokens, totalCost, byProvider{}, byModel{}, byAccount{}}`.
  Each `by*` entry has `{requests, promptTokens, completionTokens, cost, lastUsed, …}`.
- `GET /api/usage/<connectionId>` → live provider quota:
  `{plan, quotas: {"Session (5h)"|"Weekly (7d)"|"Credits"|…: {used, total, remaining, remainingPercentage, resetAt, unlimited}}, message?}`.
- `/v1/chat/completions` is OpenAI-compatible and uses a Bearer API key created in the dashboard (used for AI jobs in M5).

## Google Calendar

The `syncToken` flow cannot be combined with `timeMin`/`timeMax`, and `singleEvents=true` without a window
expands recurrences without bound. The hub therefore mirrors a fixed window (7 days back, 90 ahead) on
every sync and deletes rows that disappear. That is at most a few requests per user every 15 minutes.

## UIT Moodle / portal

Pending: needs the owner's own account through `hub-agent login-uit` (password typed locally, never
stored if the Moodle mobile token endpoint works). The agent reports which path worked.

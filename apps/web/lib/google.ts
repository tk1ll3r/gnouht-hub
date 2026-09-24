import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "./env";
import { randomToken } from "./crypto";

export const GOOGLE_SCOPES = {
  /** Owner: read events to find busy time and show them in the hub. */
  calendarRead: ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"],
  /** Friends: only busy/free intervals for group scheduling — never event details. */
  freeBusy: ["openid", "email", "https://www.googleapis.com/auth/calendar.freebusy"],
} as const;

export type GoogleAccess = keyof typeof GOOGLE_SCOPES;

/** Short-lived cookie carrying the OAuth state and PKCE verifier between start and callback. */
export const OAUTH_COOKIE = "hub_google_oauth";

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly revoked = false,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export function googleRedirectUri(): string {
  return `${env().APP_URL}/api/integrations/google/callback`;
}

export interface OAuthStart {
  url: string;
  state: string;
  verifier: string;
}

/** Authorization URL with PKCE (S256) and a CSRF state; offline access so we get a refresh token. */
export function buildAuthUrl(access: GoogleAccess, loginHint?: string | null): OAuthStart {
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES[access].join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (loginHint) params.set("login_hint", loginHint);
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state, verifier };
}

const tokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string().default(""),
  token_type: z.string(),
});

async function tokenRequest(body: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env().GOOGLE_CLIENT_ID ?? "",
      client_secret: env().GOOGLE_CLIENT_SECRET ?? "",
      ...body,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = (json as { error?: string }).error ?? `http_${response.status}`;
    throw new GoogleAuthError(`Google token request failed: ${error}`, error === "invalid_grant");
  }
  return tokenSchema.parse(json);
}

export function exchangeCode(code: string, verifier: string) {
  return tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: googleRedirectUri() });
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  return tokens.access_token;
}

/** Best effort: tells Google to drop the grant when the user disconnects. */
export async function revokeToken(token: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

async function googleGet<T>(url: string, accessToken: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401) throw new GoogleAuthError("Google rejected the access token", true);
  if (!response.ok) throw new Error(`Google API ${new URL(url).pathname} failed with ${response.status}`);
  return schema.parse(await response.json());
}

export async function fetchUserEmail(accessToken: string): Promise<string> {
  const info = await googleGet(
    "https://openidconnect.googleapis.com/v1/userinfo",
    accessToken,
    z.object({ email: z.email(), email_verified: z.boolean().optional() }),
  );
  return info.email.toLowerCase();
}

// A type alias (not an interface) so it is assignable to the JSON column type.
export type GoogleCalendarEntry = {
  id: string;
  summary: string;
  primary: boolean;
  selected: boolean;
};

export async function listCalendars(accessToken: string): Promise<GoogleCalendarEntry[]> {
  const data = await googleGet(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250",
    accessToken,
    z.object({
      items: z
        .array(z.object({ id: z.string(), summary: z.string().default(""), primary: z.boolean().optional(), selected: z.boolean().optional() }))
        .default([]),
    }),
  );
  return data.items.map((item) => ({
    id: item.id,
    summary: item.summary || item.id,
    primary: Boolean(item.primary),
    // Default to the calendars the user already shows in Google Calendar.
    selected: Boolean(item.primary || item.selected),
  }));
}

const eventDate = z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() });
const eventSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  summary: z.string().optional(),
  location: z.string().optional(),
  transparency: z.string().optional(),
  eventType: z.string().optional(),
  start: eventDate.optional(),
  end: eventDate.optional(),
});
export type GoogleEvent = z.infer<typeof eventSchema>;

/** All single (expanded) events of one calendar that overlap [from, to]. */
export async function listEvents(accessToken: string, calendarId: string, from: Date, to: Date): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      maxResults: "2500",
      fields: "items(id,status,summary,location,transparency,eventType,start,end),nextPageToken",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await googleGet(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      accessToken,
      z.object({ items: z.array(eventSchema).default([]), nextPageToken: z.string().optional() }),
    );
    events.push(...data.items);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return events;
}

/** Busy intervals across calendars (used for group meeting slots with the freebusy scope). */
export async function queryFreeBusy(accessToken: string, from: Date, to: Date, calendarIds: string[] = ["primary"]) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: calendarIds.map((id) => ({ id })) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401) throw new GoogleAuthError("Google rejected the access token", true);
  if (!response.ok) throw new Error(`Google freeBusy failed with ${response.status}`);
  const data = z
    .object({ calendars: z.record(z.string(), z.object({ busy: z.array(z.object({ start: z.string(), end: z.string() })).default([]) })) })
    .parse(await response.json());
  return Object.values(data.calendars).flatMap((calendar) =>
    calendar.busy.map((block) => ({ start: new Date(block.start), end: new Date(block.end) })),
  );
}

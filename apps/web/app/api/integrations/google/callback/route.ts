import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { decryptSecret, encryptSecret, safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import {
  exchangeCode,
  fetchUserEmail,
  GOOGLE_SCOPES,
  listCalendars,
  OAUTH_COOKIE,
  revokeToken,
  type GoogleCalendarEntry,
} from "@/lib/google";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretAad, syncCalendarSource } from "@/lib/sync";

const cookieSchema = z.object({ state: z.string(), verifier: z.string(), access: z.enum(["calendarRead", "freeBusy"]), uid: z.string() });

export async function GET(request: NextRequest) {
  const base = env().APP_URL;
  const done = (query: string) => {
    const response = NextResponse.redirect(new URL(`/settings?${query}#calendars`, base), { status: 303 });
    response.cookies.set(OAUTH_COOKIE, "", { path: "/api/integrations/google", maxAge: 0 });
    return response;
  };

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return done("error=denied");

  // CSRF / mix-up protection: the state must match the encrypted cookie set by /start for this same user.
  const session = await getSession();
  const user = session?.state === "ok" ? session.user : null;
  const raw = request.cookies.get(OAUTH_COOKIE)?.value;
  let saved: z.infer<typeof cookieSchema>;
  try {
    saved = cookieSchema.parse(JSON.parse(decryptSecret(raw ?? "", "google-oauth")));
  } catch {
    return done("error=state");
  }
  const state = params.get("state") ?? "";
  const code = params.get("code");
  if (!user || saved.uid !== user.id || !code || !safeEqual(state, saved.state)) return done("error=state");

  try {
    const tokens = await exchangeCode(code, saved.verifier);
    const required = GOOGLE_SCOPES[saved.access][2];
    // Google's consent screen lets users untick individual scopes; insist on the one we need.
    if (!tokens.scope.split(" ").includes(required) || !tokens.refresh_token) {
      await revokeToken(tokens.refresh_token ?? tokens.access_token);
      return done("error=scope");
    }

    const email = await fetchUserEmail(tokens.access_token);
    const calendars: GoogleCalendarEntry[] =
      saved.access === "calendarRead" ? await listCalendars(tokens.access_token) : [{ id: "primary", summary: "Primary", primary: true, selected: true }];

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("calendar_sources")
      .select("id, calendars")
      .eq("user_id", user.id)
      .eq("kind", "google")
      .eq("account_label", email)
      .maybeSingle();

    let sourceId: string;
    if (existing) {
      // Reconnecting keeps the user's calendar selection where the calendar still exists.
      const previous = new Map((existing.calendars as unknown as GoogleCalendarEntry[]).map((c) => [c.id, c.selected]));
      const merged = calendars.map((c) => ({ ...c, selected: previous.get(c.id) ?? c.selected }));
      await admin
        .from("calendar_sources")
        .update({ calendars: merged, scope: tokens.scope, status: "active", last_error: null, enabled: true })
        .eq("id", existing.id);
      sourceId = existing.id;
    } else {
      const { data: created, error } = await admin
        .from("calendar_sources")
        .insert({
          user_id: user.id,
          kind: "google",
          flavor: "google",
          name: saved.access === "calendarRead" ? "Google Calendar" : "Google free/busy",
          account_label: email,
          scope: tokens.scope,
          calendars,
          color: "#0f9d8a",
        })
        .select("id")
        .single();
      if (error || !created) throw new Error("could not save source");
      sourceId = created.id;
    }

    await admin
      .from("integration_secrets")
      .upsert({ source_id: sourceId, user_id: user.id, ciphertext: encryptSecret(tokens.refresh_token, secretAad(sourceId)), updated_at: new Date().toISOString() });
    await audit(user.id, "integration.google.connect", "calendar_source", sourceId, { access: saved.access });
    await syncCalendarSource(admin, sourceId);
    return done("connected=google");
  } catch (err) {
    console.error("google connect failed", err instanceof Error ? err.message : err);
    return done("error=google_failed");
  }
}

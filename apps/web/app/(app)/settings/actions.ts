"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { revokeToken } from "@/lib/google";
import { parseIcs } from "@/lib/ics";
import { assertSafeUrl, safeFetchText, UnsafeUrlError } from "@/lib/ssrf";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretAad, syncCalendarSource } from "@/lib/sync";
import type { ActionState } from "@/lib/utils";
import { fieldErrors, formObject, icsSourceSchema, profileSchema, uuid } from "@/lib/validation";

const MAX_SOURCES = 10;

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const parsed = profileSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", user.id);
  if (error) return { message: "Could not save your settings." };
  refresh();
  return { ok: true, message: "Settings saved." };
}

export async function updatePeriods(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const periods: { period: number; start: string; end: string }[] = [];
  for (let n = 1; n <= 15; n++) {
    const start = String(formData.get(`p${n}_start`) ?? "").trim();
    const end = String(formData.get(`p${n}_end`) ?? "").trim();
    if (!start && !end) continue;
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start) {
      return { message: `Period ${n}: enter a start and a later end time.` };
    }
    periods.push({ period: n, start, end });
  }
  if (periods.length === 0) return { message: "Enter at least one period." };
  const { error } = await supabase.from("profiles").update({ period_times: periods }).eq("id", user.id);
  if (error) return { message: "Could not save the periods." };
  refresh();
  return { ok: true, message: "Class periods saved." };
}

export async function addIcsSource(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const parsed = icsSourceSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { count } = await supabase.from("calendar_sources").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_SOURCES) return { message: `You can connect up to ${MAX_SOURCES} calendars.` };

  // Validate and test the URL before storing anything: https only, public hosts, capped response.
  let url: URL;
  try {
    url = assertSafeUrl(parsed.data.url);
    const response = await safeFetchText(url.toString(), { headers: { accept: "text/calendar, text/plain;q=0.8" } });
    if (response.status !== 200) return { errors: { url: [`The server answered HTTP ${response.status}.`] } };
    parseIcs(response.body, { from: new Date(), to: new Date(Date.now() + 86_400_000) }, "UTC");
  } catch (err) {
    const message =
      err instanceof UnsafeUrlError ? err.message : err instanceof Error && /iCalendar/.test(err.message) ? err.message : "Could not load this calendar URL.";
    return { errors: { url: [message] } };
  }

  const admin = createAdminClient();
  const { data: source, error } = await admin
    .from("calendar_sources")
    .insert({
      user_id: user.id,
      kind: "ics",
      flavor: parsed.data.flavor,
      name: parsed.data.name,
      color: parsed.data.flavor === "moodle" ? "#b86e00" : "#64748b",
      account_label: url.hostname,
    })
    .select("id")
    .single();
  if (error || !source) return { message: "Could not save the calendar." };

  // The feed URL usually embeds a personal token, so it is stored encrypted and bound to this row.
  await admin.from("integration_secrets").insert({
    source_id: source.id,
    user_id: user.id,
    ciphertext: encryptSecret(url.toString(), secretAad(source.id)),
  });
  await audit(user.id, "integration.ics.connect", "calendar_source", source.id, { host: url.hostname, flavor: parsed.data.flavor });

  const outcome = await syncCalendarSource(admin, source.id);
  refresh();
  if (!outcome.ok) return { message: `Saved, but the first sync failed: ${outcome.error}` };
  return {
    ok: true,
    message: parsed.data.flavor === "moodle" ? `Connected — ${outcome.tasks ?? 0} deadlines imported.` : `Connected — ${outcome.events ?? 0} events imported.`,
  };
}

async function ownedSource(formData: FormData) {
  const { user, supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return null;
  // Read through the user's client first: RLS proves ownership before any service-role work.
  const { data } = await supabase.from("calendar_sources").select("*").eq("id", id.data).maybeSingle();
  return data ? { user, supabase, source: data } : null;
}

export async function syncSourceNow(formData: FormData): Promise<void> {
  const owned = await ownedSource(formData);
  if (!owned) return;
  const last = owned.source.last_synced_at ? new Date(owned.source.last_synced_at).getTime() : 0;
  if (Date.now() - last < 30_000) return; // throttle manual syncs
  await syncCalendarSource(createAdminClient(), owned.source.id);
  refresh();
}

export async function toggleSource(formData: FormData): Promise<void> {
  const owned = await ownedSource(formData);
  if (!owned) return;
  await owned.supabase.from("calendar_sources").update({ enabled: !owned.source.enabled }).eq("id", owned.source.id);
  refresh();
}

export async function deleteSource(formData: FormData): Promise<void> {
  const owned = await ownedSource(formData);
  if (!owned) return;
  const { source, supabase, user } = owned;
  if (source.kind === "google") {
    // Revoke the grant at Google too, so a leaked ciphertext is useless even if decrypted later.
    const { data: secret } = await createAdminClient().from("integration_secrets").select("ciphertext").eq("source_id", source.id).maybeSingle();
    if (secret) {
      try {
        await revokeToken(decryptSecret(secret.ciphertext, secretAad(source.id)));
      } catch {
        // Undecryptable or already revoked — deleting the row is still the right outcome.
      }
    }
  }
  await supabase.from("calendar_sources").delete().eq("id", source.id);
  await audit(user.id, `integration.${source.kind}.disconnect`, "calendar_source", source.id, { label: source.account_label });
  refresh();
}

const selectionSchema = z.array(z.string().min(1).max(1024)).max(250);

export async function saveGoogleCalendars(formData: FormData): Promise<void> {
  const owned = await ownedSource(formData);
  if (!owned || owned.source.kind !== "google") return;
  const selected = selectionSchema.safeParse(formData.getAll("calendar"));
  if (!selected.success) return;
  const chosen = new Set(selected.data);
  // Only toggle calendars Google reported; ids cannot be injected through the form.
  const calendars = (owned.source.calendars as { id: string; summary: string; primary?: boolean; selected?: boolean }[]).map((c) => ({
    ...c,
    selected: chosen.has(c.id),
  }));
  await owned.supabase.from("calendar_sources").update({ calendars }).eq("id", owned.source.id);
  await syncCalendarSource(createAdminClient(), owned.source.id);
  refresh();
}

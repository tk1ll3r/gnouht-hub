import { audit } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { allow } from "@/lib/rate-limit";

// Everything the account owns, read with the user's own client (RLS), filtered to rows they own.
const OWNED = [
  ["profiles", "id"],
  ["semesters", "user_id"],
  ["courses", "user_id"],
  ["course_sessions", "user_id"],
  ["events", "user_id"],
  ["tasks", "user_id"],
  ["briefs", "user_id"],
  ["projects", "user_id"],
  ["project_documents", "user_id"],
  ["checklist_items", "user_id"],
  ["project_progress_daily", "user_id"],
  ["manual_quotas", "user_id"],
  ["quota_snapshots", "user_id"],
  ["usage_daily", "user_id"],
  ["ai_jobs", "user_id"],
  ["audit_log", "actor_id"],
] as const;

/** Downloads the caller's data as JSON (secrets such as tokens and device keys are never readable). */
export async function GET() {
  const session = await requireApiUser();
  if ("error" in session) return session.error;
  const { user, supabase } = session;
  if (!(await allow(`export:${user.id}`, 5, 3600))) return Response.json({ error: "too many exports, try later" }, { status: 429 });

  const data: Record<string, unknown> = { exportedAt: new Date().toISOString(), email: user.email };
  for (const [table, column] of OWNED) {
    // One generic query per table; the column list above is fixed, so the loose typing is contained here.
    const query = supabase.from(table).select("*") as unknown as { eq(c: string, v: string): { limit(n: number): PromiseLike<{ data: unknown[] | null }> } };
    const { data: rows } = await query.eq(column, user.id).limit(10000);
    data[table] = rows ?? [];
  }
  const [{ data: sources }, { data: devices }, { data: memberships }] = await Promise.all([
    supabase.from("calendar_sources").select("id, kind, flavor, name, color, enabled, account_label, calendars, status, last_synced_at, created_at").eq("user_id", user.id),
    supabase.from("devices").select("id, name, platform, agent_version, last_seen_at, created_at").eq("user_id", user.id),
    supabase.from("group_members").select("group_id, role, share_busy, joined_at, groups(name)").eq("user_id", user.id),
  ]);
  Object.assign(data, { calendar_sources: sources ?? [], devices: devices ?? [], group_memberships: memberships ?? [] });
  await audit(user.id, "account.export", "user", user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="gnouht-hub-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

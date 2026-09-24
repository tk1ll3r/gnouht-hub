import { isAuthorizedCron, unauthorized } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncCalendarSource, type SyncOutcome } from "@/lib/sync";

export const maxDuration = 60;

const BATCH = 25;
const MIN_INTERVAL_MS = 10 * 60_000;
const BUDGET_MS = 45_000;

/** Called every 15 minutes by pg_cron. Syncs the stalest enabled sources within a time budget. */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();
  const started = Date.now();
  const admin = createAdminClient();

  const cutoff = new Date(started - MIN_INTERVAL_MS).toISOString();
  const { data: due, error } = await admin
    .from("calendar_sources")
    .select("id")
    .eq("enabled", true)
    .neq("status", "revoked")
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);
  if (error) return Response.json({ error: "query failed" }, { status: 500 });

  const results: SyncOutcome[] = [];
  const queue = [...(due ?? [])];
  // Three at a time keeps Google/Moodle request rates polite and stays inside the function timeout.
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        if (Date.now() - started > BUDGET_MS) return;
        results.push(await syncCalendarSource(admin, next.id));
      }
    }),
  );

  return Response.json({
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    skipped: queue.length,
    ms: Date.now() - started,
  });
}

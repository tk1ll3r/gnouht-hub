import { enqueueBrief, loadAiStatus } from "@/lib/ai";
import { isAuthorizedCron, unauthorized } from "@/lib/cron";
import { buildToday } from "@/lib/data";
import { briefToHtml, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Called daily at 06:30 (Asia/Ho_Chi_Minh) by pg_cron. Stores each user's heuristic brief, queues an AI
 * version for users who opted in (their agent writes it), and emails the heuristic brief to subscribers.
 */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();
  const admin = createAdminClient();
  const now = new Date();

  // Only users who set up a semester have anything to brief about.
  const { data: semesters } = await admin.from("semesters").select("user_id").eq("is_current", true);
  const userIds = [...new Set((semesters ?? []).map((s) => s.user_id))];
  let stored = 0;
  let emailed = 0;
  let aiQueued = 0;
  const failures: string[] = [];

  for (const userId of userIds) {
    try {
      // The admin client bypasses RLS; buildToday scopes every query by this user id.
      const today = await buildToday(admin, userId, now);
      await admin.from("briefs").upsert(
        { user_id: userId, for_date: today.todayKey, kind: "heuristic", headline: today.brief.headline, markdown: today.brief.markdown },
        { onConflict: "user_id,for_date,kind" },
      );
      stored++;

      // A friendlier AI version is written by the user's own agent, if they opted in and one is online.
      const ai = await loadAiStatus(admin, userId, now);
      if (ai.enabled && ai.device) {
        try {
          await enqueueBrief(admin, userId, today, ai.language);
          aiQueued++;
        } catch (err) {
          console.warn("AI brief not queued", err instanceof Error ? err.message : err);
        }
      }

      if (today.workspace.profile.email_digest) {
        const { data } = await admin.auth.admin.getUserById(userId);
        const email = data.user?.email;
        if (email) {
          const result = await sendEmail({
            to: email,
            subject: today.brief.headline,
            text: `${today.brief.markdown}\n\nOpen the hub: ${env().APP_URL}/today`,
            html: briefToHtml(today.brief.markdown, env().APP_URL),
          });
          if (result.sent) emailed++;
        }
      }
    } catch (err) {
      failures.push(userId);
      console.error("daily brief failed", userId, err instanceof Error ? err.message : err);
    }
  }
  return Response.json({ users: userIds.length, stored, emailed, aiQueued, failed: failures.length });
}

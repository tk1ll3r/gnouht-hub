import { uitPayloadSchema } from "@hub/core/protocol";
import { authenticateAgent } from "@/lib/agent-auth";
import { audit } from "@/lib/audit";

const COLORS = ["#2458e6", "#0f9d8a", "#d0342c", "#b86e00", "#7c3aed", "#db2777", "#0891b2", "#4d7c0f"];

/**
 * Courses and deadlines read by the agent from UIT Moodle with the owner's own token. The UIT password
 * never leaves the owner's PC; only this normalised data is sent.
 */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request, uitPayloadSchema);
  if (!auth.ok) return auth.response;
  const { ctx, body } = auth;
  const { admin } = ctx;
  const userId = ctx.device.userId;

  const { data: semester } = await admin.from("semesters").select("id").eq("user_id", userId).eq("is_current", true).maybeSingle();
  if (!semester) return Response.json({ error: "create a current semester in the hub first" }, { status: 409 });

  const { data: existing } = await admin.from("courses").select("id, code, class_code, moodle_course_id, source").eq("user_id", userId).eq("semester_id", semester.id);
  const courses = existing ?? [];
  const moodleToCourse = new Map<number, string>();
  let created = 0;

  for (const [index, c] of body.courses.entries()) {
    const byMoodle = courses.find((row) => row.moodle_course_id === c.moodleCourseId);
    const byCode = courses.find((row) => row.code.toUpperCase() === c.code.toUpperCase() && (row.class_code ?? "") === (c.classCode ?? row.class_code ?? ""));
    const match = byMoodle ?? byCode;
    if (match) {
      // Link manual courses to Moodle without overwriting what the user typed.
      await admin
        .from("courses")
        .update(match.source === "moodle" ? { name: c.name, url: c.url, moodle_course_id: c.moodleCourseId } : { moodle_course_id: c.moodleCourseId, url: c.url })
        .eq("id", match.id);
      moodleToCourse.set(c.moodleCourseId, match.id);
    } else {
      const { data: inserted } = await admin
        .from("courses")
        .insert({
          user_id: userId,
          semester_id: semester.id,
          code: c.code.toUpperCase(),
          class_code: c.classCode,
          name: c.name,
          url: c.url,
          moodle_course_id: c.moodleCourseId,
          source: "moodle",
          color: COLORS[index % COLORS.length]!,
        })
        .select("id")
        .single();
      if (inserted) {
        moodleToCourse.set(c.moodleCourseId, inserted.id);
        created++;
      }
    }
  }

  const keys = body.deadlines.map((d) => `moodle-ws:${d.eventId}`);
  const { data: tasks } = keys.length
    ? await admin.from("tasks").select("id, source_key, course_id, status").eq("user_id", userId).eq("source", "moodle").in("source_key", keys)
    : { data: [] };
  const byKey = new Map((tasks ?? []).map((t) => [t.source_key, t]));
  for (const d of body.deadlines) {
    const key = `moodle-ws:${d.eventId}`;
    const courseId = d.moodleCourseId ? (moodleToCourse.get(d.moodleCourseId) ?? null) : null;
    const current = byKey.get(key);
    if (current) {
      await admin
        .from("tasks")
        .update({ title: d.title, due_at: d.dueAt, source_ref: { url: d.url }, ...(current.course_id ? {} : { course_id: courseId }) })
        .eq("id", current.id);
    } else {
      await admin.from("tasks").insert({
        user_id: userId,
        source: "moodle",
        source_key: key,
        title: d.title,
        kind: d.kind,
        due_at: d.dueAt,
        course_id: courseId,
        source_ref: { url: d.url },
      });
    }
  }

  if (created) await audit(userId, "uit.import", "device", ctx.device.id, { courses: created });
  return Response.json({ ok: true, coursesCreated: created, coursesLinked: moodleToCourse.size - created, deadlines: body.deadlines.length });
}

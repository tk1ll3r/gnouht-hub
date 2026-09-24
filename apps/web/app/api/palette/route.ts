import { requireApiUser } from "@/lib/auth";
import { allow } from "@/lib/rate-limit";

/** Most files the palette indexes; beyond this the newest are kept (a few hundred KB of JSON at most). */
const MAX_FILES = 5000;

/**
 * Names for quick open: projects, courses and indexed file paths the caller can read (their own, and
 * projects shared with their groups). Read with the user's client, so RLS decides; no file content.
 */
export async function GET() {
  const session = await requireApiUser();
  if ("error" in session) return session.error;
  const { user, supabase } = session;
  if (!(await allow(`palette:${user.id}`, 120, 600))) return Response.json({ error: "slow down" }, { status: 429 });

  const [projects, files, courses] = await Promise.all([
    supabase.from("projects").select("id, name, color").neq("status", "archived").order("name").limit(300),
    supabase.from("project_documents").select("id, project_id, path, kind, language").order("indexed_at", { ascending: false }).limit(MAX_FILES),
    supabase.from("courses").select("id, code, name").order("code").limit(300),
  ]);
  const live = new Set((projects.data ?? []).map((p) => p.id));
  return Response.json(
    {
      projects: projects.data ?? [],
      files: (files.data ?? []).filter((f) => live.has(f.project_id)).map((f) => ({ id: f.id, projectId: f.project_id, path: f.path, kind: f.kind, language: f.language })),
      courses: courses.data ?? [],
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

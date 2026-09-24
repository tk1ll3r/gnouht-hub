import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

/** Status of one of the caller's AI jobs, for the page that waits on it. RLS scopes the lookup. */
export async function GET(_request: Request, { params }: RouteContext<"/api/ai/jobs/[id]">) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!uuid.safeParse(id).success) return Response.json({ error: "not found" }, { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("ai_jobs").select("status").eq("id", id).maybeSingle();
  if (!data) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ status: data.status });
}

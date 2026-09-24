import { requireApiUser } from "@/lib/auth";
import { allow } from "@/lib/rate-limit";
import { uuid } from "@/lib/validation";

/** Status of one of the caller's AI jobs, for the page that waits on it. RLS scopes the lookup. */
export async function GET(_request: Request, { params }: RouteContext<"/api/ai/jobs/[id]">) {
  const { id } = await params;
  const session = await requireApiUser();
  if ("error" in session) return session.error;
  const { user, supabase } = session;
  if (!uuid.safeParse(id).success) return Response.json({ error: "not found" }, { status: 404 });
  if (!(await allow(`poll:${user.id}`, 300, 600))) return Response.json({ error: "slow down" }, { status: 429 });
  const { data } = await supabase.from("ai_jobs").select("status").eq("id", id).maybeSingle();
  if (!data) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ status: data.status });
}

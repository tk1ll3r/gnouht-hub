import { DEFAULT_TZ } from "@hub/core";
import { documentUploadSchema } from "@hub/core/protocol";
import { authenticateAgent } from "@/lib/agent-auth";
import { ingestDocuments } from "@/lib/documents";

/**
 * Step 2 of a folder sync: extracted (and already redacted) text of changed documents, in batches.
 * The hub parses checklists, milestones and search chunks itself with @hub/core.
 */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request, documentUploadSchema);
  if (!auth.ok) return auth.response;
  const { ctx, body } = auth;
  const { admin } = ctx;
  const userId = ctx.device.userId;

  // The project must belong to this device's owner and have been registered by an agent.
  const { data: project } = await admin
    .from("projects")
    .select("id, user_id, status, source")
    .eq("id", body.projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!project || project.source !== "agent") return Response.json({ error: "unknown project" }, { status: 404 });
  if (project.status === "archived") return Response.json({ error: "project is archived" }, { status: 409 });

  const { data: profile } = await admin.from("profiles").select("timezone").eq("id", userId).single();
  const result = await ingestDocuments(admin, { id: project.id, userId }, profile?.timezone ?? DEFAULT_TZ, body.documents);
  if (result.stored === 0) return Response.json({ error: "could not store documents" }, { status: 500 });
  return Response.json({ ok: true, stored: result.stored, failed: result.failed.length });
}

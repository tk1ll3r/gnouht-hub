import { documentUploadSchema } from "@hub/core/protocol";
import { authenticateAgent } from "@/lib/agent-auth";
import { ingestDocuments } from "@/lib/documents";

/**
 * Step 2 of a folder sync: changed files, parsed on the PC (text already redacted), in batches. The device
 * owner must belong to the project; the hub redacts once more and stores each file atomically.
 */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request, documentUploadSchema);
  if (!auth.ok) return auth.response;
  const { ctx, body } = auth;
  const { admin } = ctx;

  const { data: membership } = await admin
    .from("project_members")
    .select("projects!inner(status)")
    .eq("project_id", body.projectId)
    .eq("user_id", ctx.device.userId)
    .maybeSingle();
  if (!membership) return Response.json({ error: "unknown project" }, { status: 404 });
  if (membership.projects.status === "archived") return Response.json({ error: "project is archived" }, { status: 409 });

  const result = await ingestDocuments(admin, { deviceId: ctx.device.id, projectId: body.projectId, folderKey: body.folderKey }, body.documents);
  if (result.stored === 0) return Response.json({ error: "could not store documents" }, { status: 500 });
  return Response.json({ ok: true, stored: result.stored, failed: result.failed.length });
}

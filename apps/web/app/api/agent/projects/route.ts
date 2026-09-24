import { projectSyncSchema } from "@hub/core/protocol";
import { authenticateAgent } from "@/lib/agent-auth";
import { audit } from "@/lib/audit";
import { reconcileManifest } from "@/lib/documents";

const MAX_AGENT_PROJECTS = 30;
const COLORS = ["#7c3aed", "#0f9d8a", "#db2777", "#b86e00", "#2458e6", "#0891b2", "#4d7c0f", "#d0342c"];

/**
 * Step 1 of a folder sync: the agent sends the listing (path + hash) of a watched folder. The hub finds or
 * creates the project, drops documents that disappeared and answers with the paths it needs.
 */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request, projectSyncSchema);
  if (!auth.ok) return auth.response;
  const { ctx, body } = auth;
  const { admin } = ctx;
  const userId = ctx.device.userId;

  const { data: existing } = await admin
    .from("projects")
    .select("id, status")
    .eq("user_id", userId)
    .eq("folder_key", body.folderKey)
    .maybeSingle();

  let project = existing;
  if (!project) {
    const { count } = await admin.from("projects").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("source", "agent");
    if ((count ?? 0) >= MAX_AGENT_PROJECTS) return Response.json({ error: "folder limit reached — remove a project in the hub first" }, { status: 409 });
    const { data: created, error } = await admin
      .from("projects")
      .insert({
        user_id: userId,
        name: body.name,
        source: "agent",
        folder_key: body.folderKey,
        folder_label: body.folderLabel,
        device_id: ctx.device.id,
        color: COLORS[(count ?? 0) % COLORS.length]!,
      })
      .select("id, status")
      .single();
    if (error || !created) return Response.json({ error: "could not create the project" }, { status: 500 });
    project = created;
    await audit(userId, "project.create", "project", created.id, { device: ctx.device.id, files: body.manifest.length });
  }

  // Archived projects stay frozen: nothing is deleted or requested until the owner reactivates them.
  if (project.status === "archived") {
    return Response.json({ projectId: project.id, archived: true, need: [] });
  }

  await admin.from("projects").update({ folder_label: body.folderLabel, device_id: ctx.device.id }).eq("id", project.id);
  let result: { need: string[]; removed: number };
  try {
    result = await reconcileManifest(admin, project.id, body.manifest);
  } catch {
    return Response.json({ error: "could not reconcile documents" }, { status: 500 });
  }
  if (result.removed) await admin.rpc("refresh_project_stats", { p_project: project.id });
  return Response.json({ projectId: project.id, archived: false, need: result.need });
}

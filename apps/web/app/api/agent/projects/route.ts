import { projectSyncSchema } from "@hub/core/protocol";
import { authenticateAgent } from "@/lib/agent-auth";
import { audit } from "@/lib/audit";
import { reconcileManifest } from "@/lib/documents";
import type { AdminClient } from "@/lib/supabase/admin";

const MAX_FOLDER_PROJECTS = 30;
const COLORS = ["#7c3aed", "#0f9d8a", "#db2777", "#b86e00", "#2458e6", "#0891b2", "#4d7c0f", "#d0342c"];

type Found = { id: string; status: string } | { error: string; status: number };

/**
 * Which project a watched folder feeds: an explicit team project the device owner belongs to, else the
 * owner's project already linked to this folder, else the owner's unlinked project with the folder's slug
 * (so a project created in the hub can be fed from a PC), else a new project.
 */
async function resolveProject(admin: AdminClient, userId: string, body: { folderKey: string; slug: string; name: string; folderLabel: string; projectId: string | null }): Promise<Found> {
  if (body.projectId) {
    const { data } = await admin
      .from("project_members")
      .select("role, projects!inner(id, status)")
      .eq("project_id", body.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return { error: "unknown project, or you are not a member of it", status: 404 };
    return { id: data.projects.id, status: data.projects.status };
  }

  const { data: linked } = await admin.from("projects").select("id, status").eq("owner_id", userId).eq("folder_key", body.folderKey).maybeSingle();
  if (linked) return linked;

  const { data: bySlug } = await admin.from("projects").select("id, status").eq("owner_id", userId).eq("slug", body.slug).is("folder_key", null).maybeSingle();
  if (bySlug) {
    await admin.from("projects").update({ folder_key: body.folderKey, folder_label: body.folderLabel }).eq("id", bySlug.id);
    await audit(userId, "project.link_folder", "project", bySlug.id);
    return bySlug;
  }

  const { count } = await admin.from("projects").select("id", { count: "exact", head: true }).eq("owner_id", userId).not("folder_key", "is", null);
  if ((count ?? 0) >= MAX_FOLDER_PROJECTS) return { error: "folder limit reached — remove a project in the hub first", status: 409 };
  // The slug is taken by a project fed from another folder: pick the next free one.
  const { data: taken } = await admin.from("projects").select("slug").eq("owner_id", userId).like("slug", `${body.slug.slice(0, 36)}%`);
  const used = new Set((taken ?? []).map((p) => p.slug));
  let slug = body.slug;
  for (let n = 2; used.has(slug) && n < 100; n++) slug = `${body.slug.slice(0, 36)}-${n}`;
  const { data: created, error } = await admin
    .from("projects")
    .insert({
      owner_id: userId,
      slug,
      name: body.name,
      kind: "personal",
      folder_key: body.folderKey,
      folder_label: body.folderLabel,
      color: COLORS[(count ?? 0) % COLORS.length]!,
    })
    .select("id, status")
    .single();
  if (error || !created) return { error: "could not create the project", status: 500 };
  // A folder of one's own is the project's content: share it with (future) members by default.
  await admin.from("project_members").update({ shares_documents: true }).eq("project_id", created.id).eq("user_id", userId);
  await audit(userId, "project.create", "project", created.id);
  return created;
}

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

  const project = await resolveProject(admin, userId, body);
  if ("error" in project) return Response.json({ error: project.error }, { status: project.status });

  // Archived projects stay frozen: nothing is deleted or requested until they are reactivated.
  if (project.status === "archived") {
    return Response.json({ projectId: project.id, archived: true, need: [] });
  }
  await admin.from("projects").update({ last_synced_at: new Date().toISOString() }).eq("id", project.id);
  const target = { deviceId: ctx.device.id, projectId: project.id, folderKey: body.folderKey };
  let result: { need: string[]; removed: number };
  try {
    result = await reconcileManifest(admin, target, body.manifest);
  } catch {
    return Response.json({ error: "could not reconcile documents" }, { status: 500 });
  }
  if (result.removed) await admin.rpc("refresh_project_stats", { p_project: project.id });
  return Response.json({ projectId: project.id, archived: false, need: result.need });
}

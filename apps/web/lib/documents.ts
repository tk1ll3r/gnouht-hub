import "server-only";
import { describeChunks, redactSecrets, type ChecklistStats } from "@hub/core";
import type { Json } from "@hub/core/db";
import type { DocumentPayloadItem } from "@hub/core/protocol";
import type { AdminClient } from "./supabase/admin";

const MAX_CHUNK_CHARS = 4000;

/** Redacts again on the hub (defence in depth: the agent already did) and counts what it removed. */
function scrub(text: string, counter: { n: number }): string {
  const { text: clean, count } = redactSecrets(text);
  counter.n += count;
  return clean;
}

export function checklistStats(items: { status: string }[]): ChecklistStats {
  const stats: ChecklistStats = { total: 0, todo: 0, doing: 0, attention: 0, done: 0, cut: 0 };
  for (const item of items) {
    if (!(item.status in stats) || item.status === "total") continue;
    stats.total++;
    stats[item.status as keyof Omit<ChecklistStats, "total">]++;
  }
  return stats;
}

/**
 * The JSON arguments of `public.ingest_document` for one uploaded file. The agent parsed the file; the hub
 * redacts every text field once more and derives each chunk's line, heading and search terms from the
 * chunks themselves (they are contiguous) and the file's outline.
 */
export function ingestArgs(doc: DocumentPayloadItem) {
  const removed = { n: 0 };
  const contents = doc.chunks.map((c) => scrub(c, removed).slice(0, MAX_CHUNK_CHARS));
  const chunks = describeChunks(contents, doc.outline, doc.kind).map((c) => ({
    idx: c.ord,
    content: c.content,
    line: c.line,
    heading: c.heading,
    terms: c.terms ?? null,
  }));
  const items = (doc.checklist ?? []).map((i) => ({ ...i, text: scrub(i.text, removed).slice(0, 1000) }));
  const milestones = doc.milestones.map((m) => ({ ...m, title: scrub(m.title, removed).slice(0, 300) }));
  const document = {
    path: doc.path,
    title: scrub(doc.title, removed).slice(0, 300),
    ext: doc.ext,
    kind: doc.kind,
    language: doc.language,
    sizeBytes: doc.sizeBytes,
    sha256: doc.sha256,
    modifiedAt: doc.modifiedAt,
    excerpt: scrub(doc.excerpt, removed).slice(0, 600),
    checklist: doc.checklist ? checklistStats(doc.checklist) : null,
    lineCount: doc.lineCount,
    outline: doc.outline,
    todos: doc.todos.map((t) => ({ ...t, text: scrub(t.text, removed).slice(0, 200) })),
    truncated: doc.truncated,
    error: doc.error,
    redactions: 0,
  };
  document.redactions = doc.redactions + removed.n;
  return { document, chunks, items, milestones };
}

/** Stores each uploaded file (one atomic RPC per file), then refreshes the project's totals. */
export async function ingestDocuments(admin: AdminClient, target: { deviceId: string; projectId: string; folderKey: string }, documents: DocumentPayloadItem[]) {
  let stored = 0;
  const failed: string[] = [];
  for (const doc of documents) {
    const args = ingestArgs(doc);
    const { error } = await admin.rpc("ingest_document", {
      p_device: target.deviceId,
      p_project: target.projectId,
      p_root: target.folderKey,
      p_document: args.document as unknown as Json,
      p_chunks: args.chunks as unknown as Json,
      p_items: args.items as unknown as Json,
      p_milestones: args.milestones as unknown as Json,
    });
    if (error) {
      console.error("ingest_document failed", error.code, error.message);
      failed.push(doc.path);
    } else {
      stored++;
    }
  }
  await admin.rpc("refresh_project_stats", { p_project: target.projectId });
  return { stored, failed };
}

/**
 * Deletes this folder's documents that are no longer in the agent's listing and returns the paths it must
 * (re)send: new or changed files, and files that were synced into a different project before.
 */
export async function reconcileManifest(
  admin: AdminClient,
  target: { deviceId: string; projectId: string; folderKey: string },
  manifest: { path: string; hash: string }[],
) {
  const { data: rows, error } = await admin
    .from("documents")
    .select("id, path, sha256, project_id")
    .eq("device_id", target.deviceId)
    .eq("root_key", target.folderKey);
  if (error) throw new Error("could not read documents");
  const wanted = new Map(manifest.map((m) => [m.path, m.hash]));
  const stale = (rows ?? []).filter((row) => !wanted.has(row.path)).map((row) => row.id);
  for (let i = 0; i < stale.length; i += 100) {
    await admin.from("documents").delete().in("id", stale.slice(i, i + 100));
  }
  const stored = new Map((rows ?? []).map((row) => [row.path, row]));
  const need = manifest
    .filter((m) => {
      const row = stored.get(m.path);
      return !row || row.sha256 !== m.hash || row.project_id !== target.projectId;
    })
    .map((m) => m.path);
  return { need, removed: stale.length };
}

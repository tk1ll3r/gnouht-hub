import "server-only";
import { analyzeDocument, inferTaskKind, zonedInstant, type DocumentAnalysis } from "@hub/core";
import type { Json } from "@hub/core/db";
import type { DocumentUpload } from "@hub/core/protocol";
import type { AdminClient } from "./supabase/admin";

/** Checklist items stored per document; the rest still count towards progress. */
const MAX_ITEMS_PER_DOCUMENT = 2000;
const END_OF_DAY_MINUTES = 23 * 60 + 59;

type UploadedDocument = DocumentUpload["documents"][number];

/** The JSON arguments of `public.ingest_document` for one uploaded document. */
export function ingestArgs(doc: UploadedDocument, analysis: DocumentAnalysis, tz: string) {
  const document = {
    path: doc.path,
    kind: doc.kind,
    title: analysis.title,
    hash: doc.hash,
    sizeBytes: doc.sizeBytes,
    modifiedAt: doc.modifiedAt,
    content: analysis.text,
    truncated: doc.truncated,
    redactions: doc.redactions + analysis.redactions,
    referenceDate: analysis.referenceDate,
    stats: { ...analysis.checklist.stats },
    error: doc.error,
  };
  const chunks = analysis.chunks.map((c) => ({ ord: c.ord, heading: c.heading, content: c.content, line: c.line }));
  const items = analysis.checklist.items.slice(0, MAX_ITEMS_PER_DOCUMENT).map((item) => ({
    key: item.key,
    text: item.text,
    status: item.status,
    section: item.section?.slice(0, 300) ?? null,
    line: item.line,
    indent: Math.min(item.indent, 100),
  }));
  const deadlines = analysis.deadlines.map((d) => ({
    key: d.key,
    title: d.title,
    kind: d.origin === "table" ? "milestone" : inferTaskKind(d.title),
    // Date-only deadlines are due at the end of that day in the owner's time zone.
    dueAt: zonedInstant(d.dueDate, END_OF_DAY_MINUTES, tz).toISOString(),
    ref: {
      path: doc.path,
      line: d.line,
      hard: d.hard,
      start: d.startDate,
      origin: d.origin,
      ...(d.status ? { fileStatus: d.status } : {}),
    },
  }));
  return { document, chunks, items, deadlines };
}

export interface IngestProject {
  id: string;
  userId: string;
}

/** Analyses and stores each uploaded document (one atomic RPC per document), then refreshes totals. */
export async function ingestDocuments(admin: AdminClient, project: IngestProject, tz: string, documents: UploadedDocument[]) {
  let stored = 0;
  const failed: string[] = [];
  for (const doc of documents) {
    const analysis = analyzeDocument({ path: doc.path, kind: doc.kind, text: doc.text });
    const args = ingestArgs(doc, analysis, tz);
    const { error } = await admin.rpc("ingest_document", {
      p_project: project.id,
      p_document: args.document as Json,
      p_chunks: args.chunks as Json,
      p_items: args.items as Json,
      p_deadlines: args.deadlines as Json,
    });
    if (error) {
      console.error("ingest_document failed", error.code, error.message);
      failed.push(doc.path);
    } else {
      stored++;
    }
  }
  await admin.rpc("refresh_project_stats", { p_project: project.id });
  return { stored, failed };
}

/** Deletes documents that are no longer in the agent's listing and returns the paths it must (re)send. */
export async function reconcileManifest(admin: AdminClient, projectId: string, manifest: { path: string; hash: string }[]) {
  const { data: rows, error } = await admin.from("project_documents").select("id, path, content_hash").eq("project_id", projectId);
  if (error) throw new Error("could not read documents");
  const wanted = new Map(manifest.map((m) => [m.path, m.hash]));
  const stale = (rows ?? []).filter((row) => !wanted.has(row.path)).map((row) => row.id);
  for (let i = 0; i < stale.length; i += 100) {
    await admin.from("project_documents").delete().in("id", stale.slice(i, i + 100));
  }
  const stored = new Map((rows ?? []).map((row) => [row.path, row.content_hash]));
  const need = manifest.filter((m) => stored.get(m.path) !== m.hash).map((m) => m.path);
  return { need, removed: stale.length };
}

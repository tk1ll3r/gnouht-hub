import { analyzeDocument, extensionOf } from "@hub/core";
import type { DocumentPayloadItem, DocumentUpload, ProjectSync } from "@hub/core/protocol";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CloudError, type CloudClient } from "./cloud";
import { extractText, folderKey, folderLabel, listFolder, sha256, type ListedFile, type WatchedFolder } from "./documents";

/** Keep each upload comfortably under the hub's 512 KB body limit. */
const BATCH_BYTES = 400 * 1024;
const BATCH_DOCUMENTS = 40;

interface CacheEntry {
  size: number;
  mtimeMs: number;
  hash: string;
}

/**
 * Remembers the content hash per file (keyed by absolute path, size and mtime) so a sync only reads
 * files that changed. Losing the cache is harmless: the hub compares hashes, not timestamps.
 */
export class HashCache {
  private entries: Record<string, CacheEntry> = {};
  private dirty = false;

  constructor(private readonly file: string | null) {
    if (!file) return;
    try {
      this.entries = JSON.parse(readFileSync(file, "utf8")) as Record<string, CacheEntry>;
    } catch {
      this.entries = {};
    }
  }

  get(file: ListedFile): string | null {
    const entry = this.entries[file.absolute];
    return entry && entry.size === file.size && entry.mtimeMs === file.mtimeMs ? entry.hash : null;
  }

  set(file: ListedFile, hash: string): void {
    this.entries[file.absolute] = { size: file.size, mtimeMs: file.mtimeMs, hash };
    this.dirty = true;
  }

  /** Drops entries of files that no longer exist under any watched folder. */
  retain(absolutePaths: Set<string>): void {
    for (const key of Object.keys(this.entries)) {
      if (!absolutePaths.has(key)) {
        delete this.entries[key];
        this.dirty = true;
      }
    }
  }

  save(): void {
    if (!this.file || !this.dirty) return;
    mkdirSync(join(this.file, ".."), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.entries), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
    this.dirty = false;
  }
}

export interface FolderSyncResult {
  name: string;
  projectId: string | null;
  files: number;
  uploaded: number;
  skipped: number;
  truncated: boolean;
  archived: boolean;
  errors: string[];
}

/**
 * The analysed file as the hub stores it. Parsing happens here, on the owner's PC, from text that was
 * already redacted; the hub validates the result and redacts once more.
 */
export function toPayloadItem(file: ListedFile, sha: string, extracted: { text: string; truncated: boolean; redactions: number; error: string | null }): DocumentPayloadItem {
  const analysis = analyzeDocument({ path: file.path, kind: file.kind, text: extracted.text });
  const items = analysis.checklist.items.slice(0, 2000);
  return {
    path: file.path,
    title: analysis.title,
    ext: extensionOf(file.path),
    kind: file.kind,
    language: analysis.language,
    sizeBytes: file.size,
    sha256: sha,
    modifiedAt: new Date(file.mtimeMs).toISOString(),
    excerpt: analysis.excerpt,
    chunks: analysis.chunks.map((c) => c.content),
    checklist: items.length
      ? items.map((i) => ({ key: i.key, text: i.text.slice(0, 1000), status: i.status, section: i.section?.slice(0, 300) ?? null, line: i.line, indent: Math.min(i.indent, 100) }))
      : null,
    milestones: analysis.deadlines.slice(0, 300).map((d) => ({
      key: d.key,
      title: d.title,
      dueDate: d.dueDate,
      startDate: d.startDate,
      hard: d.hard,
      line: d.line,
      done: d.status === "done",
      origin: d.origin,
    })),
    lineCount: analysis.lineCount,
    outline: analysis.outline,
    todos: analysis.todos,
    truncated: extracted.truncated,
    redactions: extracted.redactions + analysis.redactions,
    error: extracted.error,
  };
}

/**
 * Syncs one watched folder: send the listing, then upload only what the hub asks for. The hub's answer
 * is intersected with the local listing, so it can never make the agent read a file it did not list.
 */
export async function syncFolder(cloud: CloudClient, folder: WatchedFolder, cache: HashCache, seen?: Set<string>): Promise<FolderSyncResult> {
  const listing = await listFolder(folder);
  for (const file of listing.files) seen?.add(file.absolute);
  const byPath = new Map(listing.files.map((f) => [f.path, f]));
  const errors: string[] = [];

  const manifest: ProjectSync["manifest"] = [];
  for (const file of listing.files) {
    let hash = cache.get(file);
    if (!hash) {
      try {
        hash = sha256(await readFile(file.absolute));
        cache.set(file, hash);
      } catch {
        byPath.delete(file.path);
        continue;
      }
    }
    manifest.push({ path: file.path, hash });
  }

  const key = folderKey(folder.root);
  const response = await cloud.post<{ projectId: string; archived: boolean; need: string[] }>("/api/agent/projects", {
    folderKey: key,
    name: folder.name,
    slug: folder.slug,
    projectId: folder.projectId ?? null,
    folderLabel: folderLabel(folder.root),
    manifest,
  } satisfies ProjectSync);
  const result: FolderSyncResult = {
    name: folder.name,
    projectId: response.projectId,
    files: manifest.length,
    uploaded: 0,
    skipped: listing.skipped,
    truncated: listing.truncated,
    archived: response.archived,
    errors,
  };
  if (response.archived) return result;

  let batch: DocumentPayloadItem[] = [];
  let batchBytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const res = await cloud.post<{ stored: number; failed: number }>("/api/agent/documents", {
      projectId: response.projectId,
      folderKey: key,
      documents: batch,
    } satisfies DocumentUpload);
    result.uploaded += res.stored;
    if (res.failed) errors.push(`${res.failed} document(s) could not be stored`);
    batch = [];
    batchBytes = 0;
  };

  for (const path of response.need) {
    const file = byPath.get(path);
    if (!file) continue; // not in our own listing: ignore
    let bytes: Buffer;
    try {
      bytes = await readFile(file.absolute);
    } catch {
      continue; // deleted since listing; the next sync drops it
    }
    // Hash what is actually sent (the file may have changed since it was listed).
    const hash = sha256(bytes);
    cache.set(file, hash);
    const extracted = await extractText(file.kind, bytes);
    if (extracted.error) errors.push(`${file.path}: ${extracted.error}`.slice(0, 200));
    const doc = toPayloadItem(file, hash, extracted);
    const size = Buffer.byteLength(JSON.stringify(doc));
    if (batch.length && (batchBytes + size > BATCH_BYTES || batch.length >= BATCH_DOCUMENTS)) await flush();
    batch.push(doc);
    batchBytes += size;
  }
  await flush();
  return result;
}

/** Syncs every watched folder; one failing folder does not stop the others. */
export async function syncAllFolders(cloud: CloudClient, folders: WatchedFolder[], cache: HashCache): Promise<FolderSyncResult[]> {
  const results: FolderSyncResult[] = [];
  const seen = new Set<string>();
  for (const folder of folders) {
    try {
      results.push(await syncFolder(cloud, folder, cache, seen));
    } catch (err) {
      // A revoked device must stop the agent, not be reported as a per-folder error.
      if (err instanceof CloudError && err.status === 401) throw err;
      results.push({
        name: folder.name,
        projectId: null,
        files: 0,
        uploaded: 0,
        skipped: 0,
        truncated: false,
        archived: false,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }
  cache.retain(seen);
  cache.save();
  return results;
}

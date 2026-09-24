import { CODE_EXCLUDE, CODE_INCLUDE, documentKindOf, isSafeRelativePath, MAX_CODE_BYTES, MAX_DOCUMENT_CHARS, redactSecrets, type DocumentKind } from "@hub/core";
import { MAX_PROJECT_FILES } from "@hub/core/protocol";
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse, resolve } from "node:path";
import picomatch from "picomatch";

/** Markdown, plain text and Word by default; PDFs and slides are opt-in (`--include "**\/*.pdf"`). */
export const DEFAULT_INCLUDE = ["**/*.md", "**/*.markdown", "**/*.txt", "**/*.docx"];

/** `project add --code`: the notes plus source files (configuration files stay opt-in through --include). */
export const CODE_PRESET = [...DEFAULT_INCLUDE, ...CODE_INCLUDE];

/**
 * Always skipped, whatever the include globs say. Dot files and folders (.git, .env, .obsidian, …) are
 * skipped too because globs do not match them. Names that suggest secrets are never read.
 */
export const ALWAYS_EXCLUDE = [
  "**/node_modules/**",
  "**/venv/**",
  "**/__pycache__/**",
  "**/site-packages/**",
  "**/dist/**",
  "**/build/**",
  "**/~$*",
  "**/*secret*",
  "**/*credential*",
  "**/*password*",
  "**/*passwd*",
  "**/*.key",
  "**/*.pem",
  "**/id_rsa*",
  "**/id_ed25519*",
  // Build output, vendored dependencies, lock and generated files.
  ...CODE_EXCLUDE,
];

const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_BINARY_BYTES = 30 * 1024 * 1024;
const MAX_DEPTH = 16;

export interface WatchedFolder {
  root: string;
  name: string;
  include: string[];
  exclude: string[];
}

export interface ListedFile {
  /** Relative forward-slash path, validated with isSafeRelativePath. */
  path: string;
  absolute: string;
  kind: DocumentKind;
  size: number;
  mtimeMs: number;
}

export interface FolderListing {
  files: ListedFile[];
  /** Files matched by the globs but skipped (too large or an unusable name). */
  skipped: number;
  /** True when the folder has more files than one project may hold. */
  truncated: boolean;
}

function matchers(folder: WatchedFolder) {
  const options = { dot: false, nocase: true };
  const include = picomatch(folder.include.length ? folder.include : DEFAULT_INCLUDE, options);
  const exclude = picomatch([...ALWAYS_EXCLUDE, ...folder.exclude], options);
  return { include, exclude };
}

/**
 * Lists indexable files under the folder. Symbolic links and junctions are never followed, so the
 * listing cannot escape the folder; every returned path is relative and safe to send.
 */
export async function listFolder(folder: WatchedFolder, maxFiles = MAX_PROJECT_FILES): Promise<FolderListing> {
  const root = resolve(folder.root);
  const { include, exclude } = matchers(folder);
  const files: ListedFile[] = [];
  let skipped = 0;
  let truncated = false;
  const stack: { dir: string; rel: string; depth: number }[] = [{ dir: root, rel: "", depth: 0 }];

  while (stack.length && !truncated) {
    const { dir, rel, depth } = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      // An unreadable root (unplugged drive, renamed folder) must not look like "every file was deleted".
      if (depth === 0) throw new Error(`cannot read ${folder.name}: ${err instanceof Error ? err.message : "error"}`);
      continue; // unreadable subfolder: skip rather than abort the sync
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth + 1 < MAX_DEPTH && !exclude(`${relPath}/`) && !exclude(`${relPath}/x`)) {
          stack.push({ dir: join(dir, entry.name), rel: relPath, depth: depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const kind = documentKindOf(entry.name);
      if (!kind || !include(relPath) || exclude(relPath)) continue;
      if (!isSafeRelativePath(relPath)) {
        skipped++;
        continue;
      }
      const absolute = join(dir, entry.name);
      let info;
      try {
        info = await stat(absolute);
      } catch {
        continue;
      }
      const limit = kind === "code" ? MAX_CODE_BYTES : kind === "markdown" || kind === "text" ? MAX_TEXT_BYTES : MAX_BINARY_BYTES;
      if (info.size > limit) {
        skipped++;
        continue;
      }
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      files.push({ path: relPath, absolute, kind, size: info.size, mtimeMs: info.mtimeMs });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped, truncated };
}

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Identity of a watched folder: hash of its normalised absolute path (case-insensitive on Windows). */
export function folderKey(root: string, platform: NodeJS.Platform = process.platform): string {
  let normalised = resolve(root).replace(/\\/g, "/").replace(/\/+$/, "");
  if (platform === "win32") normalised = normalised.toLowerCase();
  return sha256(normalised);
}

/** "…/Research/IDS": enough to recognise the folder without revealing the full path. */
export function folderLabel(root: string): string {
  const segments = resolve(root).split(/[\\/]+/).filter(Boolean);
  return `…/${segments.slice(-2).join("/")}`.slice(0, 200);
}

/** Refuses folders so broad that indexing them would sweep up unrelated personal files. */
export function checkFolderScope(root: string): string | null {
  const absolute = resolve(root);
  const trim = (p: string) => p.replace(/[\\/]+$/, "");
  if (trim(absolute) === trim(parse(absolute).root)) {
    return "Refusing to watch a whole drive. Pick a project folder.";
  }
  const home = resolve(homedir());
  const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p).replace(/[\\/]+$/, "");
  if (norm(absolute) === norm(home) || norm(home).startsWith(`${norm(absolute)}${process.platform === "win32" ? "\\" : "/"}`)) {
    return "Refusing to watch your home folder or one of its parents. Pick a project folder.";
  }
  return null;
}

export interface ExtractedText {
  text: string;
  truncated: boolean;
  redactions: number;
  error: string | null;
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Slide text from a .pptx: each slide's paragraphs under "## Slide N". Decompression is capped (zip bombs). */
export async function pptxText(bytes: Uint8Array): Promise<string> {
  const { unzipSync } = await import("fflate");
  let budget = 40 * 1024 * 1024;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (!/^ppt\/slides\/slide\d+\.xml$/.test(file.name)) return false;
      budget -= file.originalSize;
      return file.originalSize <= 5 * 1024 * 1024 && budget >= 0;
    },
  });
  const slides = Object.keys(files)
    .map((name) => ({ name, n: Number(/slide(\d+)\.xml$/.exec(name)![1]) }))
    .sort((a, b) => a.n - b.n);
  const decoder = new TextDecoder("utf-8");
  return slides
    .map(({ name, n }) => {
      const xml = decoder.decode(files[name]!);
      const paragraphs = [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)]
        .map((p) => [...p[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1]!)).join(""))
        .filter((line) => line.trim());
      return `## Slide ${n}\n${paragraphs.join("\n")}`;
    })
    .join("\n\n");
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((page, index) => `## Page ${index + 1}\n${page.trim()}`).join("\n\n");
  } finally {
    await pdf.cleanup();
  }
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await (mammoth.default ?? mammoth).extractRawText({ buffer: Buffer.from(bytes) });
  return value.replace(/\n{3,}/g, "\n\n");
}

/**
 * Text of one file, with secrets redacted and the length capped — this is exactly what leaves the PC.
 * Extraction errors are reported per file instead of failing the whole sync.
 */
export async function extractText(kind: DocumentKind, bytes: Uint8Array): Promise<ExtractedText> {
  let raw: string;
  // A NUL byte early on means a binary file that happens to have a source extension (e.g. a compiled .m).
  if ((kind === "code" || kind === "text") && bytes.subarray(0, 8192).includes(0) && !(bytes[0] === 0xff && bytes[1] === 0xfe) && !(bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return { text: "", truncated: false, redactions: 0, error: "looks like a binary file, skipped" };
  }
  try {
    raw =
      kind === "markdown" || kind === "text" || kind === "code"
        ? decodeText(bytes)
        : kind === "docx"
          ? await docxText(bytes)
          : kind === "pdf"
            ? await pdfText(bytes)
            : await pptxText(bytes);
  } catch (err) {
    return { text: "", truncated: false, redactions: 0, error: `could not read ${kind}: ${err instanceof Error ? err.message : "error"}`.slice(0, 200) };
  }
  const { text, count } = redactSecrets(raw.normalize("NFC").replace(/\u0000/g, ""));
  const truncated = text.length > MAX_DOCUMENT_CHARS;
  // Do not cut a surrogate pair in half.
  let cut = truncated ? text.slice(0, MAX_DOCUMENT_CHARS) : text;
  if (truncated && /[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return { text: cut, truncated, redactions: count, error: null };
}

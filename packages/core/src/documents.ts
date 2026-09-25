import { parseChecklist, type ChecklistResult, type ChecklistStatus } from "./checklist";
import { codeLanguageOf, extractTodos, identifierWords, outlineOf, symbolPathAt, type CodeTodo, type OutlineSymbol } from "./code";
import { findReferenceDate, parseDateCell, parseDeadlineTables } from "./deadline-table";
import { normalizeForKey, stableHash } from "./hash";
import { isFenceLine, isTableSeparator, parseHeading, stripInlineMarkdown } from "./markdown";
import { redactSecrets } from "./redact";

export const DOCUMENT_KINDS = ["markdown", "text", "docx", "pdf", "pptx", "code"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Extracted text kept per document (characters). Longer documents are truncated by the agent. */
export const MAX_DOCUMENT_CHARS = 120_000;
export const MAX_CHUNKS_PER_DOCUMENT = 400;

const EXTENSION_KINDS: Record<string, DocumentKind> = {
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  docx: "docx",
  pdf: "pdf",
  pptx: "pptx",
};

export function documentKindOf(path: string): DocumentKind | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  const kind = ext ? (EXTENSION_KINDS[ext] ?? null) : null;
  // "CMakeLists.txt" is code; other .txt files stay plain text.
  if (kind && !(kind === "text" && codeLanguageOf(path))) return kind;
  return codeLanguageOf(path) ? "code" : null;
}

/** Language id for highlighting: the code language, "markdown" for notes, null for everything else. */
export function documentLanguageOf(path: string, kind: DocumentKind): string | null {
  if (kind === "code") return codeLanguageOf(path);
  return kind === "markdown" ? "markdown" : null;
}

/**
 * A relative, forward-slash path inside a watched folder. It is only ever a label: the hub never
 * touches a filesystem, and the agent resolves paths from its own listing, not from the hub.
 */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 500 || path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path)) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export interface DocumentChunk {
  ord: number;
  /** The heading (notes) or symbol (code) the chunk starts in, "Section › Subsection", or null. */
  heading: string | null;
  content: string;
  /** 1-based line where the chunk starts. */
  line: number;
  /** Split identifiers of source chunks ("parse checklist"), searchable but not shown. */
  terms?: string;
}

/** Most chunks one document may have (the protocol's limit). */
export const MAX_CHUNKS = 150;
const MAX_CHUNK_CHARS = 4000;

/**
 * Cuts text into contiguous slices: concatenated in order they give the text back, so line numbers stay
 * exact. Cuts fall at headings (notes) or blank lines once a slice is big enough, and inside a line only
 * when a single line is longer than the limit.
 */
export function splitText(text: string, options: { headings?: boolean; target?: number; max?: number } = {}): string[] {
  const max = options.max ?? MAX_CHUNK_CHARS;
  const target = options.target ?? 1800;
  const out: string[] = [];
  let current = "";
  let inFence = false;
  const push = () => {
    if (current) out.push(current);
    current = "";
  };
  for (let line of text.split(/(?<=\n)/)) {
    const fence = isFenceLine(line);
    const heading = Boolean(options.headings) && !inFence && !fence && /^#{1,6}\s/.test(line);
    if (fence) inFence = !inFence;
    if (heading && current.length >= 400) push();
    if (current.length + line.length > max) push();
    while (line.length > max) {
      // Never split a surrogate pair.
      const cut = /[\uD800-\uDBFF]/.test(line[max - 1]!) ? max - 1 : max;
      out.push(line.slice(0, cut));
      line = line.slice(cut);
    }
    current += line;
    if (!line.trim() && current.length >= target) push();
  }
  push();
  // Pack neighbours together if a file of many small sections produced too many slices.
  for (let limit = max; out.length > MAX_CHUNKS; ) {
    const packed: string[] = [];
    for (const piece of out) {
      if (packed.length && packed.at(-1)!.length + piece.length <= limit) packed[packed.length - 1] += piece;
      else packed.push(piece);
    }
    if (packed.length === out.length) break;
    out.splice(0, out.length, ...packed);
  }
  return out;
}

/** Line, heading and search terms of each slice, from the slices themselves and the file's outline. */
export function describeChunks(contents: string[], outline: OutlineSymbol[], kind: DocumentKind): DocumentChunk[] {
  let line = 1;
  return contents.map((content, ord) => {
    const start = line;
    line += (content.match(/\n/g) ?? []).length;
    const firstText = start + Math.max(content.split("\n").findIndex((l) => l.trim()), 0);
    const chunk: DocumentChunk = { ord, heading: symbolPathAt(outline, firstText), content, line: start };
    if (kind === "code") chunk.terms = identifierWords(content);
    return chunk;
  });
}

/** A short plain-text preview for lists (first lines, Markdown markers removed). */
export function excerptOf(text: string, max = 300): string {
  const plain = text
    .split(/\r?\n/)
    .map((l) => stripInlineMarkdown(l.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[^\]]*\]\s*)?|\d+[.)]\s+|>\s*)/, ""), 400))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** A project slug from a name: "Đồ án NT219" → "do-an-nt219" (2–40 of a-z, 0-9 and dashes). */
export function projectSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug.length >= 2 ? slug : `project-${slug || "x"}`.slice(0, 40);
}

/** Lower-case extension for the documents table; extension-less build files get a short stand-in. */
export function extensionOf(path: string): string {
  const name = (path.split("/").at(-1) ?? path).toLowerCase();
  const ext = /\.([a-z0-9]{1,8})$/.exec(name)?.[1];
  if (ext) return ext;
  return ({ dockerfile: "docker", makefile: "make", gemfile: "rb", rakefile: "rb" } as Record<string, string>)[name] ?? "txt";
}

export interface DocumentDeadline {
  /** Stable identity within the document (file + section/title), independent of the date. */
  key: string;
  title: string;
  dueDate: string;
  startDate: string | null;
  hard: boolean;
  line: number;
  /** Checklist status when the deadline comes from a `- [ ] … 📅 date` item, else null. */
  status: ChecklistStatus | null;
  origin: "table" | "checklist";
}

// "📅 2026-10-05" (Obsidian Tasks), "(hạn 05/10)", "— deadline: 5/10/2026", "@due(2026-10-05)".
const INLINE_DUE = [
  /📅\s*(\d{4}-\d{2}-\d{2})/u,
  /@due\((\d{4}-\d{2}-\d{2})\)/u,
  /(?:^|\s)[([]?(?:[—–-]\s*)?(?:hạn chót|hạn nộp|hạn|deadline|due)\s*[:：]?\s*(\d{1,2}\/\d{1,2}(?:\/\d{4})?|\d{4}-\d{2}-\d{2})[)\]]?/iu,
];

/** Finds an inline due date in a checklist item and returns the title without it. */
export function inlineDueDate(text: string, reference: string | null): { dueDate: string; title: string } | null {
  for (const pattern of INLINE_DUE) {
    const match = pattern.exec(text);
    if (!match) continue;
    const parsed = parseDateCell(match[1]!, reference);
    if (!parsed) continue;
    const title = text
      .replace(match[0], " ")
      .replace(/\(\s*\)/g, "")
      .replace(/\s+/g, " ")
      .replace(/[\s—–:-]+$/u, "")
      .trim();
    return { dueDate: parsed.end, title: title || text };
  }
  return null;
}

export interface DocumentAnalysis {
  title: string;
  checklist: ChecklistResult;
  deadlines: DocumentDeadline[];
  chunks: DocumentChunk[];
  excerpt: string;
  language: string | null;
  lineCount: number;
  /** Headings (notes) or declarations (code), for the outline panel and "go to symbol". */
  outline: OutlineSymbol[];
  /** TODO/FIXME comments (code only). */
  todos: CodeTodo[];
  referenceDate: string | null;
  /** Text after secret redaction (what gets stored). */
  text: string;
  redactions: number;
}

function fileTitle(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  return name.replace(/\.[^.]+$/, "").slice(0, 300) || name;
}

/**
 * Everything the hub derives from one document: checklist progress, dated milestones (tables and
 * checklist items with inline dates) and search chunks. Pure, so the web app and tests share it.
 */
export function analyzeDocument(input: { path: string; kind: DocumentKind; text: string; referenceDate?: string | null }): DocumentAnalysis {
  const { text, count } = redactSecrets(input.text.normalize("NFC").slice(0, MAX_DOCUMENT_CHARS));
  const language = documentLanguageOf(input.path, input.kind);
  const lineCount = text ? text.split(/\r?\n/).length : 0;
  if (input.kind === "code") {
    const outline = outlineOf(text, language);
    return {
      title: input.path.split("/").at(-1)!.slice(0, 300),
      checklist: parseChecklist(""),
      deadlines: [],
      chunks: describeChunks(splitText(text), outline, "code"),
      excerpt: excerptOf(text),
      language,
      lineCount,
      outline,
      todos: extractTodos(text),
      referenceDate: null,
      text,
      redactions: count,
    };
  }
  // Notes and extracted PDF/slide text ("## Page 3") get a heading outline; chunks break at those headings.
  const headed = input.kind === "markdown" || input.kind === "pdf" || input.kind === "pptx";
  const outline = headed ? outlineOf(text, "markdown") : [];
  const chunks = describeChunks(splitText(text, { headings: headed }), outline, input.kind);
  const base = { chunks, excerpt: excerptOf(text), language, lineCount, outline, todos: [] as CodeTodo[] };
  if (input.kind !== "markdown" && input.kind !== "text") {
    return { title: fileTitle(input.path), checklist: parseChecklist(""), deadlines: [], ...base, referenceDate: null, text, redactions: count };
  }

  const reference = input.referenceDate ?? findReferenceDate(text);
  const checklist = parseChecklist(text, input.path);
  const deadlines: DocumentDeadline[] = parseDeadlineTables(text, { sourcePath: input.path, referenceDate: reference ?? undefined }).map((row) => ({
    key: row.key,
    title: row.title,
    dueDate: row.dueDate,
    startDate: row.startDate,
    hard: row.hard,
    line: row.line,
    status: null,
    origin: "table",
  }));
  const seen = new Set(deadlines.map((d) => d.key));
  for (const item of checklist.items) {
    const due = inlineDueDate(item.text, reference);
    if (!due) continue;
    // Keyed by file + section + title without the date, so moving the date keeps the identity.
    const key = stableHash(`${input.path}\n${item.sectionPath.map(normalizeForKey).join(" > ")}\n${normalizeForKey(due.title)}\ndue`);
    if (seen.has(key)) continue;
    seen.add(key);
    deadlines.push({ key, title: due.title.slice(0, 300), dueDate: due.dueDate, startDate: null, hard: false, line: item.line, status: item.status, origin: "checklist" });
  }

  const heading = text.split(/\r?\n/).map(parseHeading).find((h) => h && h.level <= 2);
  const title = heading?.text || fileTitle(input.path);
  return { title: title.slice(0, 300), checklist, deadlines, ...base, referenceDate: reference, text, redactions: count };
}

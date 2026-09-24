import { parseChecklist, type ChecklistResult, type ChecklistStatus } from "./checklist";
import { chunkCode, codeLanguageOf, extractTodos, outlineOf, type CodeTodo, type OutlineSymbol } from "./code";
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
  /** "Section › Subsection" of the chunk's nearest headings, or null before the first heading. */
  heading: string | null;
  content: string;
  /** 1-based line where the chunk starts. */
  line: number;
}

/**
 * Splits text into search chunks at headings, then at blank lines so no chunk exceeds `maxChars`.
 * Inline Markdown is flattened so snippets read as plain text.
 */
export function chunkDocument(text: string, maxChars = 1500): DocumentChunk[] {
  const lines = text.normalize("NFC").split(/\r?\n/);
  const headings: string[] = [];
  const chunks: DocumentChunk[] = [];
  let buffer: string[] = [];
  let bufferLine = 1;
  let size = 0;
  let inFence = false;

  const headingLabel = () => {
    const path = headings.filter(Boolean);
    return path.length ? path.slice(-2).join(" › ").slice(0, 300) : null;
  };
  let currentHeading: string | null = null;

  const flush = () => {
    const content = buffer.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (content && chunks.length < MAX_CHUNKS_PER_DOCUMENT) {
      chunks.push({ ord: chunks.length, heading: currentHeading, content, line: bufferLine });
    }
    buffer = [];
    size = 0;
  };

  lines.forEach((raw, index) => {
    if (isFenceLine(raw)) {
      inFence = !inFence;
      return;
    }
    const heading = inFence ? null : parseHeading(raw);
    if (heading) {
      flush();
      headings.length = heading.level - 1;
      headings[heading.level - 1] = heading.text;
      currentHeading = headingLabel();
      bufferLine = index + 2;
      return;
    }
    if (isTableSeparator(raw)) return;
    // List bullets are noise in snippets; checkbox markers ("[x]") stay because they carry status.
    const line = inFence ? raw.trimEnd() : stripInlineMarkdown(raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""), 4000);
    if (!line) {
      // Paragraph boundary: a good place to split an oversized chunk.
      if (size >= maxChars * 0.6) flush();
      else if (buffer.length) buffer.push("");
      if (!buffer.length) bufferLine = index + 2;
      return;
    }
    if (!buffer.length) bufferLine = index + 1;
    // Hard split for very long paragraphs (or text without blank lines, e.g. PDF output).
    let rest = line;
    while (size + rest.length > maxChars) {
      const room = Math.max(maxChars - size, 200);
      const cut = rest.lastIndexOf(" ", room);
      const at = cut > room / 2 ? cut : room;
      buffer.push(rest.slice(0, at));
      flush();
      bufferLine = index + 1;
      rest = rest.slice(at).trimStart();
    }
    if (rest) {
      buffer.push(rest);
      size += rest.length + 1;
    }
  });
  flush();
  return chunks;
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
  chunks: (DocumentChunk & { terms?: string })[];
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
      chunks: chunkCode(text, outline),
      language,
      lineCount,
      outline,
      todos: extractTodos(text),
      referenceDate: null,
      text,
      redactions: count,
    };
  }
  const chunks = chunkDocument(text);
  const outline = input.kind === "markdown" ? outlineOf(text, "markdown") : [];
  const base = { chunks, language, lineCount, outline, todos: [] as CodeTodo[] };
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

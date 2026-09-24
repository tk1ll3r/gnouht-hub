import { normalizeForKey, stableHash } from "./hash";
import { isFenceLine, parseHeading, stripInlineMarkdown } from "./markdown";

export type ChecklistStatus = "todo" | "doing" | "attention" | "done" | "cut";

/** Markers used in the user's progress files: `[x]` done, `[~]` partial, `[!]` attention, `[CẮT]` cut. */
const MARKER_STATUS: Record<string, ChecklistStatus> = {
  " ": "todo",
  x: "done",
  "~": "doing",
  "!": "attention",
  "-": "cut",
  cắt: "cut",
  cat: "cut",
};

const ITEM_PATTERN = /^(\s*)(?:[-*+]|\d+[.)])?\s*\[( |x|X|~|!|-|CẮT|Cắt|cắt|CAT|Cat|cat)\]\s+(.+?)\s*$/u;

export interface ChecklistItem {
  /** Stable identity: source path + section + text (+ occurrence for exact duplicates). */
  key: string;
  text: string;
  status: ChecklistStatus;
  /** Nearest heading, e.g. "3.1. Chuyển trọng tâm…". */
  section: string | null;
  sectionPath: string[];
  /** 1-based line number in the source file. */
  line: number;
  indent: number;
}

export interface ChecklistStats {
  total: number;
  todo: number;
  doing: number;
  attention: number;
  done: number;
  cut: number;
}

export interface ChecklistResult {
  items: ChecklistItem[];
  stats: ChecklistStats;
  /** done ÷ (total − cut); 0 when nothing countable. */
  progress: number;
}

export function emptyStats(): ChecklistStats {
  return { total: 0, todo: 0, doing: 0, attention: 0, done: 0, cut: 0 };
}

export function progressOf(stats: ChecklistStats): number {
  const countable = stats.total - stats.cut;
  return countable > 0 ? stats.done / countable : 0;
}

export function parseChecklist(markdown: string, sourcePath = ""): ChecklistResult {
  const lines = markdown.normalize("NFC").split(/\r?\n/);
  const headings: string[] = [];
  const seen = new Map<string, number>();
  const items: ChecklistItem[] = [];
  const stats = emptyStats();
  let inFence = false;

  lines.forEach((line, index) => {
    if (isFenceLine(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const heading = parseHeading(line);
    if (heading) {
      headings.length = heading.level - 1;
      headings[heading.level - 1] = heading.text;
      return;
    }

    const match = ITEM_PATTERN.exec(line);
    if (!match) return;
    const status = MARKER_STATUS[match[2]!.toLowerCase()] ?? MARKER_STATUS[match[2]!];
    const text = stripInlineMarkdown(match[3]!);
    if (!status || !text) return;

    const sectionPath = headings.filter((h): h is string => Boolean(h));
    const identity = `${sourcePath}\n${sectionPath.map(normalizeForKey).join(" > ")}\n${normalizeForKey(text)}`;
    const occurrence = (seen.get(identity) ?? 0) + 1;
    seen.set(identity, occurrence);

    items.push({
      key: stableHash(occurrence === 1 ? identity : `${identity}\n#${occurrence}`),
      text,
      status,
      section: sectionPath.at(-1) ?? null,
      sectionPath,
      line: index + 1,
      indent: match[1]!.replace(/\t/g, "  ").length,
    });
    stats.total++;
    stats[status]++;
  });

  return { items, stats, progress: progressOf(stats) };
}

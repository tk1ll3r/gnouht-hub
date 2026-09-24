import { normalizeForKey, stableHash } from "./hash";
import { isFenceLine, isTableSeparator, splitTableRow, stripInlineMarkdown } from "./markdown";

export interface MilestoneRow {
  key: string;
  title: string;
  /** Due date "YYYY-MM-DD" (end of a range). */
  dueDate: string;
  /** Start of a range such as "09–12/09", otherwise null. */
  startDate: string | null;
  /** Bold rows (`**Hạn nộp abstract**`) are hard deadlines. */
  hard: boolean;
  line: number;
}

export interface DeadlineTableOptions {
  sourcePath?: string;
  /**
   * "YYYY-MM-DD" used to infer the year of "dd/mm" dates. Defaults to a date found in the text
   * ("Ngày cập nhật: 26/08/2026", "**Ngày:** 30/08/2026"); without either, rows need an explicit year.
   */
  referenceDate?: string;
}

const DATE_HEADER = /^(hạn|thời hạn|deadline|due|due date|ngày|date|hạn chót)$/u;
const TITLE_HEADER = /^(mốc|milestone|việc|công việc|task|nội dung|hạng mục|item|giai đoạn)/u;
const REFERENCE_PATTERN = /(?:ngày cập nhật|cập nhật|ngày|updated|date)[^\d\n]{0,12}(\d{1,2})\/(\d{1,2})\/(\d{4})/iu;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Finds the document's own date, e.g. "**Ngày cập nhật:** 26/08/2026" → "2026-08-26". */
export function findReferenceDate(markdown: string): string | null {
  const match = REFERENCE_PATTERN.exec(stripInlineMarkdown(markdown.normalize("NFC").slice(0, 5000), 5000));
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return validDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/** Year for a "dd/mm" date: the reference year, shifted when the month is more than 6 months away. */
function inferYear(month: number, reference: string | null): number | null {
  if (!reference) return null;
  const refYear = Number(reference.slice(0, 4));
  const refMonth = Number(reference.slice(5, 7));
  if (month < refMonth - 6) return refYear + 1;
  if (month > refMonth + 6) return refYear - 1;
  return refYear;
}

function toKey(day: number, month: number, year: number | null): string | null {
  if (year === null || !validDate(year, month, day)) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Parses "05/09", "5/9/2026", "2026-09-05", "09–12/09" and "30/08–02/09". */
export function parseDateCell(cell: string, reference: string | null): { start: string | null; end: string } | null {
  const text = stripInlineMarkdown(cell).replace(/\s+/g, "");
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) {
    const key = toKey(Number(m[3]), Number(m[2]), Number(m[1]));
    return key ? { start: null, end: key } : null;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?$/.exec(text);
  if (m) {
    const month = Number(m[2]);
    const key = toKey(Number(m[1]), month, m[3] ? Number(m[3]) : inferYear(month, reference));
    return key ? { start: null, end: key } : null;
  }
  m = /^(\d{1,2})(?:\/(\d{1,2}))?[–—-](\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/u.exec(text);
  if (m) {
    const endMonth = Number(m[4]);
    const startMonth = m[2] ? Number(m[2]) : endMonth;
    const explicitYear = m[5] ? Number(m[5]) : null;
    const endYear = explicitYear ?? inferYear(endMonth, reference);
    const startYear = explicitYear !== null && startMonth > endMonth ? explicitYear - 1 : explicitYear ?? inferYear(startMonth, reference);
    const end = toKey(Number(m[3]), endMonth, endYear);
    if (!end) return null;
    return { start: toKey(Number(m[1]), startMonth, startYear), end };
  }
  return null;
}

/** Extracts dated rows from every Markdown table whose header has a deadline column ("Hạn", "Deadline", …). */
export function parseDeadlineTables(markdown: string, options: DeadlineTableOptions = {}): MilestoneRow[] {
  const text = markdown.normalize("NFC");
  const reference = options.referenceDate ?? findReferenceDate(text);
  const lines = text.split(/\r?\n/);
  const rows: MilestoneRow[] = [];
  const seen = new Map<string, number>();
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isFenceLine(line)) inFence = !inFence;
    if (inFence || !line.trim().startsWith("|") || !isTableSeparator(lines[i + 1] ?? "")) continue;

    const headers = splitTableRow(line).map((h) => stripInlineMarkdown(h).toLowerCase());
    const dateCol = headers.findIndex((h) => DATE_HEADER.test(h));
    if (dateCol === -1) continue;
    let titleCol = headers.findIndex((h, idx) => idx !== dateCol && TITLE_HEADER.test(h));
    if (titleCol === -1) titleCol = dateCol === 0 ? 1 : 0;

    let r = i + 2;
    for (; r < lines.length && lines[r]!.trim().startsWith("|"); r++) {
      const cells = splitTableRow(lines[r]!);
      const rawTitle = cells[titleCol] ?? "";
      const rawDate = cells[dateCol] ?? "";
      const title = stripInlineMarkdown(rawTitle);
      const parsed = parseDateCell(rawDate, reference);
      if (!title || !parsed) continue;

      const identity = `${options.sourcePath ?? ""}\nmilestone\n${normalizeForKey(title)}`;
      const occurrence = (seen.get(identity) ?? 0) + 1;
      seen.set(identity, occurrence);
      rows.push({
        key: stableHash(occurrence === 1 ? identity : `${identity}\n#${occurrence}`),
        title,
        dueDate: parsed.end,
        startDate: parsed.start,
        hard: /\*\*|__/.test(rawTitle) || /\*\*|__/.test(rawDate),
        line: r + 1,
      });
    }
    i = r - 1;
  }
  return rows;
}

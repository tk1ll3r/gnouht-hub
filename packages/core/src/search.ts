// Accent-insensitive matching for document search. The database folds text the same way
// (`private.search_fold` = lower(unaccent(…))), so "tien do" finds "Tiến độ".

const EXTRA_FOLDS: Record<string, string> = { đ: "d", Đ: "d", ð: "d", ł: "l", ø: "o", æ: "ae", œ: "oe", ß: "ss" };

/** Folds one character: lower-case, diacritics removed, "đ" → "d". May return more than one char ("ß"). */
function foldChar(char: string): string {
  const extra = EXTRA_FOLDS[char];
  if (extra) return extra;
  return char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Lower-case, accent-free text for comparisons ("Tiến Độ" → "tien do"). */
export function foldText(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) out += foldChar(char);
  return out;
}

/** Folded text plus, for every folded UTF-16 index, the index of the source character it came from. */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let index = 0;
  for (const char of text) {
    const f = foldChar(char);
    for (let i = 0; i < f.length; i++) map.push(index);
    folded += f;
    index += char.length;
  }
  map.push(index);
  return { folded, map };
}

/** Search words the same way the database builds its tsquery: folded, alphanumeric runs, at most 12. */
export function searchTerms(query: string): string[] {
  const terms = foldText(query.slice(0, 200))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return [...new Set(terms)].slice(0, 12);
}

export interface SnippetPart {
  text: string;
  hit: boolean;
}

/**
 * A window of `content` around the first matching term, split into plain and highlighted parts.
 * Terms match at word starts (prefix match, like the database's `term:*`). Returns plain text parts
 * only — the caller renders them as text, so no HTML is ever produced from document content.
 */
export function highlightSnippet(content: string, query: string, maxLength = 240): SnippetPart[] {
  const source = content.normalize("NFC");
  const terms = searchTerms(query);
  const { folded, map } = foldWithMap(source);

  const hits: [number, number][] = [];
  if (terms.length) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escapeRegExp).join("|")})`, "gu");
    for (const match of folded.matchAll(pattern)) {
      hits.push([map[match.index]!, map[match.index + match[0].length]!]);
    }
  }

  // Centre the window on the first hit; otherwise show the start of the content.
  const first = hits[0]?.[0] ?? 0;
  let start = Math.max(0, first - Math.floor(maxLength / 3));
  if (start > 0) {
    const space = source.lastIndexOf(" ", start);
    start = space > start - 20 && space >= 0 ? space + 1 : start;
  }
  let end = Math.min(source.length, start + maxLength);
  if (end < source.length) {
    const space = source.indexOf(" ", end - 20);
    end = space >= 0 && space < end + 20 ? space : end;
  }

  const parts: SnippetPart[] = [];
  const push = (text: string, hit: boolean) => {
    if (!text) return;
    const last = parts.at(-1);
    if (last && last.hit === hit) last.text += text;
    else parts.push({ text, hit });
  };
  if (start > 0) push("…", false);
  let cursor = start;
  for (const [from, to] of hits) {
    if (to <= cursor || from >= end) continue;
    push(source.slice(cursor, Math.max(from, cursor)), false);
    push(source.slice(Math.max(from, cursor), Math.min(to, end)), true);
    cursor = Math.min(to, end);
  }
  push(source.slice(cursor, end), false);
  if (end < source.length) push("…", false);
  return parts;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

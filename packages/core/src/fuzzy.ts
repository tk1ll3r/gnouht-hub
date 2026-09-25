/**
 * Fuzzy matching for quick open and the command palette, in the spirit of VS Code's: every query
 * character must appear in order; consecutive runs, word starts (after / _ - . space, or a camelCase
 * hump) and the file name part score higher. Space-separated terms must each match.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices into the target string that matched, ascending (for highlighting). */
  positions: number[];
}

function isSeparator(ch: string | undefined): boolean {
  return ch === undefined || ch === "/" || ch === "\\" || ch === "_" || ch === "-" || ch === "." || ch === " " || ch === ":";
}

function isWordStart(target: string, index: number): boolean {
  const prev = target[index - 1];
  const ch = target[index]!;
  if (isSeparator(prev)) return true;
  return prev !== undefined && /[a-z0-9]/.test(prev) && /[A-Z]/.test(ch);
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/** Best alignment of one term (no spaces) inside `target`, starting the search at `from`. */
function matchTerm(term: string, target: string, folded: string, nameStart: number): FuzzyMatch | null {
  const n = term.length;
  const m = folded.length;
  if (!n) return { score: 0, positions: [] };
  if (n > m) return null;
  // Quick reject: characters must appear in order.
  for (let i = 0, j = 0; i < n; i++, j++) {
    j = folded.indexOf(term[i]!, j);
    if (j < 0) return null;
  }

  // Dynamic programming over (query index, target index): best score ending with query[i] at target[j].
  // A gap of g skipped characters costs min(0.3·g, 3), so the best predecessor is tracked with two
  // running maxima instead of a scan (O(n·m) per target).
  const NEG = -1e9;
  const score: Float64Array[] = Array.from({ length: n }, () => new Float64Array(m).fill(NEG));
  const from: Int32Array[] = Array.from({ length: n }, () => new Int32Array(m).fill(-1));
  const bonusAt = (j: number) => 1 + (isWordStart(target, j) ? 6 : 0) + (j >= nameStart ? 2 : 0) + (j === nameStart ? 4 : 0);
  for (let j = 0; j < m; j++) if (folded[j] === term[0]) score[0]![j] = bonusAt(j) - Math.min(j, 12) * 0.2;
  for (let i = 1; i < n; i++) {
    const prev = score[i - 1]!;
    let linear = NEG; // max over k ≤ j-2 of prev[k] + 0.3·k
    let linearK = -1;
    let flat = NEG; // max over k ≤ j-2 of prev[k]
    let flatK = -1;
    for (let j = i; j < m; j++) {
      const k = j - 2;
      if (k >= 0 && prev[k]! > NEG) {
        if (prev[k]! + 0.3 * k > linear) {
          linear = prev[k]! + 0.3 * k;
          linearK = k;
        }
        if (prev[k]! > flat) {
          flat = prev[k]!;
          flatK = k;
        }
      }
      if (folded[j] !== term[i]) continue;
      let best = NEG;
      let bestK = -1;
      if (prev[j - 1]! > NEG) {
        best = prev[j - 1]! + 5;
        bestK = j - 1;
      }
      if (linearK >= 0 && linear - 0.3 * (j - 1) > best) {
        best = linear - 0.3 * (j - 1);
        bestK = linearK;
      }
      if (flatK >= 0 && flat - 3 > best) {
        best = flat - 3;
        bestK = flatK;
      }
      if (bestK >= 0) {
        score[i]![j] = best + bonusAt(j);
        from[i]![j] = bestK;
      }
    }
  }
  let end = -1;
  let best = NEG;
  for (let j = 0; j < m; j++) {
    if (score[n - 1]![j]! > best) {
      best = score[n - 1]![j]!;
      end = j;
    }
  }
  if (end < 0) return null;
  const positions: number[] = [];
  for (let i = n - 1, j = end; i >= 0; j = from[i]![j]!, i--) positions.unshift(j);
  return { score: best, positions };
}

/**
 * Scores `target` against `query` (case and accent insensitive). Returns null when it does not match.
 * For paths, matches in the file name (after the last "/") count more.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return { score: 0, positions: [] };
  const folded = fold(target);
  // Folding may change length for unusual characters; fall back to a plain lower-case copy then.
  const haystack = folded.length === target.length ? folded : target.toLowerCase();
  const nameStart = target.lastIndexOf("/") + 1;
  let total = 0;
  const positions = new Set<number>();
  for (const term of terms) {
    const match = matchTerm(term.slice(0, 64), target, haystack, nameStart);
    if (!match) return null;
    total += match.score;
    for (const p of match.positions) positions.add(p);
  }
  // Shorter targets win ties ("app.ts" over "apps/web/app/layout.tsx" for "app").
  return { score: total - target.length * 0.01, positions: [...positions].sort((a, b) => a - b) };
}

/** Splits `text` into highlighted and plain runs for the given match positions. */
export function highlightPositions(text: string, positions: number[]): { text: string; hit: boolean }[] {
  const set = new Set(positions);
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = parts.at(-1);
    if (last && last.hit === hit) last.text += text[i];
    else parts.push({ text: text[i]!, hit });
  }
  return parts;
}

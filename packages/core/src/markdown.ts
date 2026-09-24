/** Strips inline Markdown (emphasis, code, links, images, HTML) down to readable plain text. */
export function stripInlineMarkdown(text: string, maxLength = 300): string {
  const plain = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → label
    .replace(/<[^>]+>/g, "") // inline HTML
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // bold
    .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1$2") // *italic*
    .replace(/(^|[^\w_])_(?!\s)([^_]+?)_(?!\w)/g, "$1$2") // _italic_
    .replace(/~~(.+?)~~/g, "$1") // strikethrough
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain;
}

export function isFenceLine(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

export interface Heading {
  level: number;
  text: string;
}

export function parseHeading(line: string): Heading | null {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (!match) return null;
  return { level: match[1]!.length, text: stripInlineMarkdown(match[2]!) };
}

/** Splits a Markdown table row into trimmed cells, honouring escaped pipes. */
export function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

export function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
}

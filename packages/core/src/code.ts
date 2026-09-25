import { parseHeading, isFenceLine } from "./markdown";

/**
 * Source files: extension (or file name) → highlight.js language id. Everything here is indexed as the
 * `code` document kind; `CODE_INCLUDE` below is the narrower default set `project add --code` watches.
 */
const CODE_EXTENSIONS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyw: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  swift: "swift",
  dart: "dart",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  fs: "fsharp",
  php: "php",
  rb: "ruby",
  lua: "lua",
  r: "r",
  jl: "julia",
  m: "matlab",
  hs: "haskell",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  ml: "ocaml",
  pl: "perl",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  bat: "dos",
  asm: "x86asm",
  s: "x86asm",
  v: "verilog",
  sv: "verilog",
  vhd: "vhdl",
  vhdl: "vhdl",
  ino: "arduino",
  proto: "protobuf",
  graphql: "graphql",
  gql: "graphql",
  css: "css",
  scss: "scss",
  less: "less",
  html: "xml",
  htm: "xml",
  vue: "xml",
  svelte: "xml",
  xml: "xml",
  tex: "latex",
  nix: "nix",
  gradle: "groovy",
  groovy: "groovy",
  cmake: "cmake",
  // Configuration and data: indexable, but only when a folder's globs ask for them (they are more
  // likely to hold credentials than source files are).
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
};

const CODE_FILENAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  "cmakelists.txt": "cmake",
  gemfile: "ruby",
  rakefile: "ruby",
};

const CONFIG_EXTENSIONS = new Set(["json", "yaml", "yml", "toml", "ini", "cfg", "conf"]);

/** Globs `hub-agent project add --code` watches: source files plus the Markdown notes next to them. */
export const CODE_INCLUDE: readonly string[] = [
  `**/*.{${Object.keys(CODE_EXTENSIONS)
    .filter((ext) => !CONFIG_EXTENSIONS.has(ext))
    .join(",")}}`,
  "**/{Dockerfile,Makefile,CMakeLists.txt,Gemfile,Rakefile}",
];

/** Build output, dependencies, generated and lock files: never worth indexing, often huge. */
export const CODE_EXCLUDE: readonly string[] = [
  "**/vendor/**",
  "**/target/**",
  "**/coverage/**",
  "**/bin/**",
  "**/obj/**",
  "**/out/**",
  "**/*.min.*",
  "**/*.map",
  "**/*.lock",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/go.sum",
  "**/*.generated.*",
  "**/*.pb.go",
  "**/*_pb2.py",
];

/** Source files larger than this are almost always generated or bundled. */
export const MAX_CODE_BYTES = 1024 * 1024;

function baseName(path: string): string {
  return (path.split("/").at(-1) ?? path).toLowerCase();
}

/** highlight.js language id for a source file, or null when the file is not code. */
export function codeLanguageOf(path: string): string | null {
  const name = baseName(path);
  if (CODE_FILENAMES[name]) return CODE_FILENAMES[name];
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1];
  return ext ? (CODE_EXTENSIONS[ext] ?? null) : null;
}

/** Display name of a highlight.js language id. */
export function languageLabel(language: string | null | undefined): string {
  const labels: Record<string, string> = {
    typescript: "TypeScript",
    javascript: "JavaScript",
    python: "Python",
    csharp: "C#",
    cpp: "C++",
    c: "C",
    go: "Go",
    rust: "Rust",
    java: "Java",
    kotlin: "Kotlin",
    php: "PHP",
    ruby: "Ruby",
    sql: "SQL",
    bash: "Shell",
    powershell: "PowerShell",
    dos: "Batch",
    xml: "HTML/XML",
    css: "CSS",
    scss: "SCSS",
    json: "JSON",
    yaml: "YAML",
    ini: "Config",
    x86asm: "Assembly",
    latex: "LaTeX",
    markdown: "Markdown",
    matlab: "MATLAB",
    graphql: "GraphQL",
    protobuf: "Protobuf",
    vhdl: "VHDL",
    ocaml: "OCaml",
    fsharp: "F#",
  };
  if (!language) return "Plain text";
  return labels[language] ?? language.charAt(0).toUpperCase() + language.slice(1);
}

// ── outline ───────────────────────────────────────────────────────────────────

export const SYMBOL_KINDS = ["heading", "module", "class", "interface", "type", "enum", "function", "method", "constant", "table"] as const;
export type SymbolKind = (typeof SYMBOL_KINDS)[number];

export interface OutlineSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based line of the declaration. */
  line: number;
  /** Nesting level (0 = top level), from indentation or heading level. */
  depth: number;
}

export const MAX_OUTLINE = 500;

interface SymbolRule {
  pattern: RegExp;
  kind: SymbolKind | ((match: RegExpExecArray, indent: number) => SymbolKind);
  /** Capture group holding the name. */
  name: number;
  /** Matched by shape rather than a declaration keyword, so control-flow words must be ruled out. */
  loose?: boolean;
}

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "else", "do", "try", "new", "await", "sizeof", "typeof", "with", "elif", "match", "case", "when", "until", "unless", "defer", "go", "select", "foreach", "using", "lock", "fixed"]);

const JS_RULES: SymbolRule[] = [
  { pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class", name: 1 },
  { pattern: /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface", name: 1 },
  { pattern: /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, kind: "type", name: 1 },
  { pattern: /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: "enum", name: 1 },
  { pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: "function", name: 1 },
  {
    pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:<[^>]*>\s*)?\([^)]*\)\s*(?::\s*[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
    kind: "function",
    name: 1,
  },
  { pattern: /^(?:export\s+)(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: "constant", name: 1 },
  {
    // Class members: `  async load(id: string): Promise<X> {`, `  get size() {`, `  private static helper<T>(…) {`
    pattern: /^\s+(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set)\s+)*\*?\s*([A-Za-z_$#][\w$]*)\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?::\s*[^={;]+)?\s*\{\s*$/,
    kind: "method",
    name: 1,
    loose: true,
  },
];

const PYTHON_RULES: SymbolRule[] = [
  { pattern: /^(\s*)class\s+([A-Za-z_]\w*)/, kind: "class", name: 2 },
  { pattern: /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: (m) => ((m[1] ?? "").length ? "method" : "function"), name: 2 },
  { pattern: /^([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=/, kind: "constant", name: 1 },
];

const GO_RULES: SymbolRule[] = [
  { pattern: /^func\s+\([^)]*\)\s*([A-Za-z_]\w*)/, kind: "method", name: 1 },
  { pattern: /^func\s+([A-Za-z_]\w*)/, kind: "function", name: 1 },
  { pattern: /^type\s+([A-Za-z_]\w*)\s+interface\b/, kind: "interface", name: 1 },
  { pattern: /^type\s+([A-Za-z_]\w*)\s+struct\b/, kind: "class", name: 1 },
  { pattern: /^type\s+([A-Za-z_]\w*)\s/, kind: "type", name: 1 },
];

const RUST_RULES: SymbolRule[] = [
  { pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/, kind: (_m, indent) => (indent ? "method" : "function"), name: 1 },
  { pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, kind: "class", name: 1 },
  { pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, kind: "enum", name: 1 },
  { pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/, kind: "interface", name: 1 },
  { pattern: /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>, ]+\s+for\s+)?([A-Za-z_][\w:]*)/, kind: "class", name: 1 },
  { pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/, kind: "module", name: 1 },
  { pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/, kind: "type", name: 1 },
];

// Java, C#, Kotlin, Scala, Swift, Dart, PHP: declarations share enough shape for one rule set.
const CURLY_RULES: SymbolRule[] = [
  {
    pattern: /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial|open|data|export|inline|value|case)\s+)*(class|interface|enum|record|struct|trait|object|protocol|extension|namespace)\s+([A-Za-z_]\w*)/,
    kind: (m) => {
      const word = m[1];
      if (word === "interface" || word === "protocol" || word === "trait") return "interface";
      if (word === "enum") return "enum";
      if (word === "namespace") return "module";
      return "class";
    },
    name: 2,
  },
  { pattern: /^\s*(?:(?:public|private|protected|internal|static|override|open|suspend|inline|abstract|final|async)\s+)*(?:fun|func|def)\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][\w.]*\.)?([A-Za-z_]\w*)/, kind: (_m, indent) => (indent ? "method" : "function"), name: 1 },
  { pattern: /^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?\s*([A-Za-z_]\w*)/, kind: (_m, indent) => (indent ? "method" : "function"), name: 1 },
  {
    // `public static int Add(int a, int b) {` / `private async Task<User> LoadAsync(Guid id)` (brace may follow)
    pattern: /^\s+(?:(?:public|private|protected|internal|static|final|override|virtual|abstract|async|synchronized|sealed|extern|unsafe|new)\s+)+[\w<>[\],.?\s]+?\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\([^;]*$/,
    kind: "method",
    name: 1,
    loose: true,
  },
];

const C_RULES: SymbolRule[] = [
  { pattern: /^\s*(?:typedef\s+)?(struct|union|enum|class)\s+([A-Za-z_]\w*)\s*(?:final\s*)?(?::[^{;]*)?\{?\s*$/, kind: (m) => (m[1] === "enum" ? "enum" : "class"), name: 2 },
  { pattern: /^\s*namespace\s+([A-Za-z_][\w:]*)/, kind: "module", name: 1 },
  { pattern: /^#define\s+([A-Za-z_]\w*)/, kind: "constant", name: 1 },
  {
    // Definitions start at column 0: `static int parse_line(char *s, size_t n) {`, `void Foo::bar() const`
    pattern: /^(?!\s)(?!return\b|else\b|if\b|for\b|while\b|switch\b|typedef\b)[A-Za-z_][\w\s*&:<>,]*?[\s*&]([A-Za-z_~][\w]*(?:::[A-Za-z_~][\w]*)*)\s*\([^;]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?\{?\s*$/,
    kind: "function",
    name: 1,
    loose: true,
  },
];

const RUBY_RULES: SymbolRule[] = [
  { pattern: /^\s*(class|module)\s+([A-Z][\w:]*)/, kind: (m) => (m[1] === "module" ? "module" : "class"), name: 2 },
  { pattern: /^\s*def\s+(?:self\.)?([\w?!=]+)/, kind: (_m, indent) => (indent ? "method" : "function"), name: 1 },
];

const SQL_RULES: SymbolRule[] = [
  {
    pattern: /^\s*create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?(?:unique\s+)?(function|procedure|table|view|materialized\s+view|index|trigger|type|policy|schema|extension|sequence)\s+(?:if\s+not\s+exists\s+)?("?[\w."]+"?(?:\s+on\s+[\w."]+)?)/i,
    kind: (m) => {
      const word = m[1]!.toLowerCase();
      if (word === "function" || word === "procedure" || word === "trigger") return "function";
      if (word === "type") return "type";
      if (word === "schema" || word === "extension") return "module";
      return "table";
    },
    name: 2,
  },
];

const SHELL_RULES: SymbolRule[] = [{ pattern: /^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/, kind: "function", name: 1 }];
const LUA_RULES: SymbolRule[] = [{ pattern: /^\s*(?:local\s+)?function\s+([\w.:]+)/, kind: "function", name: 1 }];
const R_RULES: SymbolRule[] = [{ pattern: /^\s*([A-Za-z_.][\w.]*)\s*(?:<-|=)\s*function\b/, kind: "function", name: 1 }];
const ELIXIR_RULES: SymbolRule[] = [
  { pattern: /^\s*defmodule\s+([\w.]+)/, kind: "module", name: 1 },
  { pattern: /^\s*defp?\s+([\w?!]+)/, kind: "function", name: 1 },
];

const RULES_BY_LANGUAGE: Record<string, SymbolRule[]> = {
  typescript: JS_RULES,
  javascript: JS_RULES,
  python: PYTHON_RULES,
  go: GO_RULES,
  rust: RUST_RULES,
  java: CURLY_RULES,
  kotlin: CURLY_RULES,
  scala: CURLY_RULES,
  swift: CURLY_RULES,
  dart: CURLY_RULES,
  csharp: CURLY_RULES,
  php: CURLY_RULES,
  c: C_RULES,
  cpp: [...C_RULES, ...CURLY_RULES.slice(0, 1)],
  arduino: C_RULES,
  objectivec: C_RULES,
  ruby: RUBY_RULES,
  sql: SQL_RULES,
  bash: SHELL_RULES,
  lua: LUA_RULES,
  r: R_RULES,
  elixir: ELIXIR_RULES,
};

function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width++;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

function markdownOutline(lines: string[]): OutlineSymbol[] {
  const out: OutlineSymbol[] = [];
  let inFence = false;
  lines.forEach((raw, index) => {
    if (isFenceLine(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const heading = parseHeading(raw);
    if (heading && out.length < MAX_OUTLINE) out.push({ name: heading.text.slice(0, 200), kind: "heading", line: index + 1, depth: heading.level - 1 });
  });
  return out;
}

/**
 * Symbols of a file for the outline panel and "go to symbol": declarations found with per-language
 * patterns (fast and dependency-free, so not a parser: good enough to navigate, not to refactor).
 * Markdown and plain text get their headings.
 */
export function outlineOf(text: string, language: string | null): OutlineSymbol[] {
  const lines = text.split(/\r?\n/);
  if (!language || language === "markdown") return markdownOutline(lines);
  const rules = RULES_BY_LANGUAGE[language];
  if (!rules) return [];

  const out: OutlineSymbol[] = [];
  // Open scopes by indentation: a symbol nests under the nearest shallower symbol above it.
  const scopes: { indent: number; depth: number }[] = [];
  let inBlockComment = false;
  for (let index = 0; index < lines.length && out.length < MAX_OUTLINE; index++) {
    const line = lines[index]!;
    if (line.length > 400) continue;
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
      continue;
    }
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || (trimmed.startsWith("#") && language !== "c" && language !== "cpp")) continue;
    const indent = indentWidth(line);
    for (const rule of rules) {
      const match = rule.pattern.exec(line);
      if (!match) continue;
      const name = match[rule.name]?.replace(/"/g, "").trim();
      if (!name || (rule.loose && KEYWORDS.has(name))) break;
      while (scopes.length && scopes.at(-1)!.indent >= indent) scopes.pop();
      const depth = scopes.length ? scopes.at(-1)!.depth + 1 : 0;
      const kind = typeof rule.kind === "function" ? rule.kind(match, indent) : rule.kind;
      out.push({ name: name.slice(0, 200), kind, line: index + 1, depth: Math.min(depth, 8) });
      scopes.push({ indent, depth });
      break;
    }
  }
  return out;
}

// ── TODO / FIXME ──────────────────────────────────────────────────────────────

export const TODO_TAGS = ["TODO", "FIXME", "BUG", "HACK", "XXX"] as const;
export type TodoTag = (typeof TODO_TAGS)[number];

export interface CodeTodo {
  tag: TodoTag;
  text: string;
  line: number;
}

export const MAX_TODOS = 200;

// A tag inside a comment: `// TODO: x`, `# FIXME(nam) x`, `/* HACK x */`, `-- TODO x`, `<!-- TODO x -->`, `; XXX x`
// Markers quoted in backticks or quotes are examples, not comments; "TODO/FIXME" is prose about the tags.
const TODO_PATTERN = /(?<![`'"\w])(?:\/\/+|#+|\/\*+|^\s*\*+|--|<!--|;+|%+|\bREM\b)\s*(TODO|FIXME|BUG|HACK|XXX)\b(?![/\-]\w)(?:\([^)]{0,40}\))?\s*[:\-–]?\s*(.*)$/;

/** Work notes left in comments, for the project's "Problems" list. */
export function extractTodos(text: string): CodeTodo[] {
  const out: CodeTodo[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length && out.length < MAX_TODOS; index++) {
    const line = lines[index]!;
    if (line.length > 1000 || !/TODO|FIXME|BUG|HACK|XXX/.test(line)) continue;
    const match = TODO_PATTERN.exec(line);
    if (!match) continue;
    const body = match[2]!.replace(/\s*(?:\*\/|-->)\s*$/, "").trim();
    out.push({ tag: match[1] as TodoTag, text: body.slice(0, 200) || match[1]!, line: index + 1 });
  }
  return out;
}

// ── search chunks ─────────────────────────────────────────────────────────────

/** "parseChecklistItems", "MAX_TODO_TAGS" → "parse checklist items", "max todo tags" (for full-text search). */
export function identifierWords(text: string, limit = 4000): string {
  const words = new Set<string>();
  for (const token of text.match(/[A-Za-z][A-Za-z0-9]*(?:_+[A-Za-z0-9]+)+|[A-Za-z]*[a-z0-9][A-Z][A-Za-z0-9]*|[A-Z]{2,}[a-z][A-Za-z0-9]*/g) ?? []) {
    for (const part of token
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[\s_]+/)) {
      if (part.length >= 2) words.add(part.toLowerCase());
    }
  }
  return [...words].join(" ").slice(0, limit);
}

/** "Parser › parseLine": the innermost symbols (at most two levels) a line sits in, from the outline. */
export function symbolPathAt(outline: OutlineSymbol[], line: number): string | null {
  const path: OutlineSymbol[] = [];
  for (const symbol of outline) {
    if (symbol.line > line) break;
    path.length = symbol.depth;
    path[symbol.depth] = symbol;
  }
  const names = path.filter(Boolean).map((s) => s.name);
  return names.length ? names.slice(-2).join(" › ").slice(0, 300) : null;
}

// ── explorer tree ─────────────────────────────────────────────────────────────

export interface TreeFile<T> {
  type: "file";
  name: string;
  path: string;
  item: T;
}

export interface TreeFolder<T> {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode<T>[];
}

export type TreeNode<T> = TreeFile<T> | TreeFolder<T>;

/** Folder tree from relative paths: folders first, then files, each sorted by name (case-insensitive). */
export function buildFileTree<T extends { path: string }>(items: T[]): TreeFolder<T> {
  const root: TreeFolder<T> = { type: "folder", name: "", path: "", children: [] };
  for (const item of items) {
    const parts = item.path.split("/");
    let folder = root;
    parts.slice(0, -1).forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let next = folder.children.find((c): c is TreeFolder<T> => c.type === "folder" && c.name === part);
      if (!next) {
        next = { type: "folder", name: part, path, children: [] };
        folder.children.push(next);
      }
      folder = next;
    });
    folder.children.push({ type: "file", name: parts.at(-1)!, path: item.path, item });
  }
  const sort = (folder: TreeFolder<T>) => {
    folder.children.sort((a, b) => (a.type !== b.type ? (a.type === "folder" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })));
    for (const child of folder.children) if (child.type === "folder") sort(child);
  };
  sort(root);
  return root;
}

/** Heading anchor ids, shared by the Markdown renderer and the outline ("h-" keeps them off app ids). */
export function headingSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base =
      text
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/đ/gi, "d")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "section";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return `h-${base}${count ? `-${count}` : ""}`;
  };
}

import { describe, expect, it } from "vitest";
import { buildFileTree, chunkCode, codeLanguageOf, extractTodos, headingSlugger, identifierWords, languageLabel, outlineOf } from "./code";
import { analyzeDocument, documentKindOf } from "./documents";

describe("codeLanguageOf / documentKindOf", () => {
  it("maps extensions and well-known file names", () => {
    expect(codeLanguageOf("src/app/page.tsx")).toBe("typescript");
    expect(codeLanguageOf("lab3/aes.py")).toBe("python");
    expect(codeLanguageOf("Dockerfile")).toBe("dockerfile");
    expect(codeLanguageOf("build/CMakeLists.txt")).toBe("cmake");
    expect(codeLanguageOf("notes.txt")).toBeNull();
    expect(codeLanguageOf("report.docx")).toBeNull();
    expect(languageLabel("csharp")).toBe("C#");
    expect(languageLabel(null)).toBe("Plain text");
  });

  it("keeps notes as notes and marks sources as code", () => {
    expect(documentKindOf("README.md")).toBe("markdown");
    expect(documentKindOf("todo.txt")).toBe("text");
    expect(documentKindOf("CMakeLists.txt")).toBe("code");
    expect(documentKindOf("main.go")).toBe("code");
    expect(documentKindOf("config.yaml")).toBe("code");
    expect(documentKindOf("photo.png")).toBeNull();
  });
});

describe("outlineOf", () => {
  it("finds TypeScript declarations and nests methods under their class", () => {
    const ts = [
      "import { x } from './x';",
      "export interface User { id: string }",
      "export type Id = string;",
      "export enum Role { Owner, Member }",
      "export const MAX_USERS = 30;",
      "export async function loadUser(id: Id): Promise<User> {",
      "  if (id) {",
      "    return x(id);",
      "  }",
      "}",
      "const toKey = (u: User) => u.id;",
      "export class UserStore {",
      "  private cache = new Map();",
      "  async get(id: string): Promise<User> {",
      "    return this.cache.get(id);",
      "  }",
      "  static create() {",
      "    return new UserStore();",
      "  }",
      "}",
    ].join("\n");
    expect(outlineOf(ts, "typescript")).toEqual([
      { name: "User", kind: "interface", line: 2, depth: 0 },
      { name: "Id", kind: "type", line: 3, depth: 0 },
      { name: "Role", kind: "enum", line: 4, depth: 0 },
      { name: "MAX_USERS", kind: "constant", line: 5, depth: 0 },
      { name: "loadUser", kind: "function", line: 6, depth: 0 },
      { name: "toKey", kind: "function", line: 11, depth: 0 },
      { name: "UserStore", kind: "class", line: 12, depth: 0 },
      { name: "get", kind: "method", line: 14, depth: 1 },
      { name: "create", kind: "method", line: 17, depth: 1 },
    ]);
  });

  it("does not mistake control flow for methods", () => {
    const js = ["function a() {", "  if (x) {", "  }", "  for (const y of z) {", "  }", "  while (true) {", "  }", "}"].join("\n");
    expect(outlineOf(js, "javascript").map((s) => s.name)).toEqual(["a"]);
  });

  it("reads Python classes, methods and functions by indentation", () => {
    const py = ["MAX_ROUNDS = 10", "", "class Cipher:", "    def __init__(self, key):", "        pass", "", "    async def encrypt(self, data):", "        pass", "", "def main():", "    pass"].join("\n");
    expect(outlineOf(py, "python")).toEqual([
      { name: "MAX_ROUNDS", kind: "constant", line: 1, depth: 0 },
      { name: "Cipher", kind: "class", line: 3, depth: 0 },
      { name: "__init__", kind: "method", line: 4, depth: 1 },
      { name: "encrypt", kind: "method", line: 7, depth: 1 },
      { name: "main", kind: "function", line: 10, depth: 0 },
    ]);
  });

  it("covers Go, Rust, C, Java and SQL", () => {
    expect(outlineOf("type Server struct {\n}\nfunc (s *Server) Start() error {\n}\nfunc main() {\n}", "go").map((s) => `${s.kind}:${s.name}`)).toEqual([
      "class:Server",
      "method:Start",
      "function:main",
    ]);
    expect(outlineOf("pub struct Key;\nimpl Key {\n    pub fn new() -> Self {\n    }\n}\nfn main() {}", "rust").map((s) => `${s.kind}:${s.name}:${s.depth}`)).toEqual([
      "class:Key:0",
      "class:Key:0",
      "method:new:1",
      "function:main:0",
    ]);
    expect(outlineOf("#define BLOCK 16\nstruct state {\n};\nstatic int expand_key(const uint8_t *key, size_t n)\n{\n  return 0;\n}", "c").map((s) => s.name)).toEqual([
      "BLOCK",
      "state",
      "expand_key",
    ]);
    expect(
      outlineOf("public class Bank {\n    public static int add(int a, int b) {\n        return a + b;\n    }\n}", "java").map((s) => `${s.kind}:${s.name}:${s.depth}`),
    ).toEqual(["class:Bank:0", "method:add:1"]);
    expect(outlineOf("create table public.tasks (\n);\ncreate or replace function public.search(q text)", "sql").map((s) => `${s.kind}:${s.name}`)).toEqual([
      "table:public.tasks",
      "function:public.search",
    ]);
  });

  it("uses headings for Markdown and skips fenced code", () => {
    expect(outlineOf("# Báo cáo\n## Tiến độ\n```\n# not a heading\n```\n### Rủi ro", "markdown")).toEqual([
      { name: "Báo cáo", kind: "heading", line: 1, depth: 0 },
      { name: "Tiến độ", kind: "heading", line: 2, depth: 1 },
      { name: "Rủi ro", kind: "heading", line: 6, depth: 2 },
    ]);
  });

  it("returns nothing for languages it has no patterns for", () => {
    expect(outlineOf("key: value", "yaml")).toEqual([]);
  });
});

describe("extractTodos", () => {
  it("finds tagged comments in any comment style", () => {
    const code = [
      "// TODO: handle IPv6",
      "x = 1  # FIXME(nam) off by one",
      "/* HACK - skip the cache */",
      "-- TODO backfill old rows",
      "<!-- XXX remove before submitting -->",
      "const todo = 'TODO in a string is not a comment';",
      " * BUG: wrong padding for short blocks",
      "// Tags look like `// TODO: x` or `# FIXME x` in any language",
      "/** TODO/FIXME comments (code only). */",
    ].join("\n");
    expect(extractTodos(code)).toEqual([
      { tag: "TODO", text: "handle IPv6", line: 1 },
      { tag: "FIXME", text: "off by one", line: 2 },
      { tag: "HACK", text: "skip the cache", line: 3 },
      { tag: "TODO", text: "backfill old rows", line: 4 },
      { tag: "XXX", text: "remove before submitting", line: 5 },
      { tag: "BUG", text: "wrong padding for short blocks", line: 7 },
    ]);
  });
});

describe("identifierWords and chunkCode", () => {
  it("splits camelCase and snake_case identifiers into searchable words", () => {
    expect(identifierWords("parseChecklistItems(MAX_TODO_TAGS, HTTPServer)")).toBe("parse checklist items max todo tags http server");
  });

  it("chunks by line windows, labels chunks with their symbol and keeps line numbers", () => {
    const lines = ["export class Parser {", ...Array.from({ length: 70 }, (_, i) => (i === 40 ? "" : `  // line ${i}`)), "  parseLine(input: string) {", "    return input;", "  }", "}"];
    const text = lines.join("\n");
    const outline = outlineOf(text, "typescript");
    const chunks = chunkCode(text, outline, 60);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toMatchObject({ ord: 0, line: 1, heading: "Parser" });
    expect(chunks[1]!.line).toBeGreaterThan(40);
    expect(chunks[1]!.content).toContain("parseLine");
    expect(chunks[1]!.terms).toContain("parse line");
  });
});

describe("analyzeDocument for code", () => {
  it("stores language, outline, TODOs and redacts secrets", () => {
    const text = 'const apiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";\n// TODO: rotate key\nexport function send() {\n}\n';
    const result = analyzeDocument({ path: "src/mail.ts", kind: "code", text });
    expect(result).toMatchObject({ title: "mail.ts", language: "typescript", lineCount: 5, redactions: 1 });
    expect(result.text).not.toContain("sk-proj");
    expect(result.outline).toEqual([{ name: "send", kind: "function", line: 3, depth: 0 }]);
    expect(result.todos).toEqual([{ tag: "TODO", text: "rotate key", line: 2 }]);
    expect(result.checklist.stats.total).toBe(0);
    expect(result.deadlines).toEqual([]);
  });

  it("gives notes a heading outline", () => {
    const result = analyzeDocument({ path: "README.md", kind: "markdown", text: "# Lab 3\n- [x] Setup\n## Kết quả\n" });
    expect(result.language).toBe("markdown");
    expect(result.outline.map((s) => s.name)).toEqual(["Lab 3", "Kết quả"]);
  });
});

describe("buildFileTree", () => {
  it("nests folders first, then files, sorted naturally", () => {
    const tree = buildFileTree([{ path: "src/b.ts" }, { path: "README.md" }, { path: "src/lib/a10.ts" }, { path: "src/lib/a2.ts" }, { path: "docs/x.md" }]);
    const names = (node: typeof tree): unknown =>
      node.children.map((c) => (c.type === "folder" ? { [c.name]: names(c) } : c.name));
    expect(names(tree)).toEqual([{ docs: ["x.md"] }, { src: [{ lib: ["a2.ts", "a10.ts"] }, "b.ts"] }, "README.md"]);
  });
});

describe("headingSlugger", () => {
  it("makes stable, prefixed, unique anchors (Vietnamese folded)", () => {
    const slug = headingSlugger();
    expect(slug("Tiến độ")).toBe("h-tien-do");
    expect(slug("Tiến độ")).toBe("h-tien-do-1");
    expect(slug("Đề cương!")).toBe("h-de-cuong");
    expect(slug("***")).toBe("h-section");
  });
});

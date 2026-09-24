import { describe, expect, it } from "vitest";
import { highlightLines, isHighlightable } from "./highlight";

const text = (line: { text: string }[]) => line.map((s) => s.text).join("");

describe("highlightLines", () => {
  it("keeps one entry per source line with the exact text", () => {
    const code = "const x = 1;\n\n// done\r\nexport { x };";
    const lines = highlightLines(code, "typescript");
    expect(lines.map(text)).toEqual(["const x = 1;", "", "// done", "export { x };"]);
    expect(lines[0]!.find((s) => s.text === "const")?.className).toBe("hljs-keyword");
    expect(lines[2]![0]).toEqual({ text: "// done", className: "hljs-comment" });
  });

  it("carries a multi-line token's class onto every line it spans", () => {
    const lines = highlightLines("/* first\nsecond */\nlet y;", "javascript");
    expect(lines[0]).toEqual([{ text: "/* first", className: "hljs-comment" }]);
    expect(lines[1]).toEqual([{ text: "second */", className: "hljs-comment" }]);
  });

  it("never turns file content into markup: tags stay text, classes are highlight.js names only", () => {
    const lines = highlightLines('<img src=x onerror="alert(1)">\n<script>evil()</script>', "xml");
    expect(lines.map(text)).toEqual(['<img src=x onerror="alert(1)">', "<script>evil()</script>"]);
    for (const segment of lines.flat()) if (segment.className) expect(segment.className).toMatch(/^(hljs-[\w-]+ ?)+$/);
  });

  it("falls back to plain lines for unknown languages", () => {
    expect(highlightLines("a\nb", "no-such-language")).toEqual([[{ text: "a" }], [{ text: "b" }]]);
    expect(highlightLines("a", null)).toEqual([[{ text: "a" }]]);
    expect(isHighlightable("dockerfile")).toBe(true);
    expect(isHighlightable("brainfuck")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { outlineOf } from "./code";
import { analyzeDocument, describeChunks, documentKindOf, excerptOf, extensionOf, inlineDueDate, isSafeRelativePath, projectSlug, splitText } from "./documents";

describe("isSafeRelativePath", () => {
  it.each(["notes.md", "Research/IDS/Tiến độ.md", "a/b/c.docx"])("accepts %j", (path) => {
    expect(isSafeRelativePath(path)).toBe(true);
  });
  it.each(["", "/etc/passwd", "../secret.md", "a/../../b.md", "a//b.md", "./a.md", "C:/x.md", "a\\b.md", "a\u0000b.md", "a/".repeat(260)])(
    "rejects %j",
    (path) => {
      expect(isSafeRelativePath(path)).toBe(false);
    },
  );
});

describe("documentKindOf", () => {
  it("maps extensions case-insensitively", () => {
    expect(documentKindOf("a/B.MD")).toBe("markdown");
    expect(documentKindOf("x.docx")).toBe("docx");
    expect(documentKindOf("x.pdf")).toBe("pdf");
    expect(documentKindOf("x.exe")).toBeNull();
    expect(documentKindOf("README")).toBeNull();
  });
});

describe("splitText and describeChunks", () => {
  it("cuts contiguous slices at headings that give the text back, with exact start lines and heading paths", () => {
    const body = "nội dung ".repeat(50).trim();
    const text = `# Title\n${body}\n## Part A\n${body}\n## Part B\n- [x] done item\n\`\`\`\n# not a heading\n\`\`\`\n`;
    const slices = splitText(text, { headings: true });
    expect(slices.join("")).toBe(text);
    const chunks = describeChunks(slices, outlineOf(text, "markdown"), "markdown");
    expect(chunks.map((c) => [c.line, c.heading, c.content.split("\n")[0]])).toEqual([
      [1, "Title", "# Title"],
      [3, "Title › Part A", "## Part A"],
      [5, "Title › Part B", "## Part B"],
    ]);
  });

  it("keeps slices within the size limit, splitting a very long line only when it has to", () => {
    const text = `${"word ".repeat(300)}\n\n${"x".repeat(9000)}\nend\n`;
    const slices = splitText(text, { max: 4000 });
    expect(slices.join("")).toBe(text);
    expect(slices.every((s) => s.length <= 4000)).toBe(true);
    expect(slices.length).toBe(4);
  });

  it("packs many tiny sections so a document never exceeds the chunk limit", () => {
    const text = Array.from({ length: 400 }, (_, i) => `# Section ${i}\n${"text ".repeat(90)}\n`).join("");
    const slices = splitText(text, { headings: true });
    expect(slices.join("")).toBe(text);
    expect(slices.length).toBeLessThanOrEqual(150);
  });

  it("builds a short plain excerpt and extensions for extension-less build files", () => {
    expect(excerptOf("# Tiến độ\n- [x] **Chọn** đề tài\n\nNội dung")).toBe("Tiến độ Chọn đề tài Nội dung");
    expect(extensionOf("src/App.TSX")).toBe("tsx");
    expect(extensionOf("Dockerfile")).toBe("docker");
    expect(extensionOf("LICENSE")).toBe("txt");
  });

  it("makes project slugs from Vietnamese names", () => {
    expect(projectSlug("Đồ án NT219 – Mật mã")).toBe("do-an-nt219-mat-ma");
    expect(projectSlug("  ")).toBe("project-x");
    expect(projectSlug("A")).toBe("project-a");
    expect(projectSlug("x".repeat(60))).toHaveLength(40);
  });
});

describe("inlineDueDate", () => {
  const ref = "2026-09-20";
  it.each([
    ["Nộp báo cáo giữa kỳ 📅 2026-10-05", "2026-10-05", "Nộp báo cáo giữa kỳ"],
    ["Viết phần Related work (hạn 05/10)", "2026-10-05", "Viết phần Related work"],
    ["Gửi slide cho thầy — deadline: 7/10/2026", "2026-10-07", "Gửi slide cho thầy"],
    ["Chạy lại thí nghiệm @due(2026-10-01)", "2026-10-01", "Chạy lại thí nghiệm"],
  ])("finds the date in %j", (text, due, title) => {
    expect(inlineDueDate(text, ref)).toEqual({ dueDate: due, title });
  });

  it("ignores items without a recognisable date", () => {
    expect(inlineDueDate("Hạn chế của phương pháp", ref)).toBeNull();
    expect(inlineDueDate("Họp nhóm hàng tuần", ref)).toBeNull();
  });
});

describe("analyzeDocument", () => {
  const markdown = `# Tiến độ đồ án

- **Ngày cập nhật:** 20/09/2026

## Mốc

| Mốc | Hạn |
|---|---|
| **Nộp đề cương** | 30/09 |

## Việc

- [x] Chọn đề tài
- [ ] Viết đề cương 📅 2026-09-28
- [!] Hỏi thầy về dữ liệu
- [CẮT] Bản demo mobile

Token cũ: ghp_${"a".repeat(36)}
`;

  it("derives title, checklist progress, deadlines and chunks from Markdown", () => {
    const result = analyzeDocument({ path: "DoAn/tien-do.md", kind: "markdown", text: markdown });
    expect(result.title).toBe("Tiến độ đồ án");
    expect(result.referenceDate).toBe("2026-09-20");
    expect(result.checklist.stats).toMatchObject({ total: 4, done: 1, todo: 1, attention: 1, cut: 1 });
    expect(result.deadlines.map((d) => [d.origin, d.title, d.dueDate, d.hard, d.status])).toEqual([
      ["table", "Nộp đề cương", "2026-09-30", true, null],
      ["checklist", "Viết đề cương", "2026-09-28", false, "todo"],
    ]);
    expect(result.chunks.map((c) => c.content).join("")).toBe(result.text);
    expect(result.excerpt.startsWith("Tiến độ đồ án")).toBe(true);
  });

  it("redacts secrets before anything is derived or stored", () => {
    const result = analyzeDocument({ path: "DoAn/tien-do.md", kind: "markdown", text: markdown });
    expect(result.redactions).toBe(1);
    expect(result.text).not.toContain("ghp_");
    expect(result.chunks.map((c) => c.content).join("\n")).not.toContain("ghp_");
  });

  it("keeps deadline keys stable when only the date changes", () => {
    const a = analyzeDocument({ path: "p.md", kind: "markdown", text: markdown });
    const b = analyzeDocument({ path: "p.md", kind: "markdown", text: markdown.replace("2026-09-28", "2026-09-29").replace("30/09", "01/10") });
    expect(b.deadlines.map((d) => d.key)).toEqual(a.deadlines.map((d) => d.key));
    expect(b.deadlines.map((d) => d.dueDate)).toEqual(["2026-10-01", "2026-09-29"]);
  });

  it("only chunks non-Markdown documents and titles them by file name", () => {
    const result = analyzeDocument({ path: "papers/Survey IDS.pdf", kind: "pdf", text: "## Page 1\n- [ ] not a checklist in a PDF" });
    expect(result.title).toBe("Survey IDS");
    expect(result.checklist.stats.total).toBe(0);
    expect(result.deadlines).toEqual([]);
    expect(result.chunks[0]).toMatchObject({ heading: "Page 1" });
  });
});

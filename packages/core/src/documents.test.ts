import { describe, expect, it } from "vitest";
import { analyzeDocument, chunkDocument, documentKindOf, inlineDueDate, isSafeRelativePath } from "./documents";

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

describe("chunkDocument", () => {
  it("starts a chunk at every heading and records the heading path and line", () => {
    const chunks = chunkDocument("intro line\n\n# Title\n\n## Part A\ntext **a**\n\n## Part B\n- [x] done item\n```\n# not a heading\n```\n");
    expect(chunks.map((c) => [c.heading, c.content, c.line])).toEqual([
      [null, "intro line", 1],
      ["Title › Part A", "text a", 6],
      ["Title › Part B", "[x] done item\n# not a heading", 9],
    ]);
  });

  it("splits long sections at paragraph breaks and very long paragraphs at spaces", () => {
    const paragraph = "word ".repeat(200).trim(); // 999 chars
    const chunks = chunkDocument(`# H\n${paragraph}\n\n${paragraph}\n\n${"x".repeat(3500)}`, 1200);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.every((c) => c.content.length <= 1400)).toBe(true);
    expect(chunks.every((c) => c.heading === "H")).toBe(true);
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
    expect(result.chunks.length).toBeGreaterThan(1);
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

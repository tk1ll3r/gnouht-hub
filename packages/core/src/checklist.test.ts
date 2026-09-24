import { describe, expect, it } from "vitest";
import { parseChecklist } from "./checklist";

// Synthetic fixture that mirrors the structure of the user's progress files (not their content).
const FIXTURE = `# CHECKLIST TIẾN ĐỘ — DEMO

## 2. Quy ước trạng thái

- \`[x]\` Đã hoàn thành và có artifact đối chiếu.
- \`[ ]\` Chưa hoàn thành.

## 3. Quyết định đã chốt

### 3.1. Chuyển trọng tâm đóng góp

- [ ] Giáo viên hướng dẫn xác nhận việc chuyển trọng tâm.
- [x] **Pilot đã hoàn thành** với 8 run.
- [~] Viết phần *Method* và \`Setup\`
- [!] **Ba phát hiện** cần điều tra trước khi khóa claim.
- [CẮT] Thử nghiệm mở rộng không kịp hạn
  - [ ] Mục con lồng bên trong

\`\`\`md
- [ ] this is inside a code block
\`\`\`

## 4. Việc còn lại
1. [X] Mục có đánh số
* [ ] Giáo viên hướng dẫn xác nhận việc chuyển trọng tâm.
`;

describe("parseChecklist", () => {
  const result = parseChecklist(FIXTURE, "Research/demo.md");

  it("counts real checklist items only (not legends or code blocks)", () => {
    expect(result.stats).toEqual({ total: 8, todo: 3, doing: 1, attention: 1, done: 2, cut: 1 });
  });

  it("computes progress as done ÷ (total − cut)", () => {
    expect(result.progress).toBeCloseTo(2 / 7);
  });

  it("cleans inline markdown and records the nearest section", () => {
    const pilot = result.items.find((i) => i.text.startsWith("Pilot"));
    expect(pilot).toMatchObject({
      text: "Pilot đã hoàn thành với 8 run.",
      status: "done",
      section: "3.1. Chuyển trọng tâm đóng góp",
      sectionPath: ["CHECKLIST TIẾN ĐỘ — DEMO", "3. Quyết định đã chốt", "3.1. Chuyển trọng tâm đóng góp"],
      line: 13,
    });
    expect(result.items.find((i) => i.status === "doing")!.text).toBe("Viết phần Method và Setup");
  });

  it("records nesting depth", () => {
    expect(result.items.find((i) => i.text === "Mục con lồng bên trong")!.indent).toBe(2);
  });

  it("gives stable keys that change with text or section, and disambiguates duplicates", () => {
    const again = parseChecklist(FIXTURE, "Research/demo.md");
    expect(again.items.map((i) => i.key)).toEqual(result.items.map((i) => i.key));
    expect(new Set(result.items.map((i) => i.key)).size).toBe(result.items.length);

    const edited = parseChecklist(FIXTURE.replace("8 run", "9 run"), "Research/demo.md");
    const changed = edited.items.filter((item, index) => item.key !== result.items[index]!.key);
    expect(changed.map((i) => i.text)).toEqual(["Pilot đã hoàn thành với 9 run."]);

    const otherFile = parseChecklist(FIXTURE, "Research/other.md");
    expect(otherFile.items[0]!.key).not.toBe(result.items[0]!.key);
  });

  it("recognises CẮT even when the file uses decomposed (NFD) Unicode", () => {
    const nfd = parseChecklist("- [CẮT] Bỏ phần này".normalize("NFD"));
    expect(nfd.stats.cut).toBe(1);
    expect(nfd.items[0]!.text).toBe("Bỏ phần này");
  });

  it("returns zero progress for files without a checklist", () => {
    expect(parseChecklist("# Notes\nJust text.")).toMatchObject({ items: [], progress: 0 });
  });
});

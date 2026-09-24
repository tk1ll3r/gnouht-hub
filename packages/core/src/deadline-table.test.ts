import { describe, expect, it } from "vitest";
import { findReferenceDate, parseDateCell, parseDeadlineTables } from "./deadline-table";

// Synthetic fixture shaped like the milestone tables in the user's checklists.
const FIXTURE = `# DEMO

- **Ngày cập nhật:** 26/08/2026

### Các mốc thời gian cứng

| Mốc | Hạn | Số ngày còn lại tính từ 26/08 |
|---|---|---:|
| Khóa phương pháp, không đổi cấu hình sau mốc này | 31/08 | 5 |
| **Hạn nộp abstract** | **09/09** | **14** |
| Viết Method, Setup, Results | 09–12/09 | — |
| Chưa chốt ngày | — | — |

### Không có cột hạn

| ID | Lớp | Số mẫu gộp toàn cục |
|---:|---|---:|
| 0 | DDoS | 21.750.139 |
`;

describe("findReferenceDate", () => {
  it("reads the document date from common Vietnamese labels", () => {
    expect(findReferenceDate(FIXTURE)).toBe("2026-08-26");
    expect(findReferenceDate("**Ngày:** 30/08/2026 · **Kỳ trước:** 26/08/2026")).toBe("2026-08-30");
    expect(findReferenceDate("no date here")).toBeNull();
  });
});

describe("parseDateCell", () => {
  const ref = "2026-08-26";
  it.each([
    ["31/08", { start: null, end: "2026-08-31" }],
    ["5/9/2027", { start: null, end: "2027-09-05" }],
    ["2026-12-01", { start: null, end: "2026-12-01" }],
    ["**09/09**", { start: null, end: "2026-09-09" }],
    ["09–12/09", { start: "2026-09-09", end: "2026-09-12" }],
    ["30/08-02/09", { start: "2026-08-30", end: "2026-09-02" }],
  ])("parses %j", (cell, expected) => {
    expect(parseDateCell(cell, ref)).toEqual(expected);
  });

  it("rolls the year forward for early-year dates in an autumn document", () => {
    expect(parseDateCell("05/01", "2026-11-20")).toEqual({ start: null, end: "2027-01-05" });
    expect(parseDateCell("20/12", "2027-01-10")).toEqual({ start: null, end: "2026-12-20" });
  });

  it.each(["—", "", "31/02", "sometime", "5"])("rejects %j", (cell) => {
    expect(parseDateCell(cell, ref)).toBeNull();
  });

  it("needs an explicit year when there is no reference date", () => {
    expect(parseDateCell("31/08", null)).toBeNull();
    expect(parseDateCell("31/08/2026", null)).toEqual({ start: null, end: "2026-08-31" });
  });
});

describe("parseDeadlineTables", () => {
  const rows = parseDeadlineTables(FIXTURE, { sourcePath: "Research/demo.md" });

  it("extracts dated rows only from tables with a deadline column", () => {
    expect(rows.map((r) => [r.title, r.startDate, r.dueDate, r.hard])).toEqual([
      ["Khóa phương pháp, không đổi cấu hình sau mốc này", null, "2026-08-31", false],
      ["Hạn nộp abstract", null, "2026-09-09", true],
      ["Viết Method, Setup, Results", "2026-09-09", "2026-09-12", false],
    ]);
    expect(rows[1]!.line).toBe(10);
  });

  it("keys rows by file and title so edits to the date keep the same identity", () => {
    const moved = parseDeadlineTables(FIXTURE.replace("| 31/08 |", "| 01/09 |"), { sourcePath: "Research/demo.md" });
    expect(moved[0]!.dueDate).toBe("2026-09-01");
    expect(moved[0]!.key).toBe(rows[0]!.key);
  });

  it("prefers an explicit reference date over the one in the text", () => {
    const shifted = parseDeadlineTables(FIXTURE, { referenceDate: "2027-08-01" });
    expect(shifted[0]!.dueDate).toBe("2027-08-31");
  });
});

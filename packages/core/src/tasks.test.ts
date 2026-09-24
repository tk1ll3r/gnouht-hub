import { describe, expect, it } from "vitest";
import { inferTaskKind } from "./tasks";

describe("inferTaskKind", () => {
  it.each([
    ["Quiz 2 closes", "quiz"],
    ["Kiểm tra giữa kỳ online", "quiz"],
    ["Thi cuối kỳ NT219", "exam"],
    ["Báo cáo tiến độ đồ án", "report"],
    ["Nộp bài tập tuần 3", "assignment"],
    ["Lab 4: AES modes", "assignment"],
    ["Thiết kế hệ thống", "task"], // "thi" inside "Thiết" must not count as an exam
    ["Họp nhóm", "task"],
  ])("%s → %s", (title, kind) => {
    expect(inferTaskKind(title)).toBe(kind);
  });
});

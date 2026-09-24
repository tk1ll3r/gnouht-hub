import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it.each([
    ["/today", "/today"],
    ["/courses/abc?tab=sessions#x", "/courses/abc?tab=sessions#x"],
    ["/a/../settings", "/settings"],
  ])("keeps same-origin path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    null,
    "",
    "today",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "javascript:alert(1)",
    `/${"a".repeat(600)}`,
  ])("falls back for %j", (input) => {
    expect(safeNextPath(input)).toBe("/today");
  });
});

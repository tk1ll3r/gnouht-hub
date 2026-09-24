import { describe, expect, it } from "vitest";
import { nextFromEmailLink, safeNextPath } from "./safe-redirect";

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

describe("nextFromEmailLink", () => {
  const app = "https://hub.gnouht.space";
  const params = (query: string) => new URLSearchParams(query);

  it("uses the next of a same-origin redirect_to", () => {
    expect(nextFromEmailLink(params("next=/today&redirect_to=https://hub.gnouht.space/auth/callback?next=%2Finvite%2Fabc"), app)).toBe("/invite/abc");
  });

  it("ignores redirect_to on other origins and falls back to next", () => {
    expect(nextFromEmailLink(params("next=/today&redirect_to=https://evil.example/auth/callback?next=%2Fsettings"), app)).toBe("/today");
    expect(nextFromEmailLink(params("next=/today&redirect_to=not a url"), app)).toBe("/today");
  });

  it("still validates the inner next", () => {
    expect(nextFromEmailLink(params("redirect_to=https://hub.gnouht.space/auth/callback?next=%2F%2Fevil.example"), app)).toBe("/today");
  });
});

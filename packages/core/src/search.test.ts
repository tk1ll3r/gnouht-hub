import { describe, expect, it } from "vitest";
import { foldText, highlightSnippet, searchTerms } from "./search";

describe("foldText", () => {
  it("removes Vietnamese diacritics, including đ, and lower-cases", () => {
    expect(foldText("Tiến Độ ĐƯỜNG Phương pháp")).toBe("tien do duong phuong phap");
  });

  it("handles decomposed (NFD) input", () => {
    expect(foldText("Chuyển trọng tâm".normalize("NFD"))).toBe("chuyen trong tam");
  });
});

describe("searchTerms", () => {
  it("splits on anything that is not a letter or digit, dedupes and caps", () => {
    expect(searchTerms("  Tiến-độ: đồ án!!  tiến ")).toEqual(["tien", "do", "an"]);
    expect(searchTerms("a b c d e f g h i j k l m n")).toHaveLength(12);
    expect(searchTerms("*&^%")).toEqual([]);
  });

  it("drops tsquery syntax characters", () => {
    expect(searchTerms("foo & !bar | baz:* <-> 'q'")).toEqual(["foo", "bar", "baz", "q"]);
  });
});

describe("highlightSnippet", () => {
  const text = "Nhóm đã khóa phương pháp. Tiến độ viết Method đạt 60%, còn phần Kết quả và Thảo luận.";

  it("highlights accent-insensitive prefix matches in the original text", () => {
    const parts = highlightSnippet(text, "tien do ket");
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["Tiến", "độ", "Kết"]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
  });

  it("matches only at word starts", () => {
    const parts = highlightSnippet("method methodology amethyst", "meth");
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["meth", "meth"]);
  });

  it("windows long content around the first hit with ellipses", () => {
    const long = `${"lorem ipsum ".repeat(60)}KEYWORD here ${"dolor sit ".repeat(60)}`;
    const parts = highlightSnippet(long, "keyword", 100);
    const joined = parts.map((p) => p.text).join("");
    expect(joined.startsWith("…")).toBe(true);
    expect(joined.endsWith("…")).toBe(true);
    expect(joined.length).toBeLessThan(160);
    expect(parts.some((p) => p.hit && p.text === "KEYWORD")).toBe(true);
  });

  it("returns the start of the text when nothing matches", () => {
    expect(highlightSnippet("short text", "zzz")).toEqual([{ text: "short text", hit: false }]);
  });
});

import { describe, expect, it } from "vitest";
import { fuzzyMatch, highlightPositions } from "./fuzzy";

const rank = (query: string, targets: string[]) =>
  targets
    .map((t) => ({ t, m: fuzzyMatch(query, t) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m!.score - a.m!.score)
    .map((x) => x.t);

describe("fuzzyMatch", () => {
  it("requires every character in order", () => {
    expect(fuzzyMatch("lyt", "app/layout.tsx")).not.toBeNull();
    expect(fuzzyMatch("tyl", "app/layout.tsx")).toBeNull();
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
  });

  it("prefers file-name matches, word starts and consecutive runs", () => {
    expect(rank("page", ["src/pages/index.ts", "app/today/page.tsx", "lib/paging-helper.ts"])[0]).toBe("app/today/page.tsx");
    expect(rank("dp", ["docs/page.tsx", "app/dropdown.tsx", "lib/deep.ts"])[0]).toBe("docs/page.tsx");
    expect(rank("cm", ["lib/commit.ts", "components/command-menu.tsx"])[0]).toBe("components/command-menu.tsx");
    expect(rank("pc", ["lib/parseChecklist.ts", "lib/specific.ts"])[0]).toBe("lib/parseChecklist.ts");
  });

  it("matches each space-separated term, ignoring case and accents", () => {
    expect(fuzzyMatch("tien do", "notes/Tiến độ tuần 3.md")).not.toBeNull();
    expect(fuzzyMatch("web auth", "apps/web/lib/auth.ts")).not.toBeNull();
    expect(fuzzyMatch("web auth", "apps/agent/lib/cloud.ts")).toBeNull();
  });

  it("returns the matched positions for highlighting", () => {
    const match = fuzzyMatch("lay", "app/layout.tsx")!;
    expect(match.positions).toEqual([4, 5, 6]);
    expect(highlightPositions("app/layout.tsx", match.positions)).toEqual([
      { text: "app/", hit: false },
      { text: "lay", hit: true },
      { text: "out.tsx", hit: false },
    ]);
  });

  it("is fast enough for thousands of paths per keystroke", () => {
    const paths = Array.from({ length: 5000 }, (_, i) => `apps/module-${i % 50}/src/components/feature-${i}/index-${i}.tsx`);
    const started = performance.now();
    for (const p of paths) fuzzyMatch("feat idx", p);
    expect(performance.now() - started).toBeLessThan(400);
  });
});

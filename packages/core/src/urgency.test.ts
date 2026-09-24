import { describe, expect, it } from "vitest";
import type { Interval } from "./intervals";
import { rankTasks, remainingHoursOf, type UrgencyTask } from "./urgency";

const at = (local: string) => new Date(`${local}:00+07:00`);
const NOW = at("2026-09-24T08:00"); // Thursday
const DAY = { dayStart: "07:00", dayEnd: "23:00" };

function task(id: string, due: string | null, overrides: Partial<UrgencyTask> = {}): UrgencyTask {
  return {
    id,
    title: id,
    kind: "assignment",
    status: "todo",
    dueAt: due ? at(due) : null,
    estimateHours: 3,
    progress: 0,
    ...overrides,
  };
}

function rank(tasks: UrgencyTask[], busy: Interval[] = []) {
  return rankTasks(tasks, { now: NOW, busy, ...DAY });
}

describe("remainingHoursOf", () => {
  it("uses the estimate, falling back to the default for the kind, scaled by progress", () => {
    expect(remainingHoursOf(task("a", null, { estimateHours: 4, progress: 0.25 }))).toBe(3);
    expect(remainingHoursOf(task("b", null, { estimateHours: null, kind: "quiz" }))).toBe(1);
    expect(remainingHoursOf(task("c", null, { progress: 1.5 }))).toBe(0);
  });
});

describe("rankTasks", () => {
  it("separates undated tasks and ignores finished ones", () => {
    const { ranked, undated } = rank([
      task("dated", "2026-10-10T23:00"),
      task("undated", null),
      task("done", "2026-09-25T10:00", { status: "done" }),
      task("cut", "2026-09-25T10:00", { status: "cut" }),
    ]);
    expect(ranked.map((r) => r.task.id)).toEqual(["dated"]);
    expect(undated.map((t) => t.id)).toEqual(["undated"]);
  });

  it("flags overdue work as urgent with an explanation", () => {
    const [item] = rank([task("late", "2026-09-23T07:00")]).ranked;
    expect(item).toMatchObject({ tier: "urgent", overdue: true, freeHours: 0 });
    expect(item!.reason).toBe("Overdue by 1d 1h");
  });

  it("treats anything due within 24 hours as urgent", () => {
    const [item] = rank([task("tonight", "2026-09-24T20:00", { estimateHours: 1 })]).ranked;
    expect(item!.tier).toBe("urgent");
    expect(item!.reason).toMatch(/^Due in 12h/);
  });

  it("rates a comfortable deadline 2–3 days out as coming up, and a far one as on track", () => {
    const { ranked } = rank([task("sat", "2026-09-26T23:59"), task("next-week", "2026-10-02T23:00", { estimateHours: 2 })]);
    const byId = Object.fromEntries(ranked.map((r) => [r.task.id, r]));
    expect(byId.sat!.tier).toBe("soon");
    expect(byId.sat!.freeHours).toBe(47); // Thu 15h + Fri 16h + Sat 16h
    expect(byId["next-week"]!.tier).toBe("ok");
    expect(byId["next-week"]!.reason).toMatch(/^~2h of work, \d+h free before Fri 2 Oct 23:00$/);
  });

  it("marks work that cannot fit in the free time as urgent", () => {
    // Thursday and Friday are fully booked, so nothing is free before Friday evening.
    const busy = [{ start: at("2026-09-24T07:00"), end: at("2026-09-25T23:00") }];
    const [item] = rank([task("blocked", "2026-09-25T23:00", { estimateHours: 4 })], busy).ranked;
    expect(item!.tier).toBe("urgent");
    expect(item!.slackHours).toBe(-4);
    expect(item!.reason).toBe("~4h of work left, only 0h free before Fri 23:00");
  });

  it("uses earliest-deadline-first so earlier work consumes shared free time", () => {
    // Only Monday 08:00–20:30 is free before both deadlines (12h and 12.5h).
    const busy = [
      { start: at("2026-09-24T07:00"), end: at("2026-09-28T08:00") },
      { start: at("2026-09-28T20:30"), end: at("2026-09-28T23:00") },
    ];
    const { ranked } = rank(
      [task("second", "2026-09-28T20:30", { estimateHours: 8 }), task("first", "2026-09-28T20:00", { estimateHours: 8 })],
      busy,
    );
    const byId = Object.fromEntries(ranked.map((r) => [r.task.id, r]));
    // On its own each task fits (ratio < 0.7), so the first is only "coming up"…
    expect(byId.first!.tier).toBe("soon");
    // …but together they need 16h of the 12.5h available before the second deadline.
    expect(byId.second!.tier).toBe("urgent");
    expect(byId.second!.cumulativeSlackHours).toBe(-3.5);
    expect(byId.second!.reason).toBe("With earlier deadlines you need ~16h, but only 12.5h free before Mon 20:30");
    expect(ranked[0]!.task.id).toBe("second");
  });

  it("orders by tier, then weighted pressure", () => {
    const { ranked } = rank([
      task("light", "2026-09-30T23:00", { estimateHours: 1 }),
      task("heavy", "2026-09-30T23:00", { estimateHours: 30 }),
      task("important", "2026-09-30T23:00", { estimateHours: 1, weight: 3 }),
      task("late", "2026-09-20T23:00"),
    ]);
    expect(ranked.map((r) => r.task.id)).toEqual(["late", "heavy", "important", "light"]);
  });
});

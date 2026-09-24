import { describe, expect, it } from "vitest";
import { dailyLoad, deadlineClusters, findConflicts, suggestStudyBlocks } from "./analysis";
import { rankTasks, type UrgencyTask } from "./urgency";

const at = (local: string) => new Date(`${local}:00+07:00`);
const DAY = { dayStart: "07:00", dayEnd: "23:00" };

describe("dailyLoad", () => {
  it("reports busy and free productive hours plus deadlines per day", () => {
    const busy = [
      { start: at("2026-09-24T07:30"), end: at("2026-09-24T09:45") },
      { start: at("2026-09-24T05:00"), end: at("2026-09-24T06:00") }, // before the day starts: ignored
    ];
    const load = dailyLoad("2026-09-24", 2, busy, [at("2026-09-24T23:59"), at("2026-09-25T12:00"), at("2026-09-25T13:00")], DAY);
    expect(load).toEqual([
      { date: "2026-09-24", busyHours: 2.25, freeHours: 13.75, deadlines: 1 },
      { date: "2026-09-25", busyHours: 0, freeHours: 16, deadlines: 2 },
    ]);
  });
});

describe("deadlineClusters", () => {
  it("finds bunches of deadlines inside the window and merges overlapping windows", () => {
    const clusters = deadlineClusters(
      [
        { id: "a", dueAt: at("2026-09-24T23:00") },
        { id: "b", dueAt: at("2026-09-25T23:00") },
        { id: "c", dueAt: at("2026-09-26T23:00") },
        { id: "d", dueAt: at("2026-09-27T12:00") },
        { id: "far", dueAt: at("2026-10-20T23:00") },
      ],
      72,
      3,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.ids).toEqual(["a", "b", "c", "d"]);
  });

  it("returns nothing when deadlines are spread out", () => {
    expect(deadlineClusters([{ id: "a", dueAt: at("2026-09-24T23:00") }, { id: "b", dueAt: at("2026-10-24T23:00") }])).toEqual([]);
  });
});

describe("findConflicts", () => {
  it("reports every overlapping pair once", () => {
    const conflicts = findConflicts([
      { id: "class", start: at("2026-09-24T07:30"), end: at("2026-09-24T09:45") },
      { id: "meeting", start: at("2026-09-24T09:00"), end: at("2026-09-24T10:00") },
      { id: "lunch", start: at("2026-09-24T09:45"), end: at("2026-09-24T10:30") },
      { id: "later", start: at("2026-09-24T11:00"), end: at("2026-09-24T12:00") },
    ]);
    expect(conflicts).toEqual([
      ["class", "meeting"],
      ["meeting", "lunch"],
    ]);
  });
});

describe("suggestStudyBlocks", () => {
  it("fills the earliest long-enough slots before each deadline in ranked order", () => {
    const now = at("2026-09-24T08:00");
    const tasks: UrgencyTask[] = [
      { id: "report", title: "Report", kind: "report", status: "todo", dueAt: at("2026-09-25T23:00"), estimateHours: 4, progress: 0 },
    ];
    const { ranked } = rankTasks(tasks, { now, busy: [], ...DAY });
    const slots = [
      { start: at("2026-09-24T08:00"), end: at("2026-09-24T09:00") }, // too short
      { start: at("2026-09-24T13:00"), end: at("2026-09-24T18:00") },
      { start: at("2026-09-25T08:00"), end: at("2026-09-25T12:00") },
    ];
    const blocks = suggestStudyBlocks(ranked, slots, { minMinutes: 90, maxBlockMinutes: 180 });
    expect(blocks.map((b) => [b.taskId, b.start.toISOString(), b.end.toISOString()])).toEqual([
      ["report", at("2026-09-24T13:00").toISOString(), at("2026-09-24T16:00").toISOString()],
      ["report", at("2026-09-25T08:00").toISOString(), at("2026-09-25T09:30").toISOString()],
    ]);
  });
});

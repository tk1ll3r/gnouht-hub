import { describe, expect, it } from "vitest";
import { deadlineClusters } from "./analysis";
import { buildHeuristicBrief } from "./brief";
import { rankTasks, type UrgencyTask } from "./urgency";

const at = (local: string) => new Date(`${local}:00+07:00`);

describe("buildHeuristicBrief", () => {
  it("summarises urgent work, today's agenda and warnings", () => {
    const now = at("2026-09-24T06:30");
    const tasks: (UrgencyTask & { course: string })[] = [
      { id: "1", title: "Lab 3", kind: "assignment", status: "todo", dueAt: at("2026-09-24T23:59"), estimateHours: 2, progress: 0, course: "NT219" },
      { id: "2", title: "Quiz", kind: "quiz", status: "todo", dueAt: at("2026-09-25T20:00"), estimateHours: 1, progress: 0, course: "NT101" },
      { id: "3", title: "Report", kind: "report", status: "todo", dueAt: at("2026-09-26T20:00"), estimateHours: 6, progress: 0, course: "NT219" },
      { id: "4", title: "Old", kind: "task", status: "todo", dueAt: at("2026-09-20T20:00"), estimateHours: 1, progress: 0, course: "NT101" },
    ];
    const { ranked } = rankTasks(tasks, { now, busy: [], dayStart: "07:00", dayEnd: "23:00" });
    const brief = buildHeuristicBrief({
      now,
      ranked,
      undatedCount: 2,
      agenda: [{ title: "NT219 lecture", start: at("2026-09-24T07:30"), end: at("2026-09-24T09:45"), detail: "B1.12" }],
      freeHoursToday: 11.5,
      clusters: deadlineClusters(tasks.map((t) => ({ id: t.id, dueAt: t.dueAt! }))),
      labelOf: (task) => task.course,
    });

    expect(brief.headline).toBe("Thursday 24 Sep: 2 urgent, 2 coming up. 11.5h free today.");
    expect(brief.counts).toEqual({ urgent: 2, soon: 2, ok: 0, undated: 2 });
    expect(brief.markdown).toContain("1. **NT101 Old.** Overdue by 3d 10h");
    expect(brief.markdown).toContain("- **07:30–09:45** NT219 lecture (B1.12)");
    expect(brief.markdown).toContain("1 overdue item: finish or re-plan it.");
    expect(brief.markdown).toContain("2 open tasks have no deadline.");
  });
});

import { describe, expect, it } from "vitest";
import { availabilityGrid, bestMeetingSlots, freeCounts, intersectIntervals } from "./availability";

const at = (local: string) => new Date(`${local}:00+07:00`);
const iv = (a: string, b: string) => ({ start: at(a), end: at(b) });
const fmt = (slots: { start: Date; end: Date; free?: number }[]) =>
  slots.map((s) => `${s.start.toISOString().slice(11, 16)}-${s.end.toISOString().slice(11, 16)}${s.free !== undefined ? `x${s.free}` : ""}`);

describe("intersectIntervals", () => {
  it("keeps only overlapping parts", () => {
    const a = [iv("2026-10-01T08:00", "2026-10-01T12:00"), iv("2026-10-01T14:00", "2026-10-01T18:00")];
    const b = [iv("2026-10-01T10:00", "2026-10-01T15:00")];
    expect(fmt(intersectIntervals(a, b))).toEqual(["03:00-05:00", "07:00-08:00"]);
    expect(intersectIntervals(a, [])).toEqual([]);
  });
});

describe("freeCounts", () => {
  it("counts free members per segment and treats touching intervals as disjoint", () => {
    const members = [
      [iv("2026-10-01T08:00", "2026-10-01T10:00")],
      [iv("2026-10-01T09:00", "2026-10-01T11:00")],
      [iv("2026-10-01T10:00", "2026-10-01T12:00")],
    ];
    expect(fmt(freeCounts(members))).toEqual(["01:00-02:00x1", "02:00-03:00x2", "03:00-04:00x2", "04:00-05:00x1"]);
  });
});

describe("bestMeetingSlots", () => {
  const alice = [iv("2026-10-01T08:00", "2026-10-01T12:00"), iv("2026-10-01T19:00", "2026-10-01T22:00")];
  const bao = [iv("2026-10-01T09:00", "2026-10-01T11:30"), iv("2026-10-01T19:30", "2026-10-01T21:00")];
  const chi = [iv("2026-10-01T13:00", "2026-10-01T17:00"), iv("2026-10-01T20:00", "2026-10-01T23:00")];

  it("returns slots where everyone is free when there are any", () => {
    expect(bestMeetingSlots([alice, bao, chi], 60)).toEqual({ threshold: 3, slots: [{ ...iv("2026-10-01T20:00", "2026-10-01T21:00"), free: 3 }] });
  });

  it("falls back to the largest subset when nobody overlaps long enough", () => {
    const result = bestMeetingSlots([alice, bao, chi], 90);
    expect(result.threshold).toBe(2);
    expect(fmt(result.slots)).toEqual(["02:00-04:30x2", "12:30-15:00x2"]);
  });

  it("never suggests slots with fewer than half the members", () => {
    const lonely = [[iv("2026-10-01T08:00", "2026-10-01T09:00")], [iv("2026-10-01T10:00", "2026-10-01T11:00")], [], []];
    expect(bestMeetingSlots(lonely, 30).slots).toEqual([]);
    expect(bestMeetingSlots([], 30)).toEqual({ threshold: 0, slots: [] });
  });
});

describe("availabilityGrid", () => {
  it("builds hourly cells inside the viewer's day window, skipping past slots", () => {
    const members = [[iv("2026-10-01T08:00", "2026-10-01T10:00")], [iv("2026-10-01T09:00", "2026-10-01T12:00")]];
    const grid = availabilityGrid(members, at("2026-10-01T08:30"), at("2026-10-02T09:00"), { dayStart: "08:00", dayEnd: "12:00", tz: "Asia/Ho_Chi_Minh" });
    expect(grid.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(fmt(grid[0]!.cells)).toEqual(["02:00-03:00x2", "03:00-04:00x1", "04:00-05:00x1"]);
    expect(fmt(grid[1]!.cells)).toEqual(["01:00-02:00x0"]);
  });
});

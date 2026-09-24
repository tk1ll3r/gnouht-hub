import { describe, expect, it } from "vitest";
import {
  dayWindows,
  freeHoursUntil,
  freeIntervals,
  freeSlots,
  mergeIntervals,
  subtractIntervals,
  totalHours,
  type Interval,
} from "./intervals";

const at = (local: string) => new Date(`${local}:00+07:00`);
const iv = (start: string, end: string): Interval => ({ start: at(start), end: at(end) });
const show = (list: Interval[]) => list.map((i) => `${i.start.toISOString()}/${i.end.toISOString()}`);
const DAY = { dayStart: "07:00", dayEnd: "23:00" };

describe("mergeIntervals", () => {
  it("merges overlapping and touching intervals and drops empty ones", () => {
    const merged = mergeIntervals([
      iv("2026-09-24T10:00", "2026-09-24T11:00"),
      iv("2026-09-24T08:00", "2026-09-24T09:00"),
      iv("2026-09-24T09:00", "2026-09-24T09:30"),
      iv("2026-09-24T10:30", "2026-09-24T12:00"),
      iv("2026-09-24T13:00", "2026-09-24T13:00"),
    ]);
    expect(show(merged)).toEqual(
      show([iv("2026-09-24T08:00", "2026-09-24T09:30"), iv("2026-09-24T10:00", "2026-09-24T12:00")]),
    );
  });

  it("does not mutate its input", () => {
    const input = [iv("2026-09-24T08:00", "2026-09-24T09:00"), iv("2026-09-24T08:30", "2026-09-24T10:00")];
    mergeIntervals(input);
    expect(input[0]!.end.toISOString()).toBe(at("2026-09-24T09:00").toISOString());
  });
});

describe("subtractIntervals", () => {
  it("cuts holes out of the base intervals", () => {
    const result = subtractIntervals(
      [iv("2026-09-24T08:00", "2026-09-24T12:00")],
      [iv("2026-09-24T09:00", "2026-09-24T10:00"), iv("2026-09-24T11:00", "2026-09-24T13:00")],
    );
    expect(show(result)).toEqual(
      show([iv("2026-09-24T08:00", "2026-09-24T09:00"), iv("2026-09-24T10:00", "2026-09-24T11:00")]),
    );
  });

  it("returns nothing when the hole covers the base", () => {
    expect(subtractIntervals([iv("2026-09-24T08:00", "2026-09-24T09:00")], [iv("2026-09-24T07:00", "2026-09-24T10:00")])).toEqual([]);
  });
});

describe("dayWindows", () => {
  it("returns the productive part of each day clipped to the range", () => {
    const windows = dayWindows(at("2026-09-24T10:00"), at("2026-09-25T12:00"), DAY);
    expect(show(windows)).toEqual(
      show([iv("2026-09-24T10:00", "2026-09-24T23:00"), iv("2026-09-25T07:00", "2026-09-25T12:00")]),
    );
    expect(totalHours(windows)).toBe(18);
  });

  it("is empty for an empty range and rejects inverted days", () => {
    expect(dayWindows(at("2026-09-24T10:00"), at("2026-09-24T10:00"), DAY)).toEqual([]);
    expect(() => dayWindows(at("2026-09-24T10:00"), at("2026-09-25T10:00"), { dayStart: "22:00", dayEnd: "07:00" })).toThrow();
  });

  it("excludes the night between days", () => {
    const windows = dayWindows(at("2026-09-24T23:30"), at("2026-09-25T06:30"), DAY);
    expect(windows).toEqual([]);
  });
});

describe("freeIntervals / freeSlots", () => {
  const busy = [iv("2026-09-24T09:00", "2026-09-24T11:00"), iv("2026-09-24T13:00", "2026-09-24T14:00")];

  it("subtracts busy blocks, with optional buffer", () => {
    const free = freeIntervals(at("2026-09-24T08:00"), at("2026-09-24T16:00"), busy, DAY);
    expect(totalHours(free)).toBe(5);
    const buffered = freeIntervals(at("2026-09-24T08:00"), at("2026-09-24T16:00"), busy, { ...DAY, bufferMinutes: 15 });
    expect(totalHours(buffered)).toBe(4);
  });

  it("keeps only slots that are long enough", () => {
    const slots = freeSlots(at("2026-09-24T08:00"), at("2026-09-24T16:00"), busy, { ...DAY, minMinutes: 90 });
    expect(show(slots)).toEqual(
      show([iv("2026-09-24T11:00", "2026-09-24T13:00"), iv("2026-09-24T14:00", "2026-09-24T16:00")]),
    );
  });

  it("sums free hours up to a point in time", () => {
    const free = freeIntervals(at("2026-09-24T08:00"), at("2026-09-24T16:00"), busy, DAY);
    expect(freeHoursUntil(free, at("2026-09-24T08:00"), at("2026-09-24T12:00"))).toBe(2);
    expect(freeHoursUntil(free, at("2026-09-24T08:00"), at("2026-09-24T07:00"))).toBe(0);
  });
});

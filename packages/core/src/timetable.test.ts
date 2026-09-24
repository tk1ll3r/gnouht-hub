import { describe, expect, it } from "vitest";
import { expandSessions, sessionMinutes, type SessionRule } from "./timetable";

const at = (local: string) => new Date(`${local}:00+07:00`);

const base: SessionRule = {
  id: "s1",
  courseId: "nt219",
  weekday: 2, // Tuesday
  periodStart: 1,
  periodEnd: 3,
  startsOn: "2026-09-07",
  endsOn: "2026-12-27",
};

describe("sessionMinutes", () => {
  it("maps UIT periods to clock times", () => {
    expect(sessionMinutes(base)).toEqual({ start: 450, end: 585 }); // 07:30–09:45
    expect(sessionMinutes({ ...base, periodStart: 6, periodEnd: 10 })).toEqual({ start: 780, end: 1020 }); // 13:00–17:00
  });

  it("prefers explicit times", () => {
    expect(sessionMinutes({ ...base, startTime: "18:00", endTime: "20:30" })).toEqual({ start: 1080, end: 1230 });
  });

  it("rejects incomplete or inverted rules", () => {
    expect(() => sessionMinutes({ ...base, periodStart: null })).toThrow();
    expect(() => sessionMinutes({ ...base, periodStart: 4, periodEnd: 2 })).toThrow();
    expect(() => sessionMinutes({ ...base, periodStart: 1, periodEnd: 14 })).toThrow();
    expect(() => sessionMinutes({ ...base, startTime: "10:00", endTime: "09:00" })).toThrow();
  });
});

describe("expandSessions", () => {
  it("produces the weekly meeting inside the range", () => {
    const occurrences = expandSessions([base], at("2026-09-21T00:00"), at("2026-09-28T00:00"));
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ date: "2026-09-22", courseId: "nt219", kind: "lecture" });
    expect(occurrences[0]!.start.toISOString()).toBe(at("2026-09-22T07:30").toISOString());
    expect(occurrences[0]!.end.toISOString()).toBe(at("2026-09-22T09:45").toISOString());
  });

  it("respects start/end dates inclusively", () => {
    const rule = { ...base, startsOn: "2026-09-22", endsOn: "2026-10-06" };
    const dates = expandSessions([rule], at("2026-09-01T00:00"), at("2026-12-31T00:00")).map((o) => o.date);
    expect(dates).toEqual(["2026-09-22", "2026-09-29", "2026-10-06"]);
  });

  it("keeps the every-other-week cadence even when the range starts mid-semester", () => {
    const rule = { ...base, startsOn: "2026-09-08", weekInterval: 2 };
    const all = expandSessions([rule], at("2026-09-01T00:00"), at("2026-11-01T00:00")).map((o) => o.date);
    expect(all).toEqual(["2026-09-08", "2026-09-22", "2026-10-06", "2026-10-20"]);
    const later = expandSessions([rule], at("2026-10-12T00:00"), at("2026-10-26T00:00")).map((o) => o.date);
    expect(later).toEqual(["2026-10-20"]);
  });

  it("skips holidays and sorts multiple rules chronologically", () => {
    const thursday: SessionRule = { ...base, id: "s2", courseId: "nt101", weekday: 4, periodStart: 6, periodEnd: 8 };
    const occurrences = expandSessions([thursday, base], at("2026-09-21T00:00"), at("2026-10-05T00:00"), {
      skipDates: ["2026-09-29"],
    });
    expect(occurrences.map((o) => `${o.courseId}@${o.date}`)).toEqual(["nt219@2026-09-22", "nt101@2026-09-24", "nt101@2026-10-01"]);
  });

  it("includes a class that is already in progress at the range start", () => {
    const occurrences = expandSessions([base], at("2026-09-22T08:00"), at("2026-09-22T12:00"));
    expect(occurrences.map((o) => o.date)).toEqual(["2026-09-22"]);
  });
});

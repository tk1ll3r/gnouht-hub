import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  daysBetweenKeys,
  formatDuration,
  formatHours,
  isoWeekdayOfKey,
  parseClock,
  parseDateKey,
  zonedDateKey,
  zonedInstant,
  zonedIsoWeekday,
  zonedMinutes,
} from "./time";

describe("parseClock", () => {
  it("parses HH:mm including 24:00", () => {
    expect(parseClock("07:30")).toBe(450);
    expect(parseClock("24:00")).toBe(1440);
  });

  it.each(["7:30", "25:00", "24:01", "12:60", "", "noon"])("rejects %j", (value) => {
    expect(() => parseClock(value)).toThrow();
  });
});

describe("parseDateKey", () => {
  it("rejects impossible calendar dates", () => {
    expect(() => parseDateKey("2026-02-30")).toThrow();
    expect(() => parseDateKey("2026-9-1")).toThrow();
    expect(parseDateKey("2028-02-29")).toEqual([2028, 1, 29]);
  });
});

describe("zoned helpers (Asia/Ho_Chi_Minh, UTC+7)", () => {
  it("builds the instant for a local wall-clock time", () => {
    expect(zonedInstant("2026-09-24", 450).toISOString()).toBe("2026-09-24T00:30:00.000Z");
    expect(zonedInstant("2026-09-24", 1440).toISOString()).toBe("2026-09-24T17:00:00.000Z");
  });

  it("reads the local date, weekday and minutes of an instant", () => {
    const lateEvening = new Date("2026-09-24T23:30:00+07:00");
    const afterMidnight = new Date("2026-09-24T17:30:00Z"); // 00:30 on the 25th in Vietnam
    expect(zonedDateKey(lateEvening)).toBe("2026-09-24");
    expect(zonedDateKey(afterMidnight)).toBe("2026-09-25");
    expect(zonedIsoWeekday(lateEvening)).toBe(4); // Thursday
    expect(zonedMinutes(afterMidnight)).toBe(30);
  });

  it("keeps wall-clock semantics across a DST change in other zones", () => {
    // Berlin jumps from 02:00 to 03:00 on 2026-03-29; 03:00 local is 01:00 UTC.
    expect(zonedInstant("2026-03-29", 180, "Europe/Berlin").toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(zonedInstant("2026-03-28", 180, "Europe/Berlin").toISOString()).toBe("2026-03-28T02:00:00.000Z");
  });
});

describe("date-key arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDaysToKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("computes weekdays and day differences", () => {
    expect(isoWeekdayOfKey("2026-09-24")).toBe(4);
    expect(isoWeekdayOfKey("2026-09-27")).toBe(7);
    expect(daysBetweenKeys("2026-09-01", "2026-10-01")).toBe(30);
  });
});

describe("formatting", () => {
  it("formats durations compactly", () => {
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(90 * 60_000)).toBe("1.5h");
    expect(formatDuration(26 * 3_600_000)).toBe("1d 2h");
    expect(formatDuration(-5)).toBe("0m");
  });

  it("rounds hours for display", () => {
    expect(formatHours(4.44)).toBe("4.4h");
    expect(formatHours(12.5)).toBe("12.5h");
    expect(formatHours(16)).toBe("16h");
    expect(formatHours(143.2)).toBe("143h");
  });
});

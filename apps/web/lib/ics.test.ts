import { describe, expect, it } from "vitest";
import { matchCourse, moodleDeadlines, parseIcs } from "./ics";

const TZ = "Asia/Ho_Chi_Minh";
const at = (local: string) => new Date(`${local}:00+07:00`);
const WINDOW = { from: at("2026-09-20T00:00"), to: at("2026-10-20T00:00") };

const wrap = (body: string) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", body.trim(), "END:VCALENDAR", ""].join("\r\n");

describe("parseIcs", () => {
  it("rejects bodies that are not calendars", () => {
    expect(() => parseIcs("<html>login</html>", WINDOW, TZ)).toThrow(/iCalendar/);
  });

  it("parses timed, all-day, transparent and cancelled events", () => {
    const events = parseIcs(
      wrap(`
BEGIN:VEVENT
UID:timed-1
DTSTAMP:20260901T000000Z
DTSTART:20260924T020000Z
DTEND:20260924T033000Z
SUMMARY:Club meeting
LOCATION:Room B1.12
END:VEVENT
BEGIN:VEVENT
UID:allday-1
DTSTAMP:20260901T000000Z
DTSTART;VALUE=DATE:20260925
DTEND;VALUE=DATE:20260926
SUMMARY:Holiday
END:VEVENT
BEGIN:VEVENT
UID:free-1
DTSTAMP:20260901T000000Z
DTSTART:20260926T020000Z
DTEND:20260926T030000Z
TRANSP:TRANSPARENT
SUMMARY:Optional talk
END:VEVENT
BEGIN:VEVENT
UID:cancelled-1
DTSTAMP:20260901T000000Z
DTSTART:20260927T020000Z
DTEND:20260927T030000Z
STATUS:CANCELLED
SUMMARY:Cancelled
END:VEVENT
BEGIN:VEVENT
UID:outside-1
DTSTAMP:20260901T000000Z
DTSTART:20261201T020000Z
DTEND:20261201T030000Z
SUMMARY:Far away
END:VEVENT`),
      WINDOW,
      TZ,
    );

    expect(events.map((e) => e.uid)).toEqual(["timed-1", "allday-1", "free-1"]);
    const [timed, allDay, free] = events;
    expect(timed).toMatchObject({ title: "Club meeting", location: "Room B1.12", allDay: false, busy: true });
    expect(timed!.start.toISOString()).toBe("2026-09-24T02:00:00.000Z");
    expect(allDay).toMatchObject({ allDay: true, busy: false });
    expect(allDay!.start.toISOString()).toBe(at("2026-09-25T00:00").toISOString());
    expect(allDay!.end.toISOString()).toBe(at("2026-09-26T00:00").toISOString());
    expect(free!.busy).toBe(false);
  });

  it("expands weekly recurrences inside the window, honouring EXDATE", () => {
    const events = parseIcs(
      wrap(`
BEGIN:VEVENT
UID:weekly-1
DTSTAMP:20260901T000000Z
DTSTART:20260901T010000Z
DTEND:20260901T020000Z
RRULE:FREQ=WEEKLY;COUNT=10
EXDATE:20260929T010000Z
SUMMARY:Study group
END:VEVENT`),
      WINDOW,
      TZ,
    );
    expect(events.map((e) => e.start.toISOString())).toEqual([
      "2026-09-22T01:00:00.000Z",
      "2026-10-06T01:00:00.000Z",
      "2026-10-13T01:00:00.000Z",
    ]);
    expect(new Set(events.map((e) => e.uid)).size).toBe(3);
  });
});

describe("moodleDeadlines", () => {
  const events = parseIcs(
    wrap(`
BEGIN:VEVENT
UID:101@courses.uit.edu.vn
DTSTAMP:20260901T000000Z
DTSTART:20260925T165900Z
DTEND:20260925T165900Z
SUMMARY:Lab 3 is due
CATEGORIES:NT219.Q11.ANTT
END:VEVENT
BEGIN:VEVENT
UID:102@courses.uit.edu.vn
DTSTAMP:20260901T000000Z
DTSTART:20260926T010000Z
DTEND:20260926T010000Z
SUMMARY:Quiz 2 opens
CATEGORIES:NT101.Q12
END:VEVENT
BEGIN:VEVENT
UID:103@courses.uit.edu.vn
DTSTAMP:20260901T000000Z
DTSTART:20260927T010000Z
DTEND:20260927T010000Z
SUMMARY:Quiz 2 closes
CATEGORIES:NT101.Q12
END:VEVENT`),
    WINDOW,
    TZ,
  );

  it("keeps due/close events, strips the suffix and infers the kind", () => {
    const deadlines = moodleDeadlines(events);
    expect(deadlines.map((d) => [d.key, d.title, d.kind, d.courseHint])).toEqual([
      ["101@courses.uit.edu.vn", "Lab 3", "assignment", "NT219.Q11.ANTT"],
      ["103@courses.uit.edu.vn", "Quiz 2", "quiz", "NT101.Q12"],
    ]);
    expect(deadlines[0]!.dueAt.toISOString()).toBe("2026-09-25T16:59:00.000Z");
  });
});

describe("matchCourse", () => {
  const courses = [
    { id: "a", code: "NT219", class_code: "NT219.Q11" },
    { id: "b", code: "NT101", class_code: null },
    { id: "c", code: "NT2", class_code: null },
  ];

  it("prefers the longest class-code prefix", () => {
    expect(matchCourse("NT219.Q11.ANTT", courses)?.id).toBe("a");
    expect(matchCourse("nt101.q12", courses)?.id).toBe("b");
    expect(matchCourse("CS101", courses)).toBeNull();
    expect(matchCourse(null, courses)).toBeNull();
  });
});

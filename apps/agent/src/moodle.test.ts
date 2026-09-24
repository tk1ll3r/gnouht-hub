import { uitPayloadSchema } from "@hub/core/protocol";
import { describe, expect, it } from "vitest";
import { currentCourses, fetchMoodleToken, mapCourse, mapEvent, MoodleClient, MoodleError } from "./moodle";

const BASE = "https://courses.uit.edu.vn";
const now = new Date("2026-09-25T03:00:00Z");
const t = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe("mapCourse", () => {
  it("splits UIT short names into code and class", () => {
    expect(mapCourse({ id: 12, shortname: "NT219.Q11.ANTT", fullname: "Mật mã học - NT219.Q11.ANTT" }, BASE)).toEqual({
      moodleCourseId: 12,
      code: "NT219",
      classCode: "NT219.Q11",
      name: "Mật mã học",
      url: "https://courses.uit.edu.vn/course/view.php?id=12",
    });
    expect(mapCourse({ id: 13, shortname: "SS004", fullname: "Kỹ năng nghề nghiệp" }, BASE)?.classCode).toBeNull();
    expect(mapCourse({ id: 14, shortname: "Thông báo chung", fullname: "News" }, BASE)).toBeNull();
  });
});

describe("currentCourses", () => {
  it("keeps courses of the running semester", () => {
    const courses = [
      { id: 1, shortname: "A", fullname: "now", startdate: t("2026-09-07"), enddate: t("2026-12-27") },
      { id: 2, shortname: "B", fullname: "old", startdate: t("2026-02-01"), enddate: t("2026-06-30") },
      { id: 3, shortname: "C", fullname: "future", startdate: t("2027-02-01"), enddate: 0 },
      { id: 4, shortname: "D", fullname: "hidden", startdate: t("2026-09-07"), visible: 0 },
      { id: 5, shortname: "E", fullname: "open-ended", startdate: t("2026-09-01"), enddate: 0 },
    ];
    expect(currentCourses(courses, now).map((c) => c.id)).toEqual([1, 5]);
  });
});

describe("mapEvent", () => {
  it("turns action events into deadlines", () => {
    expect(mapEvent({ id: 7, name: "Lab 3 is due", timesort: t("2026-09-26T16:59:00Z"), course: { id: 12 }, modulename: "assign", url: "https://courses.uit.edu.vn/mod/assign/view.php?id=9" })).toEqual({
      eventId: 7,
      moodleCourseId: 12,
      title: "Lab 3",
      dueAt: "2026-09-26T16:59:00.000Z",
      url: "https://courses.uit.edu.vn/mod/assign/view.php?id=9",
      kind: "assignment",
    });
    expect(mapEvent({ id: 8, name: "Quiz 1 closes", timesort: t("2026-09-27"), modulename: "quiz", url: "javascript:alert(1)" })).toMatchObject({ kind: "quiz", url: null, moodleCourseId: null });
  });
});

describe("fetchMoodleToken", () => {
  it("returns a token and never keeps the password", async () => {
    let body = "";
    const fake: typeof fetch = async (_url, init) => {
      body = String(init?.body);
      return Response.json({ token: "0123456789abcdef0123456789abcdef" });
    };
    expect(await fetchMoodleToken(BASE, "25520957", "pw", fake)).toBe("0123456789abcdef0123456789abcdef");
    expect(body).toContain("service=moodle_mobile_app");
  });

  it("explains when mobile web services are disabled", async () => {
    const fake: typeof fetch = async () => Response.json({ error: "disabled", errorcode: "enablewsdescription" });
    await expect(fetchMoodleToken(BASE, "u", "p", fake)).rejects.toThrow(/iCal export/);
  });

  it("surfaces wrong credentials", async () => {
    const fake: typeof fetch = async () => Response.json({ error: "Invalid login, please try again", errorcode: "invalidlogin" });
    await expect(fetchMoodleToken(BASE, "u", "p", fake)).rejects.toBeInstanceOf(MoodleError);
  });
});

describe("MoodleClient.collect", () => {
  it("builds a schema-valid UIT payload", async () => {
    const fake: typeof fetch = async (_url, init) => {
      const fn = new URLSearchParams(String(init?.body)).get("wsfunction");
      if (fn === "core_webservice_get_site_info") return Response.json({ userid: 99 });
      if (fn === "core_enrol_get_users_courses") {
        return Response.json([{ id: 12, shortname: "NT219.Q11.ANTT", fullname: "Mật mã học - NT219.Q11.ANTT", startdate: t("2026-09-07"), enddate: t("2026-12-27") }]);
      }
      if (fn === "core_calendar_get_action_events_by_timesort") {
        return Response.json({ events: [{ id: 7, name: "Lab 3 is due", timesort: t("2026-09-26T16:59:00Z"), course: { id: 12 }, modulename: "assign" }] });
      }
      return Response.json({ exception: "x", message: "unknown function" });
    };
    const payload = await new MoodleClient(BASE, "token", fake).collect(now);
    expect(uitPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.courses).toHaveLength(1);
    expect(payload.deadlines[0]).toMatchObject({ title: "Lab 3", moodleCourseId: 12 });
  });

  it("throws Moodle exceptions as errors", async () => {
    const fake: typeof fetch = async () => Response.json({ exception: "moodle_exception", message: "Invalid token", errorcode: "invalidtoken" });
    await expect(new MoodleClient(BASE, "bad", fake).collect(now)).rejects.toThrow("Invalid token");
  });
});

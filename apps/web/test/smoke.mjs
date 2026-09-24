#!/usr/bin/env node
// End-to-end smoke test against a running `next dev` + local Supabase:
// closed registration, magic-link sign-in via Mailpit, authenticated pages, cron auth.
// Usage: node apps/web/test/smoke.mjs   (reads apps/web/.env.local; prints no secrets)
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(here, "../.env.local"), "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const APP = process.env.SMOKE_APP_URL ?? "http://localhost:3000";
const MAILPIT = process.env.SMOKE_MAILPIT_URL ?? "http://127.0.0.1:54324";
const OWNER = "owner@example.com";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

// 1. Closed registration
const stranger = await anon.auth.signInWithOtp({ email: `stranger-${Date.now()}@example.com` });
check(Boolean(stranger.error), "uninvited email is refused by the before-user-created hook", stranger.error?.message);

// 2. Magic link for the allow-listed owner, delivered to Mailpit
await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
const otp = await anon.auth.signInWithOtp({ email: OWNER, options: { emailRedirectTo: `${APP}/auth/callback` } });
check(!otp.error, "allow-listed email gets a magic link", otp.error?.message);

let link = null;
for (let i = 0; i < 20 && !link; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const list = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
  const message = list.messages?.find((m) => m.To?.some((t) => t.Address === OWNER));
  if (message) {
    const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
    link = /href="([^"]*\/auth\/confirm\?[^"]+)"/.exec(full.HTML ?? "")?.[1]?.replace(/&amp;/g, "&") ?? null;
  }
}
check(Boolean(link), "email uses the custom template linking to /auth/confirm");
if (!link) process.exit(1);

// 3. Follow the link manually to capture the session cookies
const confirm = await fetch(link, { redirect: "manual" });
const cookies = confirm.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
check(confirm.status === 303 && confirm.headers.get("location")?.endsWith("/today"), "confirm link signs in and redirects to /today", `${confirm.status} ${confirm.headers.get("location")}`);
check(cookies.includes("auth-token"), "session cookie is set");

const get = (path) => fetch(`${APP}${path}`, { headers: { cookie: cookies }, redirect: "manual" });

// 4. Seed a realistic workspace for the owner (service role, scoped by user id)
const { data: users } = await admin.auth.admin.listUsers();
const ownerId = users.users.find((u) => u.email === OWNER)?.id;
check(Boolean(ownerId), "owner user exists");
await admin.from("semesters").delete().eq("user_id", ownerId);
await admin.from("tasks").delete().eq("user_id", ownerId);
const { data: semester } = await admin
  .from("semesters")
  .insert({ user_id: ownerId, name: "HK1 2026–2027", starts_on: "2026-09-07", ends_on: "2026-12-27", is_current: true })
  .select()
  .single();
const { data: course } = await admin
  .from("courses")
  .insert({ user_id: ownerId, semester_id: semester.id, code: "NT219", class_code: "NT219.Q11", name: "Mật mã học", color: "#7c3aed", weight: 1.5 })
  .select()
  .single();
// ISO weekday of "today" in the owner's time zone (Asia/Ho_Chi_Minh, UTC+7), not UTC.
const weekday = ((new Date(Date.now() + 7 * 3_600_000).getUTCDay() + 6) % 7) + 1;
await admin.from("course_sessions").insert({ user_id: ownerId, course_id: course.id, weekday, period_start: 1, period_end: 3, room: "B1.12" });
const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
await admin.from("tasks").insert([
  { user_id: ownerId, course_id: course.id, title: "Lab 3: AES modes", kind: "assignment", due_at: hours(20), estimate_hours: 3 },
  { user_id: ownerId, title: "Báo cáo tiến độ GVHD", kind: "report", due_at: hours(60), estimate_hours: 6 },
  { user_id: ownerId, title: "Đọc paper FedLC", kind: "task", due_at: hours(24 * 12), estimate_hours: 2 },
  { user_id: ownerId, title: "Overdue quiz review", kind: "quiz", due_at: hours(-30) },
  { user_id: ownerId, title: "Dọn repo CTF", kind: "task" },
]);

// Projects: one agent-style project with an ingested document (as the agent endpoint would store it).
await admin.from("projects").delete().eq("user_id", ownerId);
const { data: project } = await admin
  .from("projects")
  .insert({ user_id: ownerId, name: "Đồ án IDS", source: "agent", folder_key: "a".repeat(64), folder_label: "…/Research/IDS", course_id: course.id })
  .select()
  .single();
const docMarkdown = [
  "# Tiến độ đồ án",
  "",
  "- [x] Chọn đề tài",
  "- [!] Hỏi thầy về dữ liệu",
  "",
  "<script>alert('xss')</script> [click](javascript:alert(1)) ![remote](https://tracker.example/p.png)",
].join("\n");
const { data: docId } = await admin.rpc("ingest_document", {
  p_project: project.id,
  p_document: { path: "tien-do.md", kind: "markdown", title: "Tiến độ đồ án", hash: "b".repeat(64), content: docMarkdown, stats: { total: 2, done: 1, attention: 1 } },
  p_chunks: [{ ord: 0, heading: "Tiến độ đồ án", content: "Hỏi thầy về dữ liệu trước hạn nộp abstract", line: 1 }],
  p_items: [
    { key: "0000000000000001", text: "Chọn đề tài", status: "done", line: 3 },
    { key: "0000000000000002", text: "Hỏi thầy về dữ liệu", status: "attention", line: 4 },
  ],
  p_deadlines: [{ key: "m1", title: "Nộp abstract", kind: "milestone", dueAt: hours(96), ref: { path: "tien-do.md", line: 9, hard: true } }],
});
await admin.rpc("refresh_project_stats", { p_project: project.id });
check(Boolean(docId), "a document can be ingested for the owner's project");

// 5. Authenticated pages render
for (const path of [
  "/today",
  "/courses",
  `/courses/${course.id}`,
  "/tasks",
  "/calendar",
  "/quota",
  "/settings",
  "/projects",
  `/projects/${project.id}`,
  `/projects/${project.id}/docs/${docId}`,
  "/docs?q=hoi+thay",
]) {
  const res = await get(path);
  const html = await res.text();
  check(res.status === 200, `GET ${path}`, String(res.status));
  if (path === "/today") {
    check(html.includes("Lab 3: AES modes") && html.includes("Overdue"), "Today ranks the seeded deadlines");
    check(html.includes("NT219 · Mật mã học"), "Today agenda shows today's class");
    const csp = res.headers.get("content-security-policy") ?? "";
    check(/script-src 'self' 'nonce-/.test(csp) && csp.includes("frame-ancestors 'none'"), "strict nonce CSP header present");
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
    check(scripts.length > 0 && scripts.every((attrs) => attrs.includes(`nonce="${nonce}"`)), "every <script> carries the request nonce", `${scripts.length} scripts`);
    check(!/\sstyle="/.test(html), "no inline style attributes in the HTML");
  }
  if (path === "/projects") check(html.includes("Đồ án IDS") && html.includes("1/2 items"), "Projects lists progress from checklists");
  if (path === `/projects/${project.id}`) {
    check(html.includes("Nộp abstract") && html.includes("hard deadline") && html.includes("Hỏi thầy về dữ liệu"), "project page shows milestones and attention items");
  }
  if (path.includes("/docs/")) {
    check(!html.includes("<script>alert") && !html.includes('href="javascript:'), "document view drops raw HTML and javascript: links");
    check(!html.includes("tracker.example/p.png\""), "document view does not load remote images");
  }
  if (path.startsWith("/docs?")) check(/<mark[^>]*>Hỏi<\/mark>/.test(html) && html.includes("Tiến độ đồ án"), "search finds accent-insensitive matches and highlights them");
}

// 6. Another user's course is a 404, not a leak
const { data: other } = await admin.auth.admin.createUser({ email: `other-${Date.now()}@example.com`, email_confirm: true });
if (other?.user) {
  const { data: sem } = await admin.from("semesters").insert({ user_id: other.user.id, name: "x", starts_on: "2026-09-07", ends_on: "2026-12-27" }).select().single();
  const { data: foreign } = await admin.from("courses").insert({ user_id: other.user.id, semester_id: sem.id, code: "XX100", name: "Secret" }).select().single();
  const res = await get(`/courses/${foreign.id}`);
  const html = await res.text();
  check(res.status === 404 && !html.includes("Secret"), "someone else's course returns 404", String(res.status));
  const { data: foreignProject } = await admin.from("projects").insert({ user_id: other.user.id, name: "Hidden project" }).select().single();
  const projectRes = await get(`/projects/${foreignProject.id}`);
  check(projectRes.status === 404 && !(await projectRes.text()).includes("Hidden project"), "someone else's project returns 404", String(projectRes.status));
  await admin.auth.admin.deleteUser(other.user.id);
}

// 7. Protected routes and cron auth
const anonToday = await fetch(`${APP}/today`, { redirect: "manual" });
check(anonToday.status === 307 && anonToday.headers.get("location")?.includes("/login"), "signed-out visitors are sent to /login");
const evil = await fetch(`${APP}/auth/confirm?token_hash=x&type=email&next=//evil.example`, { redirect: "manual" });
check(!evil.headers.get("location")?.includes("evil.example"), "open redirect via next= is blocked");
const cronNoAuth = await fetch(`${APP}/api/cron/sync-calendars`, { method: "POST" });
check(cronNoAuth.status === 401, "cron endpoint rejects missing secret", String(cronNoAuth.status));
const cronBad = await fetch(`${APP}/api/cron/sync-calendars`, { method: "POST", headers: { authorization: "Bearer wrong" } });
check(cronBad.status === 401, "cron endpoint rejects wrong secret");
const cronOk = await fetch(`${APP}/api/cron/daily-brief`, { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
const brief = await cronOk.json().catch(() => ({}));
check(cronOk.status === 200 && brief.stored >= 1, "daily brief cron stores briefs", JSON.stringify(brief));

console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);

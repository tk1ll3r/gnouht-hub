#!/usr/bin/env node
// End-to-end smoke test against a running `next dev` + local Supabase:
// closed registration, magic-link sign-in via Mailpit, authenticated pages, cron auth.
// Usage: node apps/web/test/smoke.mjs   (reads apps/web/.env.local; prints no secrets)
import { createHash, createHmac, randomBytes } from "node:crypto";
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

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret, like an authenticator app. */
function totp(secret, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const offset = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

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

// AI results as the agent would leave them (the agent e2e covers the round trip itself).
await admin.from("ai_jobs").delete().eq("user_id", ownerId);
await admin.from("profiles").update({ ai_consent_at: new Date().toISOString(), ai_daily_tokens: 150000 }).eq("id", ownerId);
const aiBase = { user_id: ownerId, status: "done", messages: [], max_output_tokens: 800, reserved_tokens: 900, used_tokens: 420, expires_at: hours(1), finished_at: new Date().toISOString(), model: "cc/fake" };
const { data: askJob } = await admin
  .from("ai_jobs")
  .insert({
    ...aiBase,
    kind: "ask_docs",
    question: "Khi nào hỏi thầy về dữ liệu?",
    output: "Cần hỏi thầy trước hạn nộp abstract [1]. [Bấm vào đây](https://evil.example/steal) ![x](https://evil.example/pixel.png)",
    sources: [{ n: 1, chunkId: 1, documentId: docId, projectId: project.id, title: "Tiến độ đồ án", path: "tien-do.md", line: 1 }],
  })
  .select("id")
  .single();
await admin.from("ai_jobs").insert({ ...aiBase, kind: "project_summary", subject_id: project.id, output: "**Status** Đang đúng tiến độ." });
const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
await admin.from("briefs").upsert({ user_id: ownerId, for_date: todayVn, kind: "ai", headline: "Hôm nay làm Lab 3 trước.", markdown: "Hôm nay làm Lab 3 trước." }, { onConflict: "user_id,for_date,kind" });

// Groups: the owner and a friend share free/busy; the friend shares a project with the owner.
await admin.from("groups").delete().eq("created_by", ownerId);
const friendEmail = "friend@example.com";
let friendId = (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === friendEmail)?.id;
if (!friendId) friendId = (await admin.auth.admin.createUser({ email: friendEmail, email_confirm: true })).data.user.id;
await admin.from("profiles").update({ display_name: "Bạn Học" }).eq("id", friendId);
const { data: group } = await admin.from("groups").insert({ name: "Nhóm NT219", created_by: ownerId }).select().single();
await admin.from("group_members").insert([
  { group_id: group.id, user_id: ownerId, role: "owner", share_busy: true },
  { group_id: group.id, user_id: friendId, role: "member", share_busy: true },
]);
await admin.from("projects").delete().eq("user_id", friendId);
const { data: friendProject } = await admin.from("projects").insert({ user_id: friendId, name: "Friend's lab report", items_total: 4, items_done: 3 }).select().single();
await admin.from("tasks").insert({ user_id: friendId, project_id: friendProject.id, title: "Nộp lab chung", kind: "milestone", due_at: hours(50) });
await admin.from("tasks").insert({ user_id: friendId, title: "Friend's private errand", due_at: hours(10) });
await admin.from("project_shares").insert({ project_id: friendProject.id, group_id: group.id, shared_by: friendId });
const inviteToken = randomBytes(24).toString("base64url");
const invitee = `newbie-${Date.now()}@example.com`;
await admin.from("group_invites").insert({
  group_id: group.id,
  email: invitee,
  token_hash: createHash("sha256").update(inviteToken).digest("hex"),
  invited_by: ownerId,
  expires_at: hours(48),
});
const { error: invitedSignup } = await anon.auth.signInWithOtp({ email: invitee });
check(!invitedSignup, "an address with a pending group invite may register", invitedSignup?.message);
const { data: foreignGroup } = await admin.from("groups").insert({ name: "Not my group" }).select().single();

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
  `/docs/ask/${askJob.id}`,
  "/groups",
  `/groups/${group.id}`,
  `/projects/${friendProject.id}`,
]) {
  const res = await get(path);
  const html = await res.text();
  check(res.status === 200, `GET ${path}`, String(res.status));
  if (path === "/today") {
    check(html.includes("Lab 3: AES modes") && html.includes("Overdue"), "Today ranks the seeded deadlines");
    check(html.includes("Mật mã học") && html.includes("B1.12"), "Today agenda shows today's class");
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
  if (path === "/groups") check(html.includes("Nhóm NT219") && html.includes("2 members"), "Groups lists memberships");
  if (path === `/groups/${group.id}`) {
    check(html.includes("Bạn Học") && html.includes("Nộp lab chung") && html.includes("Friend&#x27;s lab report"), "group page shows roster, team deadlines and shared projects");
    check(html.includes("How many of 2 members are free"), "group page shows the free-time grid for opted-in members");
    check(!html.includes("private errand"), "group page never shows members' personal tasks");
    check(html.includes(invitee), "owners see pending invites");
  }
  if (path === `/projects/${friendProject.id}`) check(/read-only/i.test(html) && !html.includes("Save project"), "a shared project opens read-only for members");
  if (path === "/today") check(html.includes("Morning note") && html.includes("Hôm nay làm Lab 3 trước."), "Today shows the AI morning note");
  if (path === `/projects/${project.id}`) check(html.includes("AI summary") && html.includes("Đang đúng tiến độ."), "project page shows the latest AI summary");
  if (path === "/settings") check(html.includes("AI assistant") && html.includes("840 of 150,000 tokens"), "Settings shows AI usage against the budget");
  if (path.startsWith("/docs/ask/")) {
    check(html.includes(`href="/projects/${project.id}/docs/${docId}"`) && html.includes("[<!-- -->1<!-- -->]"), "AI answers link citations to the cited document");
    check(!html.includes('href="https://evil.example') && !/<img[^>]+evil\.example/.test(html), "links and images in AI output are never live");
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
  const { data: foreignJob } = await admin
    .from("ai_jobs")
    .insert({ user_id: other.user.id, kind: "ask_docs", status: "done", question: "secret question", output: "secret answer", messages: [], max_output_tokens: 100, reserved_tokens: 100, expires_at: hours(1) })
    .select("id")
    .single();
  check((await get(`/api/ai/jobs/${foreignJob.id}`)).status === 404, "someone else's AI job is not visible");
  const foreignAnswer = await get(`/docs/ask/${foreignJob.id}`);
  check(foreignAnswer.status === 404 && !(await foreignAnswer.text()).includes("secret answer"), "someone else's AI answer page is a 404");
  const groupRes = await get(`/groups/${foreignGroup.id}`);
  check(groupRes.status === 404 && !(await groupRes.text()).includes("Not my group"), "a group you are not in returns 404", String(groupRes.status));
  const projectRes = await get(`/projects/${foreignProject.id}`);
  check(projectRes.status === 404 && !(await projectRes.text()).includes("Hidden project"), "someone else's project returns 404", String(projectRes.status));
  await admin.auth.admin.deleteUser(other.user.id);
}

// AI job status route: owner only.
const jobStatus = await get(`/api/ai/jobs/${askJob.id}`);
check(jobStatus.status === 200 && (await jobStatus.json()).status === "done", "owners can poll their AI job");
check((await fetch(`${APP}/api/ai/jobs/${askJob.id}`)).status === 401, "the AI job route needs a session");

// Invite landing page: public, but only the invited address can accept.
const inviteAnon = await fetch(`${APP}/invite/${inviteToken}`);
const inviteAnonHtml = await inviteAnon.text();
check(inviteAnon.status === 200 && inviteAnonHtml.includes("Sign in to accept") && inviteAnonHtml.includes("ne…@example.com") && !inviteAnonHtml.includes(invitee),
  "the invite page works signed out and masks the invited address");
const inviteOther = await (await get(`/invite/${inviteToken}`)).text();
check(inviteOther.includes("but this invite is for") && !inviteOther.includes("Join the group"), "someone signed in with another address cannot accept");
const inviteBogus = await (await fetch(`${APP}/invite/${"x".repeat(32)}`)).text();
check(inviteBogus.includes("no longer valid"), "unknown invite tokens are rejected");
await admin.from("groups").delete().in("id", [group.id, foreignGroup.id]);

// 8. Two-step sign-in, checked through the real Auth + PostgREST and the hub's own form (submitted
// without JavaScript, as a browser would).
{
  const session = async () => {
    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: friendEmail });
    await client.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
    return client;
  };
  // A tiny cookie jar per simulated browser.
  const browser = () => {
    const jar = new Map();
    const header = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const absorb = (res) => {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        if (/max-age=0/i.test(c) || i === pair.length - 1) jar.delete(pair.slice(0, i));
        else jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      return res;
    };
    const get = async (path) => absorb(await fetch(`${APP}${path}`, { headers: { cookie: header() }, redirect: "manual" }));
    const signIn = async () => {
      const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: friendEmail });
      await get(`/auth/confirm?token_hash=${link.properties.hashed_token}&type=magiclink`);
    };
    const unescapeHtml = (v) => v.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    // Submits the code form the way a browser without JavaScript does (React's hidden action fields included).
    const submitCode = async (code, next = "/projects") => {
      const path = `/login/mfa?next=${encodeURIComponent(next)}`;
      const html = await (await get(path)).text();
      const form = [...html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]).find((f) => f.includes('name="code"'));
      if (!form) return { status: 0, location: null, html: "" };
      const body = new FormData();
      for (const [input] of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
        const name = /name="([^"]*)"/.exec(input)?.[1];
        if (name) body.append(unescapeHtml(name), unescapeHtml(/value="([^"]*)"/.exec(input)?.[1] ?? ""));
      }
      body.set("code", code);
      const res = absorb(await fetch(`${APP}${path}`, { method: "POST", body, headers: { cookie: header(), origin: APP }, redirect: "manual" }));
      return { status: res.status, location: res.headers.get("location"), html: await res.text() };
    };
    return { jar, get, signIn, submitCode };
  };

  // Reruns within the limiter windows start clean.
  await admin.from("rate_limits").delete().or(`bucket.eq.mfa:${friendId},bucket.like.export:*`);
  await admin.from("tasks").insert({ user_id: friendId, title: "Friend MFA canary" });
  const first = await session();
  const { data: enrolled } = await first.auth.mfa.enroll({ factorType: "totp" });
  const code = (offset = 0) => totp(enrolled.totp.secret, Date.now() + offset);
  const { error: verifyError } = await first.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code: code() });
  check(!verifyError, "a TOTP factor can be enrolled and verified", verifyError?.message);
  try {
    const direct = (await first.from("tasks").select("title").eq("title", "Friend MFA canary")).data ?? [];
    check(direct.length === 0, "an aal2 session whose code skipped the hub's rate-limited form reads nothing");
    const second = await session();
    check(((await second.from("tasks").select("title")).data ?? []).length === 0, "a first-factor (aal1) session of an enrolled user reads nothing, even through the API");

    const laptop = browser();
    await laptop.signIn();
    const gated = await laptop.get("/today");
    check(gated.status === 307 && gated.headers.get("location")?.includes("/login/mfa"), "pages send an enrolled user to the code step", `${gated.status} ${gated.headers.get("location")}`);
    const wrong = await laptop.submitCode(code() === "123456" ? "654321" : "123456");
    check(wrong.status === 200 && wrong.html.includes("not right"), "the code form rejects a wrong code");
    const right = await laptop.submitCode(code());
    check(right.status === 303 && right.location === "/projects", "the right code finishes sign-in and returns to the requested page", `${right.status} ${right.location}`);
    const exportAfter = await laptop.get("/api/me/export");
    const rows = await exportAfter.json().catch(() => ({}));
    check(exportAfter.status === 200 && rows.tasks?.some((t) => t.title === "Friend MFA canary"), "the session confirmed through the hub reads the user's data");

    const guesser = browser();
    await guesser.signIn();
    let limited = false;
    for (let i = 0; i < 8 && !limited; i++) limited = (await guesser.submitCode("000000")).html.includes("Too many attempts");
    check(limited, "the code form allows at most 8 tries per 10 minutes per account");

    // The confirmed browser's own access token, used straight against the API.
    const stored = [...laptop.jar].filter(([k]) => /^sb-.*-auth-token(\.\d+)?$/.test(k)).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v).join("");
    const accessToken = JSON.parse(Buffer.from(stored.replace(/^base64-/, ""), "base64url").toString()).access_token;
    const tokenClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const canary = () => tokenClient.from("tasks").select("title").eq("title", "Friend MFA canary");
    check(((await canary()).data ?? []).length === 1, "the confirmed session's token reads the data through the API");

    // "Sign out everywhere" from another device. (A fresh session: Auth already ended the older aal1
    // ones when the code was verified.)
    const phone = await session();
    const { error: signOutError } = await phone.auth.signOut({ scope: "global" });
    const ended = await laptop.get("/today");
    const cleared = ended.headers.get("location") === "/auth/ended" ? await laptop.get("/auth/ended") : null;
    check(!signOutError && cleared?.headers.get("location")?.endsWith("/login?ended=1") && ![...laptop.jar.keys()].some((k) => k.startsWith("sb-")),
      "after sign-out everywhere another browser loses access at once and its cookies are cleared", `${ended.status} ${ended.headers.get("location")} ${signOutError?.message ?? ""}`);
    check(((await canary()).data ?? []).length === 0, "and its unexpired access token reads nothing through the API");
  } finally {
    await admin.auth.admin.mfa.deleteFactor({ id: enrolled.id, userId: friendId });
    await admin.from("tasks").delete().eq("user_id", friendId).eq("title", "Friend MFA canary");
    await admin.from("rate_limits").delete().eq("bucket", `mfa:${friendId}`);
  }
}

// Account endpoints
check((await fetch(`${APP}/api/me/export`)).status === 401, "data export needs a session");
const exportRes = await get("/api/me/export");
const exported = await exportRes.json().catch(() => ({}));
check(exportRes.status === 200 && Array.isArray(exported.tasks) && exported.tasks.some((t) => t.title === "Lab 3: AES modes") && !JSON.stringify(exported).includes("secret_ciphertext"),
  "data export returns the owner's rows and no secrets");
const securityTxt = await fetch(`${APP}/.well-known/security.txt`);
check(securityTxt.status === 200 && (await securityTxt.text()).includes("Contact: mailto:"), "security.txt is published");
const mfaPage = await fetch(`${APP}/login/mfa`, { redirect: "manual" });
check(mfaPage.status === 307 || mfaPage.status === 303 || mfaPage.headers.get("location")?.includes("/login"), "the MFA step needs a first-factor session", String(mfaPage.status));

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

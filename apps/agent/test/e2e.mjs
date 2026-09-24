#!/usr/bin/env node
// Agent end-to-end against the running dev server: pairing, signed heartbeat + quota push from a fake
// 9router, replay/tamper rejection, revocation. Uses a temp config dir and cleans up the Credential
// Manager entries it creates. Usage: node apps/agent/test/e2e.mjs (after `npm run build -w @hub/agent`)
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

// Independent implementation of the signing scheme in packages/core/src/protocol.ts (so this test also
// checks the documented canonical form): METHOD\npath\ntimestamp\nnonce\nsha256(body), HMAC-SHA256.
function signedHeaders(deviceId, secret, method, path, body) {
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("base64url");
  const canonical = [method, path, timestamp, nonce, createHash("sha256").update(body).digest("hex")].join("\n");
  const signature = createHmac("sha256", Buffer.from(secret, "base64url")).update(canonical).digest("hex");
  return { "x-hub-device": deviceId, "x-hub-timestamp": timestamp, "x-hub-nonce": nonce, "x-hub-signature": signature };
}

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(here, "../../web/.env.local"), "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const APP = "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const home = mkdtempSync(join(tmpdir(), "hub-agent-e2e-"));
const agent = resolve(here, "../dist/hub-agent.mjs");
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
// Async spawn: the fake 9router below lives in this process and must keep serving while the agent runs.
const run = (...args) =>
  new Promise((resolveRun) => {
    const child = spawn(process.execPath, [agent, ...args], { env: { ...process.env, HUB_AGENT_HOME: home } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });

// Fake 9router with one Claude account.
const fake = createServer((req, res) => {
  const json = (status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  if (req.url === "/api/health") return json(200, { ok: true });
  if (req.url === "/api/auth/login") return json(200, {}, { "set-cookie": "auth_token=fake; Path=/; HttpOnly" });
  if (req.headers.cookie !== "auth_token=fake") return json(401, {});
  if (req.url === "/api/providers") return json(200, { connections: [{ id: "conn-claude", provider: "claude", email: "tester@gmail.com", isActive: true }] });
  if (req.url === "/api/usage/conn-claude") {
    return json(200, { plan: "Claude Code", quotas: { "Session (5h)": { remainingPercentage: 18, resetAt: new Date(Date.now() + 2 * 3600e3).toISOString() }, "Weekly (7d)": { remainingPercentage: 72 } } });
  }
  if (req.url?.startsWith("/api/usage/stats")) return json(200, { byModel: { "claude-opus|claude": { rawModel: "claude-opus", provider: "claude", requests: 4, promptTokens: 12000, completionTokens: 3000, cost: 0.4 } } });
  return json(404, {});
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const fakeUrl = `http://127.0.0.1:${fake.address().port}`;

try {
  const { data: users } = await admin.auth.admin.listUsers();
  const ownerId = users.users.find((u) => u.email === "owner@example.com")?.id;
  check(Boolean(ownerId), "owner exists (run the web smoke test first)");

  // A pairing code as Settings would create it.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
  await admin.from("device_pairing_codes").insert({ code_hash: createHash("sha256").update(code).digest("hex"), user_id: ownerId, expires_at: new Date(Date.now() + 600e3).toISOString() });

  const pair = await run("pair", "--hub", APP, "--name", "E2E PC", "--code", `${code.slice(0, 4)}-${code.slice(4)}`);
  check(pair.status === 0, "agent pairs with a one-time code", pair.stderr.trim() || pair.stdout.trim());
  const reuse = await run("pair", "--hub", APP, "--name", "E2E PC 2", "--code", code);
  check(reuse.status !== 0 && /invalid or expired/.test(reuse.stderr), "the same code cannot be used twice");

  const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  check(!JSON.stringify(config).match(/secret/i) && Boolean(config.deviceId), "config file holds no secret");
  writeFileSync(join(home, "config.json"), JSON.stringify({ ...config, ninerouterUrl: fakeUrl }));
  const { Entry } = await import("@napi-rs/keyring");
  new Entry("gnouht-hub-agent", "9router-password").setPassword("fake-password");

  const status = await run("status");
  check(status.status === 0 && /heartbeat ok/.test(status.stdout), "status sends a signed heartbeat", status.stderr.trim());
  const push = await run("push-quota");
  check(push.status === 0 && /Pushed 2 quota windows and 1 usage rows/.test(push.stdout), "quota is pushed from 9router", push.stdout.trim() || push.stderr.trim());

  const { data: snapshots } = await admin.from("quota_snapshots").select("window_label, remaining_pct, account_label").eq("device_id", config.deviceId);
  check(snapshots?.length === 2 && snapshots.every((s) => s.account_label === "te…@gmail.com"), "snapshots stored with masked account label");

  // Replay and tampering, using the device secret straight from the Credential Manager.
  const secret = new Entry("gnouht-hub-agent", "device-secret").getPassword();
  const body = JSON.stringify({ agentVersion: "0.1.0", ninerouter: { reachable: true, loggedIn: true } });
  const headers = { "content-type": "application/json", ...signedHeaders(config.deviceId, secret, "POST", "/api/agent/heartbeat", body) };
  const first = await fetch(`${APP}/api/agent/heartbeat`, { method: "POST", headers, body });
  const replay = await fetch(`${APP}/api/agent/heartbeat`, { method: "POST", headers, body });
  check(first.status === 200 && replay.status === 401, "an identical (replayed) request is rejected", `${first.status}/${replay.status}`);
  const tampered = { ...headers, ...signedHeaders(config.deviceId, secret, "POST", "/api/agent/heartbeat", body) };
  const tamper = await fetch(`${APP}/api/agent/heartbeat`, { method: "POST", headers: tampered, body: body.replace("true", "false") });
  check(tamper.status === 401, "a modified body is rejected");
  const forged = await fetch(`${APP}/api/agent/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...signedHeaders(config.deviceId, "A".repeat(43), "POST", "/api/agent/heartbeat", body) },
    body,
  });
  check(forged.status === 401, "a wrong secret is rejected");
  const bad = await fetch(`${APP}/api/agent/quota`, {
    method: "POST",
    headers: { "content-type": "application/json", ...signedHeaders(config.deviceId, secret, "POST", "/api/agent/quota", '{"windows":"nope"}') },
    body: '{"windows":"nope"}',
  });
  check(bad.status === 400, "schema-invalid payloads are rejected", String(bad.status));

  // Documents: watch a folder, sync, and check what the hub derived from it.
  const docsDir = mkdtempSync(join(tmpdir(), "hub-agent-docs-"));
  const progress = (item) =>
    [
      "# Tiến độ đồ án E2E",
      "",
      "- **Ngày cập nhật:** 20/09/2026",
      "",
      "| Mốc | Hạn |",
      "|---|---|",
      "| **Nộp đề cương** | 30/09 |",
      "",
      "## Việc",
      "- [x] Chọn đề tài",
      `- ${item} Viết đề cương 📅 2026-09-28`,
      "- [!] Hỏi thầy về dữ liệu",
      "",
      `Token cũ: ghp_${"a".repeat(36)}`,
    ].join("\n");
  writeFileSync(join(docsDir, "tien-do.md"), progress("[ ]"));
  writeFileSync(join(docsDir, ".env"), "SECRET=never-uploaded");
  writeFileSync(join(docsDir, "db-password.md"), "never uploaded");
  const add = await run("project", "add", docsDir, "--name", "E2E project");
  check(add.status === 0 && /1 file\(s\) to index/.test(add.stdout), "project add previews the files it will index", add.stdout.trim() || add.stderr.trim());
  const sync1 = await run("sync-docs");
  check(sync1.status === 0 && /1 files, 1 uploaded/.test(sync1.stdout), "first sync uploads the checklist", sync1.stdout.trim() || sync1.stderr.trim());
  const { data: project } = await admin.from("projects").select("*").eq("user_id", ownerId).eq("name", "E2E project").single();
  check(project?.items_total === 3 && project.items_done === 1 && project.items_attention === 1, "hub computes checklist totals", JSON.stringify(project && [project.items_total, project.items_done]));
  const { data: doc } = await admin.from("project_documents").select("content, redactions").eq("project_id", project.id).single();
  check(doc && !doc.content.includes("ghp_") && doc.redactions === 1, "a token in the file is redacted before upload");
  const { data: stored } = await admin.from("project_documents").select("path").eq("project_id", project.id);
  check(stored?.length === 1, "dot files and secret-looking names are never uploaded", JSON.stringify(stored));
  let { data: deadlines } = await admin.from("tasks").select("title, kind, status").eq("project_id", project.id).order("due_at");
  check(
    JSON.stringify(deadlines?.map((t) => [t.title, t.status])) === JSON.stringify([["Viết đề cương", "todo"], ["Nộp đề cương", "todo"]]),
    "milestone table rows and dated items become tasks",
    JSON.stringify(deadlines),
  );
  const sync2 = await run("sync-docs");
  check(/1 files, 0 uploaded/.test(sync2.stdout), "an unchanged folder uploads nothing", sync2.stdout.trim());
  writeFileSync(join(docsDir, "tien-do.md"), progress("[x]"));
  const sync3 = await run("sync-docs");
  ({ data: deadlines } = await admin.from("tasks").select("title, status").eq("project_id", project.id).eq("title", "Viết đề cương"));
  check(/1 uploaded/.test(sync3.stdout) && deadlines?.[0]?.status === "done", "ticking an item in the file completes its task", sync3.stdout.trim());
  const { data: hits } = await admin.rpc("search_documents", { p_query: "hoi thay du lieu", p_project: project.id });
  check(hits?.length >= 1, "indexed text is searchable without accents");
  await admin.from("projects").update({ status: "archived" }).eq("id", project.id);
  const sync4 = await run("sync-docs");
  check(/archived in the hub, skipped/.test(sync4.stdout), "archived projects are not synced", sync4.stdout.trim());
  rmSync(join(docsDir, "tien-do.md"));
  await admin.from("projects").update({ status: "active" }).eq("id", project.id);
  await run("sync-docs");
  const { count: remaining } = await admin.from("project_documents").select("id", { count: "exact", head: true }).eq("project_id", project.id);
  const { count: orphanTasks } = await admin.from("tasks").select("id", { count: "exact", head: true }).eq("project_id", project.id);
  check(remaining === 0 && orphanTasks === 0, "deleting the file removes its document and tasks");
  const remove = await run("project", "remove", "1");
  check(remove.status === 0, "project remove stops watching");
  await admin.from("projects").delete().eq("id", project.id);
  rmSync(docsDir, { recursive: true, force: true });

  // Revocation stops the agent.
  await admin.from("devices").delete().eq("id", config.deviceId);
  const after = await run("status");
  check(after.status !== 0 && /unauthorized/.test(after.stderr), "a revoked device is refused");
} finally {
  spawnSync(process.execPath, [agent, "logout"], { env: { ...process.env, HUB_AGENT_HOME: home } });
  rmSync(home, { recursive: true, force: true });
  fake.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll agent e2e checks passed");
process.exit(failures ? 1 : 0);

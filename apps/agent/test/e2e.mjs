#!/usr/bin/env node
// Agent end-to-end against the running dev server: pairing, signed heartbeat + quota push from a fake
// 9router, replay/tamper rejection, revocation. Uses a temp config dir and cleans up the Credential
// Manager entries it creates. Usage: node apps/agent/test/e2e.mjs (after `npm run build -w @hub/agent`)
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { signedHeaders } from "../../../packages/core/src/protocol.ts";

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

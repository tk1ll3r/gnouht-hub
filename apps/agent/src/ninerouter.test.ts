import { quotaPayloadSchema } from "@hub/core/protocol";
import { describe, expect, it } from "vitest";
import { extractConnections, NineRouterClient, normalizeQuota, normalizeStats } from "./ninerouter";

const connectionsPayload = {
  connections: [
    {
      id: "c-claude",
      provider: "claude",
      email: "nguyenvana@gmail.com",
      isActive: true,
      providerSpecificData: { cookie: "SECRET-COOKIE" },
      apiKey: undefined,
    },
    { id: "c-off", provider: "codex", name: "Old", isActive: false },
    { provider: "broken" },
  ],
};

const quotaPayload = {
  plan: "Claude Code",
  quotas: {
    "Session (5h)": { used: 40, total: 100, remaining: 60, remainingPercentage: 60, resetAt: "2026-09-25T10:00:00.000Z", unlimited: false },
    "Weekly (7d)": { used: 90, total: 100, resetAt: "not a date" },
    Credits: { unlimited: true },
  },
};

const statsPayload = {
  totalRequests: 5,
  byModel: {
    "claude-opus|claude": { rawModel: "claude-opus", provider: "claude", requests: 3, promptTokens: 1000, completionTokens: 200, cost: 0.12 },
    "gpt-5|codex": { requests: 2, promptTokens: 500, completionTokens: 50, cost: 0 },
  },
};

describe("extractConnections", () => {
  it("keeps only allow-listed fields and masks emails", () => {
    const list = extractConnections(connectionsPayload);
    expect(list).toEqual([
      { id: "c-claude", provider: "claude", label: "ng…@gmail.com", isActive: true },
      { id: "c-off", provider: "codex", label: "Old", isActive: false },
    ]);
    expect(JSON.stringify(list)).not.toContain("SECRET");
  });
});

describe("normalizeQuota", () => {
  const [connection] = extractConnections(connectionsPayload);
  const windows = normalizeQuota(connection!, quotaPayload);

  it("maps every window, deriving remaining % when only used/total are given", () => {
    expect(windows.map((w) => [w.window, w.remainingPct, w.resetAt, w.unlimited])).toEqual([
      ["Session (5h)", 60, "2026-09-25T10:00:00.000Z", false],
      ["Weekly (7d)", 10, null, false],
      ["Credits", null, null, true],
    ]);
    expect(windows[0]!.plan).toBe("Claude Code");
  });

  it("returns nothing for provider error messages", () => {
    expect(normalizeQuota(connection!, { message: "Unable to fetch" })).toEqual([]);
  });
});

describe("normalizeStats", () => {
  it("produces per-model rows for the day", () => {
    expect(normalizeStats(statsPayload, "2026-09-25")).toEqual([
      { day: "2026-09-25", provider: "claude", model: "claude-opus", requests: 3, inputTokens: 1000, outputTokens: 200, costUsd: 0.12 },
      { day: "2026-09-25", provider: "codex", model: "gpt-5", requests: 2, inputTokens: 500, outputTokens: 50, costUsd: 0 },
    ]);
  });
});

describe("NineRouterClient.collect", () => {
  it("logs in, collects a schema-valid payload and never forwards the cookie", async () => {
    const calls: string[] = [];
    const fake: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/api/auth/login") {
        const ok = JSON.parse(String(init?.body)).password === "pw";
        return new Response("{}", { status: ok ? 200 : 401, headers: ok ? { "set-cookie": "auth_token=abc; Path=/; HttpOnly" } : {} });
      }
      const cookie = new Headers(init?.headers).get("cookie");
      if (cookie !== "auth_token=abc") return new Response("{}", { status: 401 });
      if (url.pathname === "/api/providers") return Response.json(connectionsPayload);
      if (url.pathname === "/api/usage/c-claude") return Response.json(quotaPayload);
      if (url.pathname === "/api/usage/stats") return Response.json(statsPayload);
      return new Response("{}", { status: 404 });
    };

    const payload = await new NineRouterClient("http://127.0.0.1:20128", "pw", fake).collect(new Date("2026-09-25T03:00:00Z"));
    expect(quotaPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.windows).toHaveLength(3);
    expect(payload.usage).toHaveLength(2);
    expect(calls).not.toContain("GET /api/usage/c-off");
    expect(JSON.stringify(payload)).not.toContain("auth_token");
  });

  it("reports a clear error when the password is wrong", async () => {
    const fake: typeof fetch = async () => new Response("{}", { status: 401 });
    await expect(new NineRouterClient("http://127.0.0.1:20128", "bad", fake).collect()).rejects.toThrow(/login failed/);
  });
});

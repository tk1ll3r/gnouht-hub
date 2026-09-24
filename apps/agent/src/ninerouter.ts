import { maskLabel, type QuotaPayload, type QuotaWindow, type UsageRow } from "@hub/core/protocol";

/**
 * Reads quota and usage from the local 9router dashboard API (see docs/spikes.md). Only an
 * allow-listed subset of fields leaves this module; credentials and raw payloads never do.
 */
export class NineRouterClient {
  private cookie: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly password: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string): URL {
    return new URL(path, this.baseUrl);
  }

  async reachable(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(this.url("/api/health"), { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async login(): Promise<boolean> {
    if (!this.password) return false;
    const res = await this.fetchImpl(this.url("/api/auth/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: this.password }),
      signal: AbortSignal.timeout(10_000),
    });
    const cookie = res.headers.getSetCookie?.().find((c) => c.startsWith("auth_token="));
    this.cookie = res.ok && cookie ? cookie.split(";")[0]! : null;
    return this.cookie !== null;
  }

  private async get(path: string): Promise<unknown> {
    if (!this.cookie && !(await this.login())) throw new Error("9router login failed — run `hub-agent login-9router`");
    let res = await this.fetchImpl(this.url(path), { headers: { cookie: this.cookie! }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401 && (await this.login())) {
      res = await this.fetchImpl(this.url(path), { headers: { cookie: this.cookie! }, signal: AbortSignal.timeout(20_000) });
    }
    if (!res.ok) throw new Error(`9router ${path} → HTTP ${res.status}`);
    return res.json();
  }

  async collect(now = new Date()): Promise<QuotaPayload> {
    const errors: string[] = [];
    const connections = extractConnections(await this.get("/api/providers"));
    const windows: QuotaWindow[] = [];
    for (const connection of connections.filter((c) => c.isActive !== false)) {
      try {
        windows.push(...normalizeQuota(connection, await this.get(`/api/usage/${encodeURIComponent(connection.id)}`)));
      } catch (err) {
        errors.push(`${connection.provider}: ${err instanceof Error ? err.message : "failed"}`.slice(0, 200));
      }
    }
    let usage: UsageRow[] = [];
    try {
      usage = normalizeStats(await this.get("/api/usage/stats?period=today"), localDay(now));
    } catch (err) {
      errors.push(`stats: ${err instanceof Error ? err.message : "failed"}`.slice(0, 200));
    }
    return { capturedAt: now.toISOString(), windows, usage, errors };
  }
}

export interface Connection {
  id: string;
  provider: string;
  label: string;
  isActive?: boolean;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Allow-list: id, provider, a masked label and the active flag. Everything else is dropped. */
export function extractConnections(payload: unknown): Connection[] {
  const list = (payload as { connections?: unknown[] })?.connections;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const c = raw as Record<string, unknown>;
    const id = str(c.id);
    const provider = str(c.provider);
    if (!id || !provider) return [];
    const label = str(c.email) ?? str(c.name) ?? str(c.displayName) ?? provider;
    return [{ id: id.slice(0, 100), provider: provider.slice(0, 60), label: maskLabel(label), isActive: c.isActive === false ? false : true }];
  });
}

/** `{plan, quotas: {window: {used,total,remainingPercentage,resetAt,unlimited}}}` → quota windows. */
export function normalizeQuota(connection: Connection, payload: unknown): QuotaWindow[] {
  const data = payload as { plan?: unknown; quotas?: Record<string, unknown>; message?: unknown };
  if (!data?.quotas || typeof data.quotas !== "object") return [];
  const plan = str(data.plan)?.slice(0, 80) ?? null;
  return Object.entries(data.quotas).flatMap(([window, raw]) => {
    const q = raw as Record<string, unknown>;
    if (!q || typeof q !== "object") return [];
    const used = num(q.used);
    const total = num(q.total);
    let remainingPct = num(q.remainingPercentage);
    if (remainingPct === null && used !== null && total) remainingPct = Math.max(0, 100 - (used / total) * 100);
    const reset = str(q.resetAt);
    const resetAt = reset && !Number.isNaN(Date.parse(reset)) ? new Date(reset).toISOString() : null;
    return [
      {
        connectionId: connection.id,
        provider: connection.provider,
        accountLabel: connection.label,
        plan,
        window: window.slice(0, 60),
        used,
        total,
        remainingPct: remainingPct === null ? null : Math.min(100, Math.max(0, remainingPct)),
        resetAt,
        unlimited: q.unlimited === true,
      },
    ];
  });
}

/** `/api/usage/stats?period=today` → one usage row per provider/model for today. */
export function normalizeStats(payload: unknown, day: string): UsageRow[] {
  const byModel = (payload as { byModel?: Record<string, unknown> })?.byModel;
  if (!byModel || typeof byModel !== "object") return [];
  const rows = new Map<string, UsageRow>();
  for (const [key, raw] of Object.entries(byModel)) {
    const m = raw as Record<string, unknown>;
    const model = (str(m.rawModel) ?? key.split("|")[0] ?? key).slice(0, 120);
    const provider = (str(m.provider) ?? (key.includes("|") ? key.split("|")[1] : null) ?? model.split("/")[0] ?? "unknown")!.slice(0, 60);
    const id = `${provider}\u0000${model}`;
    const row = rows.get(id) ?? { day, provider, model, requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    row.requests += Math.max(0, Math.round(num(m.requests) ?? 0));
    row.inputTokens += Math.max(0, Math.round(num(m.promptTokens) ?? 0));
    row.outputTokens += Math.max(0, Math.round(num(m.completionTokens) ?? 0));
    row.costUsd += Math.max(0, num(m.cost) ?? 0);
    rows.set(id, row);
  }
  return [...rows.values()];
}

export function localDay(now: Date, tz = "Asia/Ho_Chi_Minh"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export interface ChatResult {
  content: string;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

/** OpenAI-compatible chat call to the local 9router with a dashboard-issued API key. */
export async function chatCompletion(
  baseUrl: string,
  apiKey: string,
  body: { model: string; messages: { role: string; content: string }[]; maxTokens: number },
  fetchImpl: typeof fetch = fetch,
): Promise<ChatResult> {
  const res = await fetchImpl(new URL("/v1/chat/completions", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: body.model, messages: body.messages, max_tokens: body.maxTokens, temperature: 0.3, stream: false }),
    signal: AbortSignal.timeout(180_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    model?: unknown;
    error?: { message?: unknown } | string;
  };
  if (!res.ok) {
    const message = typeof json.error === "string" ? json.error : typeof json.error?.message === "string" ? json.error.message : `HTTP ${res.status}`;
    throw new Error(`9router: ${message}`.slice(0, 280));
  }
  const raw = json.choices?.[0]?.message?.content;
  const content = typeof raw === "string" ? raw : "";
  return {
    // Reasoning models may prefix their answer with a thinking block; only the answer is returned.
    content: content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim(),
    model: str(json.model),
    promptTokens: num(json.usage?.prompt_tokens),
    completionTokens: num(json.usage?.completion_tokens),
  };
}

/** Model ids the key may use (`GET /v1/models`), for `hub-agent ai-setup`. */
export async function listModels(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchImpl(new URL("/v1/models", baseUrl), { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`9router rejected the API key (HTTP ${res.status})`);
  const json = (await res.json().catch(() => ({}))) as { data?: { id?: unknown }[] };
  return (json.data ?? []).flatMap((m) => (typeof m.id === "string" ? [m.id] : []));
}

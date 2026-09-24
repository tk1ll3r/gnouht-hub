import type { AiJob } from "@hub/core/protocol";
import { describe, expect, it } from "vitest";
import { processJobs, runJob } from "./ai";
import { CloudClient } from "./cloud";

const job: AiJob = {
  id: "8d4b1c6e-2f0a-4b7e-9c1d-3a5f6e7b8c9d",
  kind: "ask_docs",
  messages: [
    { role: "system", content: "rules" },
    { role: "user", content: "question" },
  ],
  maxOutputTokens: 300,
  model: null,
};

function fake9router(reply: (body: Record<string, unknown>, auth: string | null) => Response) {
  const calls: Record<string, unknown>[] = [];
  const fetchImpl = (async (url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), ...body });
    return reply(body, new Headers(init.headers).get("authorization"));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("runJob", () => {
  it("relays the hub's messages verbatim and returns the answer with usage", async () => {
    const { calls, fetchImpl } = fake9router((_body, auth) =>
      Response.json(
        auth === "Bearer key-1"
          ? { model: "cc/sonnet", choices: [{ message: { content: "<think>plan</think>\nHạn là 02/10 [1]." } }], usage: { prompt_tokens: 120, completion_tokens: 30 } }
          : { error: { message: "bad key" } },
        { status: auth === "Bearer key-1" ? 200 : 401 },
      ),
    );
    const result = await runJob(job, { ninerouterUrl: "http://127.0.0.1:20128", apiKey: "key-1", model: "default-model", fetchImpl });
    expect(result).toEqual({ jobId: job.id, ok: true, output: "Hạn là 02/10 [1].", usage: { promptTokens: 120, completionTokens: 30 }, model: "cc/sonnet", error: null });
    expect(calls[0]).toMatchObject({ url: "http://127.0.0.1:20128/v1/chat/completions", model: "default-model", messages: job.messages, max_tokens: 300, stream: false });
  });

  it("reports 9router errors and empty answers as failures instead of throwing", async () => {
    const denied = fake9router(() => Response.json({ error: { message: "quota exceeded" } }, { status: 429 }));
    expect(await runJob(job, { ninerouterUrl: "http://x", apiKey: "k", model: "m", fetchImpl: denied.fetchImpl })).toMatchObject({ ok: false, error: "9router: quota exceeded" });
    const empty = fake9router(() => Response.json({ choices: [{ message: { content: "  " } }] }));
    expect(await runJob(job, { ninerouterUrl: "http://x", apiKey: "k", model: "m", fetchImpl: empty.fetchImpl })).toMatchObject({ ok: false, error: "the model returned an empty answer" });
  });
});

describe("processJobs", () => {
  it("claims and completes jobs until none is left", async () => {
    let queue = [job, { ...job, id: "1f2e3d4c-5b6a-4789-8a0b-c1d2e3f4a5b6" }];
    const completed: unknown[] = [];
    const hubFetch = (async (url: URL, init: RequestInit) => {
      if (url.pathname === "/api/agent/jobs/claim") {
        const next = queue[0] ?? null;
        queue = queue.slice(1);
        return Response.json({ job: next });
      }
      completed.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true });
    }) as typeof fetch;
    const router = fake9router(() => Response.json({ choices: [{ message: { content: "ok" } }] }));
    const cloud = new CloudClient("https://hub.test", "0b8f4f7e-6d8c-4d8a-9d43-0c6a3c6f1b10", "A".repeat(43), hubFetch, 1);
    const res = await processJobs(cloud, { ninerouterUrl: "http://x", apiKey: "k", model: "m", fetchImpl: router.fetchImpl });
    expect(res).toEqual({ done: 2, failed: 0 });
    expect(completed).toHaveLength(2);
  });
});

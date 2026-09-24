import type { AiJob, AiResult } from "@hub/core/protocol";
import type { CloudClient } from "./cloud";
import { chatCompletion } from "./ninerouter";

export interface AiRuntime {
  ninerouterUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

/**
 * Runs one job: the messages the hub built go to 9router unchanged, and only the text answer and token
 * counts go back. The agent never follows anything the model says — it has no tools to call.
 */
export async function runJob(job: AiJob, runtime: AiRuntime): Promise<AiResult> {
  const model = job.model ?? runtime.model;
  try {
    const result = await chatCompletion(runtime.ninerouterUrl, runtime.apiKey, { model, messages: job.messages, maxTokens: job.maxOutputTokens }, runtime.fetchImpl);
    if (!result.content) return { jobId: job.id, ok: false, output: "", usage: null, model, error: "the model returned an empty answer" };
    return {
      jobId: job.id,
      ok: true,
      output: result.content.slice(0, 20_000),
      usage: result.promptTokens !== null || result.completionTokens !== null ? { promptTokens: result.promptTokens ?? 0, completionTokens: result.completionTokens ?? 0 } : null,
      model: (result.model ?? model).slice(0, 120),
      error: null,
    };
  } catch (err) {
    return { jobId: job.id, ok: false, output: "", usage: null, model, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
}

/** Claims and runs jobs until none is waiting (at most `max` per call). Returns how many were processed. */
export async function processJobs(cloud: CloudClient, runtime: AiRuntime, max = 3): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < max; i++) {
    const { job } = await cloud.post<{ job: AiJob | null }>("/api/agent/jobs/claim", {});
    if (!job) break;
    const result = await runJob(job, runtime);
    await cloud.post("/api/agent/jobs/complete", result);
    if (result.ok) done++;
    else failed++;
  }
  return { done, failed };
}

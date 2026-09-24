import { aiJobSchema } from "@hub/core/protocol";
import { z } from "zod";
import { authenticateAgent } from "@/lib/agent-auth";

/** The agent asks for the next AI job of its owner. Answers `{ job: null }` when there is none. */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request, z.object({}).loose());
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const { data, error } = await ctx.admin.rpc("claim_ai_job", { p_device: ctx.device.id });
  if (error) return Response.json({ error: "could not claim a job" }, { status: 500 });
  const row = data?.[0];
  if (!row) return Response.json({ job: null });
  const job = aiJobSchema.safeParse({ id: row.id, kind: row.kind, messages: row.messages, maxOutputTokens: row.max_output_tokens, model: row.model });
  if (!job.success) {
    // Should not happen (the hub built it), but never hand the agent something malformed.
    await ctx.admin.rpc("complete_ai_job", { p_device: ctx.device.id, p_job: row.id, p_ok: false, p_output: "", p_error: "malformed job" });
    return Response.json({ job: null });
  }
  return Response.json({ job: job.data });
}

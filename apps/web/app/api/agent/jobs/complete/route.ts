import { aiResultSchema } from "@hub/core/protocol";
import { authenticateAgent } from "@/lib/agent-auth";

/** The agent returns a job's answer (or its error). Only the device that claimed the job may do this. */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request, aiResultSchema);
  if (!auth.ok) return auth.response;
  const { ctx, body } = auth;
  const { error } = await ctx.admin.rpc("complete_ai_job", {
    p_device: ctx.device.id,
    p_job: body.jobId,
    p_ok: body.ok,
    p_output: body.output,
    p_prompt_tokens: body.usage?.promptTokens,
    p_completion_tokens: body.usage?.completionTokens,
    p_model: body.model ?? undefined,
    p_error: body.error ?? undefined,
  });
  if (error) return Response.json({ error: error.code === "P0002" ? "job is not running on this device" : "could not store the result" }, { status: error.code === "P0002" ? 409 : 500 });
  return Response.json({ ok: true });
}

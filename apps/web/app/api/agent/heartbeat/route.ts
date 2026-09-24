import { heartbeatSchema } from "@hub/core/protocol";
import { authenticateAgent } from "@/lib/agent-auth";

/** Liveness + agent status; the response tells the agent how often to report. */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request, heartbeatSchema);
  if (!auth.ok) return auth.response;
  const { ctx, body } = auth;
  await ctx.admin
    .from("devices")
    .update({ agent_version: body.agentVersion, status: { ninerouter: body.ninerouter, heartbeatAt: new Date().toISOString() } })
    .eq("id", ctx.device.id);
  return Response.json({ ok: true, device: ctx.device.name, intervals: { heartbeatSeconds: 60, quotaSeconds: 300, uitSeconds: 6 * 3600 } });
}

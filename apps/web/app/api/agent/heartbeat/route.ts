import { heartbeatSchema } from "@hub/core/protocol";
import { authenticateAgent } from "@/lib/agent-auth";

const AGENT_INTERVALS = { heartbeatSeconds: 60, quotaSeconds: 300, uitSeconds: 6 * 3600, documentsSeconds: 600, jobsSeconds: 10 };

/** Liveness + agent status; the response tells the agent how often to report. */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request, heartbeatSchema);
  if (!auth.ok) return auth.response;
  const { ctx, body } = auth;
  const { data: device } = await ctx.admin.from("devices").select("status").eq("id", ctx.device.id).single();
  await ctx.admin
    .from("devices")
    .update({
      agent_version: body.agentVersion,
      status: {
        ...((device?.status as object) ?? {}),
        ninerouter: body.ninerouter,
        ...(body.documents ? { documents: body.documents } : {}),
        ...(body.ai ? { ai: body.ai } : {}),
        heartbeatAt: new Date().toISOString(),
      },
    })
    .eq("id", ctx.device.id);
  return Response.json({ ok: true, device: ctx.device.name, intervals: AGENT_INTERVALS });
}

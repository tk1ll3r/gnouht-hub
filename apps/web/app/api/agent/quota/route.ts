import { quotaPayloadSchema } from "@hub/core/protocol";
import { authenticateAgent } from "@/lib/agent-auth";

/** 9router quota windows and per-day usage pushed by the agent every few minutes. */
export async function POST(request: Request) {
  const auth = await authenticateAgent(request, quotaPayloadSchema);
  if (!auth.ok) return auth.response;
  const { ctx, body } = auth;
  const userId = ctx.device.userId;

  if (body.windows.length) {
    const { error } = await ctx.admin.from("quota_snapshots").insert(
      body.windows.map((w) => ({
        user_id: userId,
        device_id: ctx.device.id,
        connection_id: w.connectionId,
        provider: w.provider,
        account_label: w.accountLabel,
        plan: w.plan,
        window_label: w.window,
        used: w.used,
        total: w.total,
        remaining_pct: w.remainingPct,
        reset_at: w.resetAt,
        unlimited: w.unlimited,
        captured_at: body.capturedAt,
      })),
    );
    if (error) return Response.json({ error: "could not store snapshots" }, { status: 500 });
  }

  if (body.usage.length) {
    // 9router reports cumulative totals per day, so rows are replaced rather than added.
    const { error } = await ctx.admin.from("usage_daily").upsert(
      body.usage.map((u) => ({
        user_id: userId,
        day: u.day,
        provider: u.provider,
        model: u.model,
        requests: u.requests,
        input_tokens: u.inputTokens,
        output_tokens: u.outputTokens,
        cost_usd: u.costUsd,
      })),
      { onConflict: "user_id,day,provider,model" },
    );
    if (error) return Response.json({ error: "could not store usage" }, { status: 500 });
  }

  const { data: device } = await ctx.admin.from("devices").select("status").eq("id", ctx.device.id).single();
  await ctx.admin
    .from("devices")
    .update({ status: { ...((device?.status as object) ?? {}), quotaAt: body.capturedAt, quotaErrors: body.errors.slice(0, 5) } })
    .eq("id", ctx.device.id);
  return Response.json({ ok: true, windows: body.windows.length, usage: body.usage.length });
}

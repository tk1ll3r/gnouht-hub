import { addDaysToKey, formatDuration, formatZoned, zonedDateKey } from "@hub/core";
import { Gauge, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { InlineAction } from "@/components/forms";
import { ManualQuotaForm } from "@/components/quota-forms";
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, ProgressBar } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadWorkspace } from "@/lib/data";
import { relativeTime } from "@/lib/format";
import { deleteManualQuota } from "./actions";

export const metadata: Metadata = { title: "AI quota" };

const OFFLINE_AFTER_MS = 15 * 60_000;

function toneFor(remainingPct: number | null): "ok" | "warn" | "danger" | "accent" {
  if (remainingPct == null) return "accent";
  if (remainingPct <= 5) return "danger";
  if (remainingPct <= 20) return "warn";
  return "ok";
}

/** Daily token usage as stacked SVG bars (input under output). */
function UsageChart({ days }: { days: { day: string; input: number; output: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.input + d.output));
  const barWidth = 8;
  const gap = 3;
  const height = 80;
  return (
    <svg viewBox={`0 0 ${days.length * (barWidth + gap)} ${height + 14}`} className="h-auto w-full" role="img" aria-label="Tokens per day, last 30 days">
      {days.map((d, i) => {
        const x = i * (barWidth + gap);
        const inputH = (d.input / max) * height;
        const outputH = (d.output / max) * height;
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${d.input.toLocaleString()} in / ${d.output.toLocaleString()} out`}</title>
            <rect x={x} y={0} width={barWidth} height={height} rx={2} className="fill-surface-2" />
            <rect x={x} y={height - inputH} width={barWidth} height={inputH} rx={2} className="fill-accent" opacity={0.45} />
            <rect x={x} y={height - inputH - outputH} width={barWidth} height={outputH} rx={2} className="fill-accent" />
            {i % 7 === 0 ? (
              <text x={x + barWidth / 2} y={height + 11} textAnchor="middle" fontSize={7} className="fill-muted">
                {Number(d.day.slice(8))}/{Number(d.day.slice(5, 7))}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export default async function QuotaPage() {
  const { user, supabase } = await requireUser();
  const ws = await loadWorkspace(supabase, user.id);
  const tz = ws.options.tz;
  const now = new Date();
  const since = addDaysToKey(zonedDateKey(now, tz), -29);

  const [{ data: windowRows }, { data: usage }, { data: manual }, { data: devices }] = await Promise.all([
    supabase.from("quota_latest").select("*").order("provider"),
    supabase.from("usage_daily").select("*").gte("day", since),
    supabase.from("manual_quotas").select("*").order("name"),
    supabase.from("devices").select("id, name, last_seen_at, status").order("last_seen_at", { ascending: false, nullsFirst: false }),
  ]);

  // The view's columns are typed nullable; every snapshot row actually has these fields.
  const windows = (windowRows ?? []).flatMap((w) =>
    w.connection_id && w.window_label && w.captured_at && w.provider
      ? [{ ...w, connection_id: w.connection_id, window_label: w.window_label, captured_at: w.captured_at, provider: w.provider, unlimited: Boolean(w.unlimited) }]
      : [],
  );
  const device = devices?.[0];
  const online = device?.last_seen_at ? now.getTime() - new Date(device.last_seen_at).getTime() < OFFLINE_AFTER_MS : false;
  const latestCapture = windows.reduce((max, w) => (w.captured_at > max ? w.captured_at : max), "");

  // Group windows per 9router connection (one card per AI account).
  const accounts = new Map<string, typeof windows>();
  for (const w of windows) {
    const list = accounts.get(w.connection_id) ?? [];
    list.push(w);
    accounts.set(w.connection_id, list);
  }

  const byDay = new Map<string, { input: number; output: number }>();
  const byModel = new Map<string, { provider: string; model: string; requests: number; input: number; output: number; cost: number }>();
  for (const row of usage ?? []) {
    const day = byDay.get(row.day) ?? { input: 0, output: 0 };
    day.input += Number(row.input_tokens);
    day.output += Number(row.output_tokens);
    byDay.set(row.day, day);
    if (row.day >= addDaysToKey(zonedDateKey(now, tz), -6)) {
      const key = `${row.provider}/${row.model}`;
      const model = byModel.get(key) ?? { provider: row.provider, model: row.model, requests: 0, input: 0, output: 0, cost: 0 };
      model.requests += row.requests;
      model.input += Number(row.input_tokens);
      model.output += Number(row.output_tokens);
      model.cost += Number(row.cost_usd);
      byModel.set(key, model);
    }
  }
  const chartDays = Array.from({ length: 30 }, (_, i) => {
    const day = addDaysToKey(since, i);
    return { day, ...(byDay.get(day) ?? { input: 0, output: 0 }) };
  });
  const models = [...byModel.entries()].sort((a, b) => b[1].input + b[1].output - (a[1].input + a[1].output));

  return (
    <>
      <PageHeader title="AI quota" description="Live limits of the accounts behind your 9router, reported by the hub agent." />

      {!device ? (
        <Card className="mb-6">
          <EmptyState title="No agent paired yet" action={<ButtonLink href="/settings#devices">Pair your PC</ButtonLink>}>
            The agent runs on your PC next to 9router and reports quota every 5 minutes. 9router itself is never exposed to the internet.
          </EmptyState>
        </Card>
      ) : !online ? (
        <p className="mb-5 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          Agent “{device.name}” is offline{device.last_seen_at ? ` (last seen ${relativeTime(device.last_seen_at, now)})` : ""}. Numbers below may be stale.
        </p>
      ) : null}

      {accounts.size ? (
        <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...accounts.entries()].map(([connectionId, list]) => {
            const first = list[0]!;
            return (
              <Card key={connectionId}>
                <CardHeader
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <Gauge className="size-4 text-muted" /> {first.provider}
                    </span>
                  }
                  description={[first.account_label, first.plan].filter(Boolean).join(", ")}
                />
                <CardBody className="flex flex-col gap-3">
                  {list.map((w) => {
                    const remaining = w.unlimited ? 100 : w.remaining_pct;
                    const used = remaining == null ? null : 100 - remaining;
                    const resetIn = w.reset_at ? new Date(w.reset_at).getTime() - now.getTime() : null;
                    return (
                      <div key={w.window_label}>
                        <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                          <span className="font-medium">{w.window_label}</span>
                          <span className="text-muted">
                            {w.unlimited ? "unlimited" : remaining == null ? "unknown" : `${Math.round(remaining)}% left`}
                            {w.used != null && w.total ? `, ${w.used} of ${w.total}` : ""}
                          </span>
                        </div>
                        <ProgressBar value={(used ?? 0) / 100} tone={toneFor(remaining ?? null)} label={`${w.window_label} used`} />
                        {resetIn != null ? (
                          <p className="mt-1 text-[12px] text-muted">
                            {resetIn > 0 ? `Resets in ${formatDuration(resetIn)} (${formatZoned(new Date(w.reset_at!), "EEE HH:mm", tz)})` : "Resetting now"}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            );
          })}
        </div>
      ) : device ? (
        <Card className="mb-6">
          <EmptyState title="No quota data yet">Log the agent into 9router with <code className="font-mono">hub-agent login-9router</code>.</EmptyState>
        </Card>
      ) : null}
      {latestCapture ? <p className="-mt-3 mb-6 text-[12px] text-muted">Captured {relativeTime(latestCapture, now)}.</p> : null}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader title="Tokens per day" description="Last 30 days through 9router (darker = output)." />
          <CardBody>
            <UsageChart days={chartDays} />
            {models.length ? (
              <table className="mt-4 w-full text-[13px]">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-1 font-medium">Last 7 days</th>
                    <th className="py-1 text-right font-medium">Requests</th>
                    <th className="py-1 text-right font-medium">Tokens</th>
                    <th className="py-1 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {models.slice(0, 10).map(([key, m]) => (
                    <tr key={key}>
                      <td className="max-w-0 truncate py-1.5 pr-2">
                        {m.model} <span className="text-muted">{m.provider}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{m.requests.toLocaleString()}</td>
                      <td className="py-1.5 text-right tabular-nums">{(m.input + m.output).toLocaleString()}</td>
                      <td className="py-1.5 text-right tabular-nums">${m.cost.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Other quotas" description="Things 9router cannot see, e.g. Kaggle GPU hours." />
          {manual?.length ? (
            <ul className="divide-y divide-border">
              {manual.map((q) => {
                const ratio = Number(q.used) / Number(q.limit_value);
                return (
                  <li key={q.id} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{q.name}</span>
                      <span className="flex items-center gap-2 text-[12px] text-muted">
                        {Number(q.used)}/{Number(q.limit_value)} {q.unit}
                        {q.resets_on ? <Badge>resets {q.resets_on}</Badge> : null}
                        <InlineAction action={deleteManualQuota} fields={{ id: q.id }} confirm="Delete this quota?" title="Delete">
                          <Trash2 className="size-3.5" aria-label="Delete" />
                        </InlineAction>
                      </span>
                    </div>
                    <ProgressBar value={ratio} tone={ratio >= 0.95 ? "danger" : ratio >= 0.8 ? "warn" : "ok"} />
                    <details>
                      <summary className="cursor-pointer text-[12px] text-accent">Edit</summary>
                      <div className="mt-2">
                        <ManualQuotaForm
                          quota={{ id: q.id, name: q.name, unit: q.unit, used: Number(q.used), limit_value: Number(q.limit_value), resets_on: q.resets_on }}
                        />
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <CardBody className={manual?.length ? "border-t border-border" : undefined}>
            <ManualQuotaForm />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

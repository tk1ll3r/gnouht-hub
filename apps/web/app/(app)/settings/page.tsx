import { CalendarDays, Link2, Monitor, RefreshCw, Shield } from "lucide-react";
import type { Metadata } from "next";
import { DevicePairing } from "@/components/device-pairing";
import { InlineAction } from "@/components/forms";
import { IcsSourceForm, PeriodsForm, ProfileForm } from "@/components/settings-forms";
import { Badge, buttonClass, Card, CardBody, CardHeader, EmptyState, Meta, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadWorkspace, periodsOf } from "@/lib/data";
import { googleConfigured } from "@/lib/env";
import { auditLabel, formatDue, isRecent, relativeTime } from "@/lib/format";
import { deleteSource, saveGoogleCalendars, syncSourceNow, toggleSource } from "./actions";
import { revokeDevice } from "./device-actions";

export const metadata: Metadata = { title: "Settings" };

const NOTICES: Record<string, { tone: "ok" | "danger"; text: string }> = {
  google: { tone: "ok", text: "Google Calendar connected." },
  state: { tone: "danger", text: "The Google sign-in expired or did not match. Please try again." },
  scope: { tone: "danger", text: "Google Calendar access was not granted. Tick the calendar permission when Google asks." },
  denied: { tone: "danger", text: "Google access was cancelled." },
  google_failed: { tone: "danger", text: "Connecting Google Calendar failed. Please try again." },
  not_configured: { tone: "danger", text: "Google Calendar is not configured on this server yet." },
};

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const params = await searchParams;
  const { user, supabase } = await requireUser();
  const ws = await loadWorkspace(supabase, user.id);
  const [{ data: sources }, { data: auditRows }, { data: devices }] = await Promise.all([
    supabase.from("calendar_sources").select("*").order("created_at"),
    supabase.from("audit_log").select("id, at, action, entity, meta").order("at", { ascending: false }).limit(10),
    supabase.from("devices").select("id, name, platform, agent_version, status, last_seen_at").order("created_at"),
  ]);
  const noticeKey = typeof params.connected === "string" ? params.connected : typeof params.error === "string" ? params.error : null;
  const notice = noticeKey ? NOTICES[noticeKey] : null;
  const tz = ws.options.tz;

  return (
    <>
      <PageHeader title="Settings" description={user.email ?? undefined} />
      {notice ? (
        <p role="status" className={`mb-5 rounded-lg px-3 py-2 text-sm ${notice.tone === "ok" ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
          {notice.text}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="Profile and day" description="Your productive hours decide how much free time each deadline has." />
          <CardBody className="max-w-3xl">
            <ProfileForm
              profile={{
                display_name: ws.profile.display_name,
                timezone: ws.profile.timezone,
                day_start: ws.profile.day_start,
                day_end: ws.profile.day_end,
                busy_buffer_minutes: ws.profile.busy_buffer_minutes,
                email_digest: ws.profile.email_digest,
              }}
            />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Class periods" description="When each tiết starts and ends. The defaults follow UIT; check them against your timetable." />
          <CardBody>
            <PeriodsForm periods={periodsOf(ws.profile)} />
          </CardBody>
        </Card>

        <Card id="calendars" className="lg:col-span-2">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4" /> Calendars
              </span>
            }
            description="Google Calendar and iCal feeds are synced every 15 minutes. Credentials are stored encrypted and never shown again."
            actions={
              googleConfigured() ? (
                <a href="/api/integrations/google/start" className={buttonClass("primary", "sm")}>
                  <Link2 className="size-3.5" /> Connect Google Calendar
                </a>
              ) : (
                <Badge>Google not configured</Badge>
              )
            }
          />
          {sources?.length ? (
            <ul className="divide-y divide-border">
              {sources.map((source) => {
                const calendars = source.calendars as { id: string; summary: string; selected?: boolean }[];
                return (
                  <li key={source.id} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{source.name}</span>
                      <Badge tone="accent">{source.kind === "google" ? "Google" : source.flavor === "moodle" ? "Moodle deadlines" : "iCal"}</Badge>
                      {source.account_label ? <span className="text-[12px] text-muted">{source.account_label}</span> : null}
                      <Badge tone={source.status === "active" ? "ok" : "danger"}>{source.status}</Badge>
                      {!source.enabled ? <Badge>paused</Badge> : null}
                      <span className="ml-auto flex items-center gap-1">
                        <InlineAction action={syncSourceNow} fields={{ id: source.id }} title="Sync now">
                          <RefreshCw className="size-3.5" aria-label="Sync now" />
                        </InlineAction>
                        <InlineAction action={toggleSource} fields={{ id: source.id }}>
                          {source.enabled ? "Pause" : "Resume"}
                        </InlineAction>
                        <InlineAction action={deleteSource} fields={{ id: source.id }} confirm="Disconnect and delete synced data?" variant="danger">
                          Disconnect
                        </InlineAction>
                      </span>
                    </div>
                    <p className="text-[12px] text-muted">
                      {source.last_synced_at ? `Last sync ${relativeTime(source.last_synced_at)} (${formatDue(source.last_synced_at, tz)})` : "Never synced"}
                      {source.last_error ? <span className="block text-danger">{source.last_error}</span> : null}
                    </p>
                    {source.kind === "google" && calendars.length > 1 ? (
                      <form action={saveGoogleCalendars} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                        <input type="hidden" name="id" value={source.id} />
                        {calendars.map((calendar) => (
                          <label key={calendar.id} className="flex items-center gap-1.5">
                            <input type="checkbox" name="calendar" value={calendar.id} defaultChecked={calendar.selected} className="size-3.5 accent-accent" />
                            {calendar.summary}
                          </label>
                        ))}
                        <button className={buttonClass("secondary", "sm")}>Save selection</button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No calendars connected">Connect Google Calendar for busy time, and your Moodle export for deadlines.</EmptyState>
          )}
          <CardBody className="border-t border-border">
            <h3 className="mb-3 text-sm font-semibold">Add an iCal feed</h3>
            <IcsSourceForm />
          </CardBody>
        </Card>

        <Card id="devices" className="lg:col-span-2">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-1.5">
                <Monitor className="size-4" /> Devices
              </span>
            }
            description="The hub agent on your PC reads 9router quota, project documents and UIT data. It only makes outbound, signed requests."
          />
          {devices?.length ? (
            <ul className="divide-y divide-border">
              {devices.map((device) => {
                const status = (device.status ?? {}) as { ninerouter?: { reachable?: boolean; loggedIn?: boolean } };
                const online = isRecent(device.last_seen_at, 15 * 60_000);
                return (
                  <li key={device.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                    <span className="font-medium">{device.name}</span>
                    <Badge tone={online ? "ok" : "neutral"}>{online ? "online" : "offline"}</Badge>
                    {status.ninerouter ? (
                      <Badge tone={status.ninerouter.loggedIn ? "ok" : "warn"}>
                        9router {status.ninerouter.reachable ? (status.ninerouter.loggedIn ? "connected" : "needs login") : "unreachable"}
                      </Badge>
                    ) : null}
                    <span className="text-[12px] text-muted">
                      <Meta items={[device.platform, device.agent_version ? `agent ${device.agent_version}` : null, device.last_seen_at ? `seen ${relativeTime(device.last_seen_at)}` : "never seen"]} />
                    </span>
                    <span className="ml-auto">
                      <InlineAction action={revokeDevice} fields={{ id: device.id }} confirm="Revoke this device? It will stop syncing immediately." variant="danger">
                        Revoke
                      </InlineAction>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <CardBody className={devices?.length ? "border-t border-border" : undefined}>
            <DevicePairing />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-1.5">
                <Shield className="size-4" /> Security activity
              </span>
            }
            description="Recent sign-ins and integration changes on your account."
          />
          {auditRows?.length ? (
            <ul className="divide-y divide-border text-[13px]">
              {auditRows.map((row) => (
                <li key={row.id} className="flex justify-between gap-3 px-4 py-2">
                  <span>{auditLabel(row.action)}</span>
                  <span className="text-muted">{formatDue(row.at, tz)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No activity yet" />
          )}
        </Card>
      </div>
    </>
  );
}

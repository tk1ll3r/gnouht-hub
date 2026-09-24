import { formatZoned, parseClock } from "@hub/core";
import { ArrowLeft, CalendarClock, Eye, EyeOff, LogOut, Trash2, UserMinus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AvailabilityHeatmap } from "@/components/charts";
import { InlineAction } from "@/components/forms";
import { GroupForm, InviteForm } from "@/components/group-forms";
import { Badge, buttonClass, Card, CardBody, CardHeader, ColorDot, EmptyState, ProgressBar, Select } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadWorkspace } from "@/lib/data";
import { formatDue } from "@/lib/format";
import { groupAvailability, type GroupAvailability } from "@/lib/groups";
import { projectProgress } from "@/lib/projects";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuid } from "@/lib/validation";
import { deleteGroup, removeMember, revokeInvite, setShareBusy, shareProject, unshareProject } from "../actions";

export const metadata: Metadata = { title: "Group" };

interface SharedProject {
  id: string;
  name: string;
  color: string;
  user_id: string;
  items_total: number;
  items_done: number;
  items_cut: number;
  items_attention: number;
}

export default async function GroupPage({ params }: PageProps<"/groups/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { user, supabase } = await requireUser();

  // RLS: non-members (and invitees who have not joined) get no roster, which makes this a 404.
  const [{ data: group }, { data: roster }] = await Promise.all([
    supabase.from("groups").select("*").eq("id", id).maybeSingle(),
    supabase.rpc("group_roster", { p_group: id }),
  ]);
  const me = roster?.find((m) => m.user_id === user.id);
  if (!group || !me) notFound();
  const isOwner = me.role === "owner";

  const now = new Date();
  const [ws, sharesRes, myProjectsRes, invitesRes] = await Promise.all([
    loadWorkspace(supabase, user.id),
    supabase.from("project_shares").select("project_id, shared_by, projects(id, name, color, user_id, items_total, items_done, items_cut, items_attention)").eq("group_id", id),
    supabase.from("projects").select("id, name").eq("user_id", user.id).neq("status", "archived").order("name"),
    isOwner
      ? supabase.from("group_invites").select("id, email, expires_at, accepted_at, revoked_at").eq("group_id", id).is("accepted_at", null).is("revoked_at", null).gt("expires_at", now.toISOString()).order("created_at")
      : Promise.resolve({ data: [] as { id: string; email: string; expires_at: string }[] }),
  ]);
  const tz = ws.options.tz;
  const shares = (sharesRes.data ?? []).flatMap((s) => (s.projects ? [{ ...s, project: s.projects as SharedProject }] : []));
  const sharedIds = shares.map((s) => s.project_id);
  const shareable = (myProjectsRes.data ?? []).filter((p) => !sharedIds.includes(p.id));
  const names = new Map((roster ?? []).map((m) => [m.user_id, m.user_id === user.id ? "you" : m.display_name]));

  const { data: deadlines } = sharedIds.length
    ? await supabase
        .from("tasks")
        .select("id, title, due_at, status, project_id")
        .in("project_id", sharedIds)
        .not("status", "in", "(done,cut)")
        .gte("due_at", new Date(now.getTime() - 7 * 86_400_000).toISOString())
        .lte("due_at", new Date(now.getTime() + 30 * 86_400_000).toISOString())
        .order("due_at")
        .limit(30)
    : { data: [] };
  const projectById = new Map(shares.map((s) => [s.project_id, s.project]));

  // Free/busy overlap across members who opted in. Uses the service role after the membership check
  // above, is rate limited, and only returns counts.
  const opted = (roster ?? []).filter((m) => m.share_busy).map((m) => m.user_id);
  let availability: GroupAvailability | null = null;
  let limited = false;
  if (opted.length) {
    const admin = createAdminClient();
    const { data: allowed } = await admin.rpc("hit_rate_limit", { p_bucket: `freebusy:${user.id}`, p_limit: 60, p_window_seconds: 600 });
    if (allowed === false) limited = true;
    else availability = await groupAvailability(admin, opted, ws.options, now);
  }

  return (
    <>
      <Link href="/groups" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-3.5" /> Groups
      </Link>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ColorDot color={group.color} size={12} />
            <h1 className="text-xl font-semibold tracking-tight">{group.name}</h1>
            {isOwner ? <Badge>owner</Badge> : null}
          </div>
          {group.description ? <p className="mt-1 max-w-3xl text-sm text-muted">{group.description}</p> : null}
        </div>
        {!isOwner ? (
          <InlineAction action={removeMember} fields={{ group_id: group.id, user_id: user.id }} confirm="Leave this group? Projects you shared are withdrawn." variant="secondary" size="md">
            <LogOut className="size-4" /> Leave
          </InlineAction>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="size-4" /> When is everyone free?
                </span>
              }
              description={`Next 7 days, counting the classes and busy events of the ${opted.length} of ${roster?.length ?? 0} members who share their free/busy. Nobody sees what anyone else is doing.`}
              actions={
                <form action={setShareBusy}>
                  <input type="hidden" name="group_id" value={group.id} />
                  <input type="hidden" name="share" value={String(!me.share_busy)} />
                  <button className={buttonClass(me.share_busy ? "secondary" : "primary", "sm")}>
                    {me.share_busy ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {me.share_busy ? "Stop sharing" : "Share my free/busy"}
                  </button>
                </form>
              }
            />
            <CardBody>
              {limited ? (
                <p className="text-[13px] text-warn">Refreshed too often. The overlap is available again in a few minutes.</p>
              ) : availability && availability.counted > 0 ? (
                <div className="flex flex-col gap-4">
                  <AvailabilityHeatmap days={availability.grid} total={availability.counted} tz={tz} dayStartMinutes={parseClock(ws.options.dayStart)} />
                  <p className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
                    <span className="inline-flex items-center gap-1">
                      <svg width="10" height="10" aria-hidden>
                        <rect width="10" height="10" rx="2" className="fill-ok" />
                      </svg>
                      everyone free
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <svg width="10" height="10" aria-hidden>
                        <rect width="10" height="10" rx="2" className="fill-accent" opacity={0.5} />
                      </svg>
                      some free
                    </span>
                  </p>
                  {availability.best.slots.length ? (
                    <div>
                      <p className="mb-1.5 text-[13px] font-medium">
                        {availability.best.threshold === availability.counted
                          ? "Everyone is free"
                          : `No hour fits everyone. Best slots, with ${availability.best.threshold} of ${availability.counted} free:`}
                      </p>
                      <ul className="flex flex-col gap-1 text-[13px]">
                        {availability.best.slots.map((slot) => (
                          <li key={slot.start.toISOString()} className="flex items-center gap-2">
                            <Badge tone={availability.best.threshold === availability.counted ? "ok" : "accent"}>
                              {slot.free}/{availability.counted}
                            </Badge>
                            {formatZoned(slot.start, "EEE d MMM, HH:mm", tz)}–{formatZoned(slot.end, "HH:mm", tz)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-[13px] text-muted">No hour-long slot works for at least half of the group this week.</p>
                  )}
                </div>
              ) : (
                <EmptyState title="Nobody shares free/busy yet">Members opt in with the button above. The hub then counts who is free each hour.</EmptyState>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Team deadlines" description="Open milestones of shared projects in the next 30 days." />
            {deadlines?.length ? (
              <ul className="divide-y divide-border">
                {deadlines.map((task) => {
                  const project = task.project_id ? projectById.get(task.project_id) : null;
                  const overdue = task.due_at ? new Date(task.due_at) < now : false;
                  return (
                    <li key={task.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        {project ? <ColorDot color={project.color} size={8} /> : null}
                        <span className="truncate">{task.title}</span>
                        {project ? <span className="shrink-0 text-[12px] text-muted">{project.name}</span> : null}
                      </span>
                      <span className={overdue ? "shrink-0 text-[12px] text-danger" : "shrink-0 text-[12px] text-muted"}>
                        {task.due_at ? formatDue(task.due_at, tz, now) : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No upcoming team deadlines">Share a project with milestones to see them here.</EmptyState>
            )}
          </Card>

          <Card>
            <CardHeader title="Shared projects" description="Members can read progress, checklists and documents. Only the owner can change them." />
            {shares.length ? (
              <ul className="divide-y divide-border">
                {shares.map(({ project, shared_by }) => {
                  const progress = projectProgress(project);
                  const mine = project.user_id === user.id;
                  return (
                    <li key={project.id} className="flex items-center gap-3 px-4 py-3">
                      <Link href={`/projects/${project.id}`} className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <ColorDot color={project.color} size={8} />
                          <span className="truncate">{project.name}</span>
                          {project.items_attention ? <Badge tone="warn">{project.items_attention} attention</Badge> : null}
                        </span>
                        <span className="mt-1.5 flex items-center gap-2">
                          <ProgressBar value={progress.ratio} tone="ok" className="max-w-48" label={`${project.name} progress`} />
                          <span className="shrink-0 text-[12px] text-muted">
                            {progress.basis === "checklist" ? `${progress.done}/${progress.countable} done` : "no checklist"}, shared by {names.get(shared_by) ?? "a former member"}
                          </span>
                        </span>
                      </Link>
                      {mine || isOwner ? (
                        <InlineAction action={unshareProject} fields={{ group_id: group.id, project_id: project.id }} confirm="Stop sharing this project with the group?" title="Stop sharing">
                          <Trash2 className="size-3.5" aria-label="Stop sharing" />
                        </InlineAction>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="Nothing shared yet" />
            )}
            {shareable.length ? (
              <CardBody className="border-t border-border">
                <form action={shareProject} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="group_id" value={group.id} />
                  <label htmlFor="share-project" className="text-[13px] font-medium">
                    Share one of your projects
                  </label>
                  <Select id="share-project" name="project_id" className="w-auto min-w-48 flex-1">
                    {shareable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <button className={buttonClass("secondary", "md")}>Share</button>
                </form>
              </CardBody>
            ) : null}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Members" description={`${roster?.length ?? 0} of 30`} />
            <ul className="divide-y divide-border">
              {(roster ?? []).map((member) => (
                <li key={member.user_id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {member.display_name}
                    {member.user_id === user.id ? <span className="text-muted"> (you)</span> : null}
                  </span>
                  {member.role === "owner" ? <Badge>owner</Badge> : null}
                  {member.share_busy ? <Badge tone="ok">free/busy</Badge> : null}
                  {isOwner && member.user_id !== user.id ? (
                    <InlineAction action={removeMember} fields={{ group_id: group.id, user_id: member.user_id }} confirm="Remove this member?" title="Remove member">
                      <UserMinus className="size-3.5" aria-label="Remove" />
                    </InlineAction>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          {isOwner ? (
            <Card>
              <CardHeader title="Invite a classmate" description="New users can register only through an invite sent to their exact address." />
              <CardBody>
                <InviteForm groupId={group.id} />
              </CardBody>
              {invitesRes.data?.length ? (
                <ul className="divide-y divide-border border-t border-border">
                  {invitesRes.data.map((invite) => (
                    <li key={invite.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                      <span className="min-w-0 truncate">{invite.email}</span>
                      <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted">
                        until {formatZoned(new Date(invite.expires_at), "d MMM", tz)}
                        <InlineAction action={revokeInvite} fields={{ id: invite.id }} confirm="Revoke this invite?" title="Revoke">
                          <Trash2 className="size-3.5" aria-label="Revoke" />
                        </InlineAction>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}

          {isOwner ? (
            <Card>
              <CardHeader
                title="Settings"
                actions={
                  <InlineAction action={deleteGroup} fields={{ id: group.id }} confirm="Delete the group for everyone?" variant="danger">
                    <Trash2 className="size-3.5" /> Delete
                  </InlineAction>
                }
              />
              <CardBody>
                <GroupForm group={{ id: group.id, name: group.name, description: group.description, color: group.color }} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

import { formatZoned, parseClock } from "@hub/core";
import { ArrowLeft, CalendarClock, Eye, EyeOff, Flag, LogOut, Trash2, Unlink, UserMinus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AvailabilityHeatmap } from "@/components/charts";
import { InlineAction } from "@/components/forms";
import { GroupForm, InviteForm } from "@/components/group-forms";
import { Badge, buttonClass, Card, CardBody, CardHeader, ColorDot, EmptyState, ProgressBar, Select } from "@/components/ui";
import { linkGroup, unlinkGroup } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import { loadWorkspace } from "@/lib/data";
import { formatDayKey, formatDue } from "@/lib/format";
import { groupAvailability, type GroupAvailability } from "@/lib/groups";
import { projectProgress, ROLE_LABELS } from "@/lib/projects";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuid } from "@/lib/validation";
import { deleteGroup, removeMember, revokeInvite, setShareBusy } from "../actions";

export const metadata: Metadata = { title: "Group" };

interface LinkedProject {
  id: string;
  name: string;
  color: string;
  owner_id: string;
  status: string;
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
  const [ws, linksRes, ledRes, invitesRes] = await Promise.all([
    loadWorkspace(supabase, user.id),
    supabase
      .from("project_groups")
      .select("project_id, default_role, projects(id, name, color, owner_id, status, items_total, items_done, items_cut, items_attention)")
      .eq("group_id", id),
    supabase.from("projects").select("id, name").eq("owner_id", user.id).neq("status", "archived").order("name"),
    isOwner
      ? supabase.from("group_invites").select("id, email, expires_at, accepted_at, revoked_at").eq("group_id", id).is("accepted_at", null).is("revoked_at", null).gt("expires_at", now.toISOString()).order("created_at")
      : Promise.resolve({ data: [] as { id: string; email: string; expires_at: string }[] }),
  ]);
  const tz = ws.options.tz;
  const todayKey = formatZoned(now, "yyyy-MM-dd", tz);
  // A project whose lead removed the caller is linked but unreadable: it is left out.
  const links = (linksRes.data ?? []).flatMap((l) => (l.projects ? [{ role: l.default_role as "editor" | "viewer", project: l.projects as LinkedProject }] : []));
  const linkedIds = links.map((l) => l.project.id);
  const linkable = (ledRes.data ?? []).filter((p) => !linkedIds.includes(p.id));
  const names = new Map((roster ?? []).map((m) => [m.user_id, m.user_id === user.id ? "you" : m.display_name]));
  const projectById = new Map(links.map((l) => [l.project.id, l.project]));

  const [{ data: openTasks }, { data: milestones }] = linkedIds.length
    ? await Promise.all([
        supabase.from("tasks").select("id, title, due_at, status, project_id, assignee_id").in("project_id", linkedIds).not("status", "in", "(done,cut)").limit(1000),
        supabase
          .from("milestones")
          .select("id, title, due_on, hard, project_id")
          .in("project_id", linkedIds)
          .eq("done", false)
          .gte("due_on", formatZoned(new Date(now.getTime() - 7 * 86_400_000), "yyyy-MM-dd", tz))
          .lte("due_on", formatZoned(new Date(now.getTime() + 30 * 86_400_000), "yyyy-MM-dd", tz))
          .order("due_on")
          .limit(20),
      ])
    : [{ data: [] }, { data: [] }];
  const tasks = openTasks ?? [];
  const dueSoon = tasks
    .filter((t) => t.due_at && new Date(t.due_at).getTime() < now.getTime() + 14 * 86_400_000)
    .sort((a, b) => a.due_at!.localeCompare(b.due_at!))
    .slice(0, 15);
  // Who carries what across the group's projects: open and overdue tasks per member.
  const workload = (roster ?? [])
    .map((m) => {
      const theirs = tasks.filter((t) => t.assignee_id === m.user_id);
      return { id: m.user_id, name: names.get(m.user_id)!, open: theirs.length, overdue: theirs.filter((t) => t.due_at && new Date(t.due_at) < now).length };
    })
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  const unassigned = tasks.filter((t) => !t.assignee_id).length;
  const busiest = Math.max(1, ...workload.map((w) => w.open));

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
            {group.course_code ? <Badge tone="accent">{group.course_code}</Badge> : null}
            {isOwner ? <Badge>owner</Badge> : null}
          </div>
          {group.description ? <p className="mt-1 max-w-3xl text-sm text-muted">{group.description}</p> : null}
        </div>
        {!isOwner ? (
          <InlineAction action={removeMember} fields={{ group_id: group.id, user_id: user.id }} confirm="Leave this group? You also leave the projects you joined through it, and your tasks there become unassigned." variant="secondary" size="md">
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
            <CardHeader title="Coming up" description="Milestones and task deadlines of the group's projects, with who has each task." />
            {milestones?.length || dueSoon.length ? (
              <ul className="divide-y divide-border">
                {(milestones ?? []).map((m) => {
                  const project = projectById.get(m.project_id);
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <Link href={`/projects/${m.project_id}#milestones`} className="flex min-w-0 items-center gap-2 hover:text-accent">
                        <Flag className={m.hard ? "size-3.5 shrink-0 text-danger" : "size-3.5 shrink-0 text-muted"} aria-label={m.hard ? "Hard deadline" : "Milestone"} />
                        <span className="truncate font-medium">{m.title}</span>
                        {project ? <span className="shrink-0 text-[12px] text-muted">{project.name}</span> : null}
                      </Link>
                      <span className={m.due_on < todayKey ? "shrink-0 text-[12px] text-danger" : "shrink-0 text-[12px] text-muted"}>{formatDayKey(m.due_on, todayKey)}</span>
                    </li>
                  );
                })}
                {dueSoon.map((task) => {
                  const project = task.project_id ? projectById.get(task.project_id) : null;
                  const overdue = new Date(task.due_at!) < now;
                  return (
                    <li key={task.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <Link href={`/projects/${task.project_id}#tasks`} className="flex min-w-0 items-center gap-2 hover:text-accent">
                        {project ? <ColorDot color={project.color} size={8} /> : null}
                        <span className="truncate">{task.title}</span>
                        <span className={task.assignee_id ? "shrink-0 text-[12px] text-muted" : "shrink-0 text-[12px] text-warn"}>
                          {task.assignee_id ? (names.get(task.assignee_id) ?? "another member") : "unassigned"}
                        </span>
                      </Link>
                      <span className={overdue ? "shrink-0 text-[12px] text-danger" : "shrink-0 text-[12px] text-muted"}>{formatDue(task.due_at!, tz, now)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="Nothing due soon">Milestones and dated tasks of the group&apos;s projects show up here.</EmptyState>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Projects"
              description="Everyone in the group is a member of these projects. The project lead assigns tasks and decides who may change each one."
            />
            {links.length ? (
              <ul className="divide-y divide-border">
                {links.map(({ project, role }) => {
                  const progress = projectProgress(project);
                  const canUnlink = project.owner_id === user.id || isOwner;
                  return (
                    <li key={project.id} className="flex items-center gap-3 px-4 py-3">
                      <Link href={`/projects/${project.id}`} className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <ColorDot color={project.color} size={8} />
                          <span className="truncate">{project.name}</span>
                          {project.status !== "active" ? <Badge>{project.status}</Badge> : null}
                          {project.items_attention ? <Badge tone="warn">{project.items_attention} attention</Badge> : null}
                        </span>
                        <span className="mt-1.5 flex items-center gap-2">
                          <ProgressBar value={progress.ratio} tone="ok" className="max-w-48" label={`${project.name} progress`} />
                          <span className="shrink-0 text-[12px] text-muted">
                            {progress.basis === "checklist" ? `${progress.done}/${progress.countable} done` : "no checklist"}, led by {names.get(project.owner_id) ?? "someone outside the group"}, members join as{" "}
                            {ROLE_LABELS[role].toLowerCase()}
                          </span>
                        </span>
                      </Link>
                      {canUnlink ? (
                        <InlineAction
                          action={unlinkGroup}
                          fields={{ group_id: group.id, project_id: project.id }}
                          confirm="Unlink this project? Members who joined through the group leave it and their tasks become unassigned."
                          title="Unlink project"
                        >
                          <Unlink className="size-3.5" aria-label="Unlink" />
                        </InlineAction>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No projects yet">Link a project you lead: the whole group joins it and you can hand out tasks.</EmptyState>
            )}
            {linkable.length ? (
              <CardBody className="border-t border-border">
                <form action={linkGroup} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="group_id" value={group.id} />
                  <label htmlFor="link-project" className="text-[13px] font-medium">
                    Link a project you lead
                  </label>
                  <Select id="link-project" name="project_id" className="w-auto min-w-40 flex-1">
                    {linkable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <label htmlFor="link-role" className="sr-only">
                    Role of the group&apos;s members
                  </label>
                  <Select id="link-role" name="role" defaultValue="editor" className="w-auto">
                    <option value="editor">as editors</option>
                    <option value="viewer">as members</option>
                  </Select>
                  <button className={buttonClass("secondary", "md")}>Link</button>
                </form>
              </CardBody>
            ) : null}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {links.length ? (
            <Card>
              <CardHeader title="Workload" description={`Open tasks assigned in the group's projects${unassigned ? `; ${unassigned} still unassigned` : ""}.`} />
              <ul className="flex flex-col gap-2 px-4 py-3">
                {workload.map((w) => (
                  <li key={w.id} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-[13px]">
                    <span className="truncate">{w.name}</span>
                    <ProgressBar value={w.open / busiest} tone={w.overdue ? "warn" : "accent"} label={`${w.name}: ${w.open} open tasks`} />
                    <span className="text-right text-[12px] text-muted tabular-nums">
                      {w.open}
                      {w.overdue ? <span className="text-danger"> · {w.overdue} late</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

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
                <GroupForm group={{ id: group.id, name: group.name, description: group.description, color: group.color, course_code: group.course_code }} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

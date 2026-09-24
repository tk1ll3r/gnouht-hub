import { Mail, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GroupForm } from "@/components/group-forms";
import { Badge, buttonClass, Card, CardBody, CardHeader, ColorDot, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadGroups, loadMyInvites } from "@/lib/groups";
import { acceptInvite } from "./actions";

export const metadata: Metadata = { title: "Groups" };

export default async function GroupsPage({ searchParams }: PageProps<"/groups">) {
  const params = await searchParams;
  const { user, supabase } = await requireUser();
  const [groups, invites] = await Promise.all([loadGroups(supabase, user.id), loadMyInvites(supabase, user.email)]);

  return (
    <>
      <PageHeader title="Study groups" description="Share project progress and find times when everyone is free. Your own tasks and calendar stay private." />
      {params.error === "invite" ? (
        <p role="alert" className="mb-5 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          That invite is no longer valid, or it was sent to a different email address.
        </p>
      ) : null}

      {invites.length ? (
        <Card className="mb-6">
          <CardHeader title="Invitations" description="Groups that invited your email address." />
          <ul className="divide-y divide-border">
            {invites.map((invite) => {
              const group = invite.groups as { name: string; color: string } | null;
              return (
                <li key={invite.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="flex items-center gap-2 text-sm">
                    <Mail className="size-4 text-muted" />
                    {group ? <ColorDot color={group.color} /> : null}
                    <span className="font-medium">{group?.name ?? "A group"}</span>
                  </span>
                  <form action={acceptInvite}>
                    <input type="hidden" name="id" value={invite.id} />
                    <button className={buttonClass("primary", "sm")}>Join</button>
                  </form>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {groups.length ? (
          <div className="grid h-fit gap-3 sm:grid-cols-2">
            {groups.map((group) => (
              <Link key={group.id} href={`/groups/${group.id}`} className="group block">
                <Card className="h-full transition-colors group-hover:border-accent/50">
                  <CardBody className="flex flex-col gap-2 py-4">
                    <p className="flex items-center gap-2 font-medium">
                      <ColorDot color={group.color} />
                      <span className="truncate">{group.name}</span>
                      {group.role === "owner" ? <Badge className="ml-auto">owner</Badge> : null}
                    </p>
                    {group.description ? <p className="line-clamp-2 text-[13px] text-muted">{group.description}</p> : null}
                    <p className="mt-auto flex items-center gap-3 text-[12px] text-muted">
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3.5" /> {`${group.members} member${group.members === 1 ? "" : "s"}`}
                      </span>
                      <span>{`${group.sharedProjects} shared project${group.sharedProjects === 1 ? "" : "s"}`}</span>
                    </p>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="h-fit">
            <EmptyState title="No groups yet">Create one for a course project or a study circle, then invite classmates by email.</EmptyState>
          </Card>
        )}
        <Card className="h-fit">
          <CardHeader title="New group" />
          <CardBody>
            <GroupForm />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

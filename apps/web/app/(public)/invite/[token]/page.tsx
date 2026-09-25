import { maskLabel } from "@hub/core/protocol";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { acceptInvite } from "@/app/(app)/groups/actions";
import { signOut } from "@/app/(app)/actions";
import { buttonClass, Card, ColorDot } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";
import { sha256Hex } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Invitation", referrer: "no-referrer" };

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="w-full max-w-sm p-6">
      <h1 className="mb-3 text-base font-semibold">{title}</h1>
      <div className="flex flex-col gap-4 text-sm text-muted">{children}</div>
    </Card>
  );
}

/**
 * Landing page of an emailed invite. The token only identifies the invite; accepting also requires being
 * signed in with the invited address, so a forwarded or leaked link is useless to anyone else.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) {
    return <Shell title="Invalid invitation">This link is not a valid invitation.</Shell>;
  }

  const admin = createAdminClient();
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const { data: allowed } = await admin.rpc("hit_rate_limit", { p_bucket: `invitepage:${ip}`, p_limit: 30, p_window_seconds: 600 });
  if (allowed === false) return <Shell title="Slow down">Too many attempts. Try again in a few minutes.</Shell>;

  const { data: invite } = await admin
    .from("group_invites")
    .select("id, email, expires_at, accepted_at, revoked_at, invited_by, groups(id, name, color)")
    .eq("token_hash", sha256Hex(token))
    .maybeSingle();
  const group = invite?.groups as { id: string; name: string; color: string } | null;
  const user = await getSessionUser();

  if (!invite || !group || invite.revoked_at || invite.accepted_at || new Date(invite.expires_at) <= new Date()) {
    const joined = invite?.accepted_at && user && invite.email === user.email?.toLowerCase();
    return (
      <Shell title={joined ? "Already joined" : "Invitation no longer valid"}>
        {joined ? (
          <Link href={`/groups/${group?.id}`} className={buttonClass("primary")}>
            Open {group?.name ?? "the group"}
          </Link>
        ) : (
          <p>It was revoked, already used or has expired. Ask the group owner for a new one.</p>
        )}
      </Shell>
    );
  }

  const { data: inviter } = invite.invited_by
    ? await admin.from("profiles").select("display_name").eq("id", invite.invited_by).maybeSingle()
    : { data: null };
  const masked = maskLabel(invite.email);
  const title = `Join ${group.name}`;

  return (
    <Shell title={title}>
      <p className="flex items-center gap-2 text-text">
        <ColorDot color={group.color} />
        <span>
          <strong className="font-medium">{inviter?.display_name || "A classmate"}</strong> invited <strong className="font-medium">{masked}</strong> to this study
          group.
        </span>
      </p>
      {!user ? (
        <>
          <p>Sign in with that address to accept. New to the hub? The invite lets that address register.</p>
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className={buttonClass("primary")}>
            Sign in to accept
          </Link>
        </>
      ) : user.email?.toLowerCase() !== invite.email ? (
        <>
          <p>
            You are signed in as <strong className="font-medium text-text">{user.email}</strong>, but this invite is for {masked}.
          </p>
          <form action={signOut}>
            <button className={buttonClass("secondary", "md", "w-full")}>Sign out and switch account</button>
          </form>
        </>
      ) : (
        <form action={acceptInvite}>
          <input type="hidden" name="id" value={invite.id} />
          <button className={buttonClass("primary", "md", "w-full")}>Join the group</button>
        </form>
      )}
      <p className="text-[12px]">Members see projects you choose to share and, if you opt in, when you are free. Your own tasks and calendar stay private.</p>
    </Shell>
  );
}

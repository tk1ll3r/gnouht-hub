"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { inviteEmail, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { allow } from "@/lib/rate-limit";
import type { ActionState } from "@/lib/utils";
import { fieldErrors, formObject, uuid } from "@/lib/validation";

const groupSchema = z.object({
  name: z.string().trim().min(1, "Required").max(80),
  description: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => v || null),
  course_code: z
    .string()
    .trim()
    .max(40)
    .regex(/^[\p{L}\p{N}._\- ]*$/u, "Letters, digits, dots and dashes only")
    .transform((v) => v.toUpperCase() || null)
    .catch(null),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
});

const inviteSchema = z.object({
  group_id: uuid,
  email: z.email("Enter a valid email address").max(254).transform((v) => v.trim().toLowerCase()),
  days: z.coerce.number().int().min(1).max(14).catch(7),
});

export async function createGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  if (!(await allow(`group:${user.id}`, 10, 3600))) return { message: "Too many new groups in an hour." };
  const parsed = groupSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { data, error } = await supabase.rpc("create_group", {
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? undefined,
    p_color: parsed.data.color,
    p_course_code: parsed.data.course_code ?? undefined,
  });
  if (error || !data) return { message: error?.message.includes("20 groups") ? "You are already in 20 groups." : "Could not create the group." };
  redirect(`/groups/${data}`);
}

export async function updateGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  const parsed = groupSchema.safeParse(formObject(formData));
  if (!id.success) return { message: "Unknown group." };
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  // RLS lets only owners update; for anyone else this matches no row.
  const { data, error } = await supabase.from("groups").update(parsed.data).eq("id", id.data).select("id");
  if (error || !data?.length) return { message: "Only group owners can change the group." };
  refresh();
  return { ok: true, message: "Saved." };
}

export async function deleteGroup(formData: FormData): Promise<void> {
  const { user, supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const { data } = await supabase.from("groups").delete().eq("id", id.data).select("id");
  if (data?.length) await audit(user.id, "group.delete", "group", id.data);
  redirect("/groups");
}

export interface InviteState extends ActionState {
  link?: string;
  emailed?: boolean;
}

/** Creates an email-bound invite, emails it when email is configured, and shows the link once. */
export async function inviteMember(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const { user, supabase } = await requireUser();
  const parsed = inviteSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { group_id, email, days } = parsed.data;
  const { data: token, error } = await supabase.rpc("create_group_invite", { p_group: group_id, p_email: email, p_days: days });
  if (error || !token) {
    if (error?.code === "23505") return { message: `${email} is already a member.` };
    if (error?.message.includes("too many")) return { message: "Too many invites right now. Try again later." };
    return { message: "Could not create the invite." };
  }

  const link = `${env().APP_URL}/invite/${token}`;
  const [{ data: group }, { data: profile }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", group_id).single(),
    supabase.from("profiles").select("display_name").eq("id", user.id).single(),
  ]);
  const expiresOn = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const mail = inviteEmail({ groupName: group?.name ?? "a study group", inviterName: profile?.display_name || user.email || "A classmate", link, expiresOn });
  const { sent } = await sendEmail({ to: email, ...mail });
  refresh();
  return { ok: true, link, emailed: sent, message: sent ? `Invite emailed to ${email}.` : `Invite created for ${email}. Send them this link:` };
}

export async function revokeInvite(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("group_invites").update({ revoked_at: new Date().toISOString() }).eq("id", id.data).is("accepted_at", null);
  refresh();
}

export async function acceptInvite(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) redirect("/groups");
  const { data: groupId, error } = await supabase.rpc("accept_group_invite", { p_invite: id.data });
  if (error || !groupId) redirect("/groups?error=invite");
  redirect(`/groups/${groupId}`);
}

/** Owners remove a member; members remove themselves (leave). RLS enforces which is allowed. */
export async function removeMember(formData: FormData): Promise<void> {
  const { user, supabase } = await requireUser();
  const groupId = uuid.safeParse(formData.get("group_id"));
  const memberId = uuid.safeParse(formData.get("user_id"));
  if (!groupId.success || !memberId.success) return;
  const { data, error } = await supabase.from("group_members").delete().eq("group_id", groupId.data).eq("user_id", memberId.data).select("user_id");
  if (!error && data?.length) {
    await audit(user.id, memberId.data === user.id ? "group.leave" : "group.remove_member", "group", groupId.data, { member: memberId.data });
  }
  if (memberId.data === user.id && !error && data?.length) redirect("/groups");
  refresh();
}

export async function setShareBusy(formData: FormData): Promise<void> {
  const { user, supabase } = await requireUser();
  const groupId = uuid.safeParse(formData.get("group_id"));
  if (!groupId.success) return;
  const share = formData.get("share") === "true";
  await supabase.from("group_members").update({ share_busy: share }).eq("group_id", groupId.data).eq("user_id", user.id);
  await audit(user.id, share ? "group.share_busy_on" : "group.share_busy_off", "group", groupId.data);
  refresh();
}

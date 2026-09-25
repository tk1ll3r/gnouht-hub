import "server-only";
import { availabilityGrid, bestMeetingSlots, DAY_MS, freeIntervals, type Interval } from "@hub/core";
import type { Database } from "@hub/core/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { busyIntervals, classesBetween, loadEvents, loadWorkspace, type DayOptions } from "./data";
import type { AdminClient } from "./supabase/admin";

type Client = SupabaseClient<Database>;

export interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  color: string;
  course_code: string | null;
  role: string;
  members: number;
  projects: number;
}

/** Groups the user belongs to (RLS limits the rows to their memberships and live invites). */
export async function loadGroups(client: Client, userId: string): Promise<GroupSummary[]> {
  const [{ data: groups }, { data: members }, { data: links }] = await Promise.all([
    client.from("groups").select("id, name, description, color, course_code").order("name"),
    client.from("group_members").select("group_id, user_id, role"),
    client.from("project_groups").select("group_id, project_id"),
  ]);
  const mine = new Map((members ?? []).filter((m) => m.user_id === userId).map((m) => [m.group_id, m.role]));
  return (groups ?? [])
    .filter((g) => mine.has(g.id))
    .map((g) => ({
      ...g,
      role: mine.get(g.id)!,
      members: (members ?? []).filter((m) => m.group_id === g.id).length,
      projects: (links ?? []).filter((l) => l.group_id === g.id).length,
    }));
}

/** Live invites addressed to the signed-in user's email (the RLS policy matches on it). */
export async function loadMyInvites(client: Client, email: string | null) {
  if (!email) return [];
  const { data } = await client
    .from("group_invites")
    .select("id, group_id, expires_at, groups(name, color)")
    .eq("email", email.toLowerCase())
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  return data ?? [];
}

export interface GroupAvailability {
  /** Members who opted in and were counted. */
  counted: number;
  grid: ReturnType<typeof availabilityGrid>;
  best: ReturnType<typeof bestMeetingSlots>;
}

/**
 * Free/busy overlap for the next `days` days. Runs with the service role because it needs other
 * members' timetables and events, so the caller MUST have verified membership first. Only free
 * intervals are derived per member and only counts leave this function — no titles, rooms or times
 * of anyone's commitments.
 */
export async function groupAvailability(admin: AdminClient, memberIds: string[], viewer: DayOptions, now: Date, days = 7): Promise<GroupAvailability> {
  const to = new Date(now.getTime() + days * DAY_MS);
  const free: Interval[][] = await Promise.all(
    memberIds.slice(0, 30).map(async (userId) => {
      const workspace = await loadWorkspace(admin, userId);
      const events = await loadEvents(admin, userId, now, to);
      const busy = busyIntervals(classesBetween(workspace, now, to), events);
      const { tz, dayStart, dayEnd } = workspace.options;
      return freeIntervals(now, to, busy, { tz, dayStart, dayEnd, bufferMinutes: 0 });
    }),
  );
  return {
    counted: free.length,
    grid: availabilityGrid(free, now, to, { tz: viewer.tz, dayStart: viewer.dayStart, dayEnd: viewer.dayEnd }),
    best: bestMeetingSlots(free, 60, 6),
  };
}

import "server-only";
import {
  AI_OUTPUT_TOKENS,
  askDocsPrompt,
  briefPrompt,
  formatZoned,
  MAX_EXCERPTS,
  projectSummaryPrompt,
  zonedInstant,
  type AiLanguage,
  type ChatMessage,
} from "@hub/core";
import type { Database, Json } from "@hub/core/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { TodayData } from "./data";
import { formatDue } from "./format";
import { loadRoster } from "./projects";
import type { AdminClient } from "./supabase/admin";

type Client = SupabaseClient<Database>;

/** A device counts as ready for AI when it reported a configured 9router key and was seen recently. */
const DEVICE_FRESH_MS = 15 * 60_000;

export interface AiStatus {
  enabled: boolean;
  language: AiLanguage;
  dailyTokens: number;
  usedToday: number;
  device: { name: string; model: string | null } | null;
}

export async function loadAiStatus(client: Client, userId: string, now: Date = new Date()): Promise<AiStatus> {
  const [{ data: profile }, { data: devices }, { data: jobs }] = await Promise.all([
    client.from("profiles").select("ai_consent_at, ai_daily_tokens, ai_language, timezone").eq("id", userId).single(),
    client.from("devices").select("name, status, last_seen_at").eq("user_id", userId),
    client
      .from("ai_jobs")
      .select("status, reserved_tokens, used_tokens, created_at")
      .eq("user_id", userId)
      .gte("created_at", new Date(now.getTime() - 36 * 3_600_000).toISOString()),
  ]);
  const tz = profile?.timezone ?? "Asia/Ho_Chi_Minh";
  const today = formatZoned(now, "yyyy-MM-dd", tz);
  const usedToday = (jobs ?? [])
    .filter((j) => ["queued", "running", "done"].includes(j.status) && formatZoned(new Date(j.created_at), "yyyy-MM-dd", tz) === today)
    .reduce((sum, j) => sum + (j.used_tokens ?? j.reserved_tokens), 0);
  const ready = (devices ?? []).find((d) => {
    const ai = (d.status as { ai?: { configured?: boolean } } | null)?.ai;
    return ai?.configured && d.last_seen_at && now.getTime() - new Date(d.last_seen_at).getTime() < DEVICE_FRESH_MS;
  });
  return {
    enabled: Boolean(profile?.ai_consent_at),
    language: (profile?.ai_language as AiLanguage) ?? "vi",
    dailyTokens: profile?.ai_daily_tokens ?? 0,
    usedToday,
    device: ready ? { name: ready.name, model: (ready.status as { ai?: { model?: string | null } }).ai?.model ?? null } : null,
  };
}

function nonce(): string {
  return randomBytes(9).toString("base64url");
}

export class AiQueueError extends Error {
  constructor(
    message: string,
    readonly reason: "consent" | "busy" | "budget" | "other",
  ) {
    super(message);
  }
}

async function enqueue(
  admin: AdminClient,
  userId: string,
  kind: keyof typeof AI_OUTPUT_TOKENS,
  messages: ChatMessage[],
  ttlSeconds: number,
  extra: { subject?: string; question?: string; sources?: Json } = {},
): Promise<string> {
  const { data, error } = await admin.rpc("enqueue_ai_job", {
    p_user: userId,
    p_kind: kind,
    p_messages: messages as unknown as Json,
    p_max_output: AI_OUTPUT_TOKENS[kind],
    p_ttl_seconds: ttlSeconds,
    p_subject: extra.subject,
    p_question: extra.question,
    p_sources: extra.sources,
  });
  if (error || !data) {
    const reason = error?.hint === "consent" || error?.hint === "busy" || error?.hint === "budget" ? error.hint : "other";
    throw new AiQueueError(error?.message ?? "could not queue the job", reason);
  }
  return data;
}

/** Morning note from the day's computed facts (used by the daily cron). */
export async function enqueueBrief(admin: AdminClient, userId: string, today: TodayData, language: AiLanguage): Promise<string> {
  const tz = today.workspace.options.tz;
  const messages = briefPrompt(
    {
      nowText: `${formatZoned(today.now, "EEEE d MMMM yyyy, HH:mm", tz)} (${tz})`,
      heuristicMarkdown: today.brief.markdown,
      freeHoursToday: today.freeHoursToday,
      studyBlocks: today.agenda.filter((a) => a.kind === "study").map((a) => `${formatZoned(a.start, "HH:mm", tz)}–${formatZoned(a.end, "HH:mm", tz)} ${a.title.replace(/^Suggested: /, "")}`),
    },
    language,
    nonce(),
  );
  return enqueue(admin, userId, "brief", messages, 3 * 3600);
}

/**
 * Project summary. Facts are read with the user's own client, so RLS decides what the prompt may contain:
 * the files the members share with the project (plus the caller's own), its tasks and milestones.
 */
export async function enqueueProjectSummary(client: Client, admin: AdminClient, userId: string, projectId: string, language: AiLanguage, tz: string) {
  const now = new Date();
  const [{ data: project }, { data: docs }, { data: tasks }, { data: milestones }, roster] = await Promise.all([
    client.from("projects").select("id, name, description, items_total, items_done, items_cut").eq("id", projectId).maybeSingle(),
    client.from("documents").select("id").eq("project_id", projectId).eq("visibility", "project").limit(1000),
    client
      .from("tasks")
      .select("title, status, due_at, assignee_id")
      .eq("project_id", projectId)
      .not("status", "in", "(done,cut)")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200),
    client.from("milestones").select("title, due_on, hard, done").eq("project_id", projectId).order("due_on").limit(100),
    loadRoster(client, projectId),
  ]);
  if (!project) throw new AiQueueError("project not found", "other");
  const docIds = (docs ?? []).map((d) => d.id);
  const { data: items } = docIds.length
    ? await client.from("checklist_items").select("text, status, section, status_changed_at, first_seen_at").in("document_id", docIds.slice(0, 500)).limit(3000)
    : { data: [] };
  const names = new Map(roster.map((m) => [m.user_id, m.display_name]));
  const label = (i: { text: string; section: string | null }) => (i.section ? `${i.text} (${i.section})` : i.text);
  const twoWeeks = now.getTime() - 14 * 86_400_000;
  const countable = project.items_total - project.items_cut;
  const messages = projectSummaryPrompt(
    {
      nowText: formatZoned(now, "EEEE d MMMM yyyy", tz),
      name: project.name,
      description: project.description,
      progress: countable > 0 ? `${project.items_done} of ${countable} items done (${Math.round((project.items_done / countable) * 100)}%)` : "no checklist",
      attention: (items ?? []).filter((i) => i.status === "attention").map(label),
      inProgress: (items ?? []).filter((i) => i.status === "doing").map(label),
      openSample: (items ?? []).filter((i) => i.status === "todo").map(label),
      recentlyDone: (items ?? [])
        .filter((i) => i.status === "done" && new Date(i.status_changed_at).getTime() > twoWeeks && i.status_changed_at !== i.first_seen_at)
        .map(label),
      milestones: (milestones ?? [])
        .filter((m) => !m.done)
        .map((m) => `${m.title}: ${formatDue(zonedInstant(m.due_on, 23 * 60 + 59, tz).toISOString(), tz, now)}${m.hard ? ", hard deadline" : ""}`),
      teamTasks: (tasks ?? []).map((t) => {
        const who = t.assignee_id ? (names.get(t.assignee_id) ?? "a former member") : "unassigned";
        return `${t.title}: ${who}, ${t.status}, ${t.due_at ? formatDue(t.due_at, tz, now) : "no date"}`;
      }),
    },
    language,
    nonce(),
  );
  return enqueue(admin, userId, "project_summary", messages, 15 * 60, { subject: project.id });
}

export interface AskSource {
  n: number;
  documentId: string;
  idx: number;
  projectId: string;
  title: string;
  path: string;
  line: number;
}

/** Retrieves the best passages the user can read and queues a cited answer. Returns null when nothing matches. */
export async function enqueueAsk(client: Client, admin: AdminClient, userId: string, question: string, projectId: string | undefined, language: AiLanguage) {
  const { data: hits } = await client.rpc("search_chunks", { p_query: question, p_project: projectId, p_limit: 24, p_any: true });
  // At most two passages per document so one long file cannot crowd out the others.
  const perDoc = new Map<string, number>();
  const chosen = (hits ?? []).filter((h) => {
    const n = perDoc.get(h.document_id) ?? 0;
    if (n >= 2) return false;
    perDoc.set(h.document_id, n + 1);
    return true;
  }).slice(0, MAX_EXCERPTS);
  if (!chosen.length) return null;

  const { data: docs } = await client.from("documents").select("id, title, path").in("id", [...new Set(chosen.map((h) => h.document_id))]);
  const docById = new Map((docs ?? []).map((d) => [d.id, d]));
  const sources: AskSource[] = chosen.map((h, index) => ({
    n: index + 1,
    documentId: h.document_id,
    idx: h.idx,
    projectId: h.project_id,
    title: docById.get(h.document_id)?.title ?? "Document",
    path: docById.get(h.document_id)?.path ?? "",
    line: h.line,
  }));
  const messages = askDocsPrompt(
    question,
    chosen.map((h) => ({ title: docById.get(h.document_id)?.title ?? "Document", path: docById.get(h.document_id)?.path ?? "", heading: h.heading, content: h.content })),
    language,
    nonce(),
  );
  return enqueue(admin, userId, "ask_docs", messages, 15 * 60, { question, sources: sources as unknown as Json });
}

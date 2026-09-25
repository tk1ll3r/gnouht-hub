"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AiQueueError, enqueueAsk, enqueueProjectSummary, loadAiStatus } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { allow } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "@/lib/utils";
import { uuid } from "@/lib/validation";

const QUEUE_MESSAGES: Record<AiQueueError["reason"], string> = {
  consent: "Turn on the AI assistant in Settings first.",
  busy: "Three AI jobs are already waiting for your PC. Try again when one finishes.",
  budget: "Today's AI token budget is used up. Raise it in Settings or try tomorrow.",
  other: "Could not queue the job.",
};

const askSchema = z.object({
  question: z.string().trim().min(3, "Ask a full question").max(500),
  project: z.union([uuid, z.literal("")]).optional(),
});

export async function askDocuments(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const parsed = askSchema.safeParse({ question: formData.get("question"), project: formData.get("project") ?? "" });
  if (!parsed.success) return { errors: { question: [parsed.error.issues[0]?.message ?? "Invalid question"] } };
  if (!(await allow(`ai:${user.id}`, 20, 600))) return { message: "Too many questions in a few minutes. Wait a little." };

  const status = await loadAiStatus(supabase, user.id);
  if (!status.enabled) return { message: QUEUE_MESSAGES.consent };
  let jobId: string | null;
  try {
    jobId = await enqueueAsk(supabase, createAdminClient(), user.id, parsed.data.question, parsed.data.project || undefined, status.language);
  } catch (err) {
    return { message: err instanceof AiQueueError ? QUEUE_MESSAGES[err.reason] : QUEUE_MESSAGES.other };
  }
  if (!jobId) return { message: "No passage in your documents matches those words, so there is nothing to answer from. Try other words." };
  redirect(`/docs/ask/${jobId}`);
}

export async function summarizeProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("project_id"));
  if (!id.success) return { message: "Unknown project." };
  if (!(await allow(`ai:${user.id}`, 20, 600))) return { message: "Too many requests in a few minutes. Wait a little." };
  const status = await loadAiStatus(supabase, user.id);
  if (!status.enabled) return { message: QUEUE_MESSAGES.consent };
  const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", user.id).single();
  try {
    await enqueueProjectSummary(supabase, createAdminClient(), user.id, id.data, status.language, profile?.timezone ?? "Asia/Ho_Chi_Minh");
  } catch (err) {
    return { message: err instanceof AiQueueError ? QUEUE_MESSAGES[err.reason] : QUEUE_MESSAGES.other };
  }
  refresh();
  return { ok: true, message: status.device ? "Queued. Your PC will write it in a moment." : "Queued. It runs when your PC's agent is online." };
}

export async function cancelAiJob(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.rpc("cancel_ai_job", { p_job: id.data });
  refresh();
}

const settingsSchema = z.object({
  enabled: z.preprocess((v) => v === "on", z.boolean()),
  daily_tokens: z.coerce.number().int().min(0, "At least 0").max(2_000_000, "At most 2,000,000"),
  language: z.enum(["vi", "en"]),
});

export async function saveAiSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { errors: { daily_tokens: [parsed.error.issues[0]?.message ?? "Invalid"] } };
  const { data: profile } = await supabase.from("profiles").select("ai_consent_at").eq("id", user.id).single();
  const wasEnabled = Boolean(profile?.ai_consent_at);
  const { error } = await supabase
    .from("profiles")
    .update({
      ai_consent_at: parsed.data.enabled ? (profile?.ai_consent_at ?? new Date().toISOString()) : null,
      ai_daily_tokens: parsed.data.daily_tokens,
      ai_language: parsed.data.language,
    })
    .eq("id", user.id);
  if (error) return { message: "Could not save." };
  if (wasEnabled !== parsed.data.enabled) await audit(user.id, parsed.data.enabled ? "ai.enable" : "ai.disable", "user", user.id);
  refresh();
  return { ok: true, message: "Saved." };
}

"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { askDocuments, saveAiSettings, summarizeProject } from "@/app/(app)/ai/actions";
import { ActionForm, SubmitButton } from "./forms";
import { Field, Input, Select } from "./ui";

/** Refreshes the page when a queued/running job finishes. Polls a same-origin route; gives up after 5 minutes. */
export function JobWatcher({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/ai/jobs/${jobId}`, { cache: "no-store" });
        const json = (await res.json()) as { status?: string };
        if (json.status && json.status !== "queued" && json.status !== "running") {
          router.refresh();
          return;
        }
      } catch {
        // Network blip: try again on the next tick.
      }
      if (Date.now() - started > 5 * 60_000) {
        setWaiting(false);
        return;
      }
      setTimeout(tick, 2000);
    };
    const first = setTimeout(tick, 1500);
    return () => {
      stopped = true;
      clearTimeout(first);
    };
  }, [jobId, router]);
  return waiting ? null : <p className="text-[13px] text-muted">Still waiting. Reload the page later; the answer is kept.</p>;
}

export function AskForm({ projects, defaultProject }: { projects: { id: string; name: string }[]; defaultProject?: string }) {
  return (
    <ActionForm action={askDocuments} className="flex flex-col gap-2">
      {(state) => (
        <>
          <div className="flex flex-wrap gap-2">
            <Input name="question" required minLength={3} maxLength={500} placeholder="e.g. Khi nào hạn nộp abstract và còn thiếu phần nào?" aria-label="Question" className="min-w-0 flex-1 basis-72" />
            <Select name="project" defaultValue={defaultProject ?? ""} aria-label="Project" className="w-auto">
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <SubmitButton pendingLabel="Queueing…">
              <Sparkles className="size-4" /> Ask
            </SubmitButton>
          </div>
          {state.errors?.question ? <p className="text-[12px] text-danger">{state.errors.question[0]}</p> : null}
        </>
      )}
    </ActionForm>
  );
}

export function SummarizeButton({ projectId, label }: { projectId: string; label: string }) {
  return (
    <ActionForm action={summarizeProject} className="flex flex-col items-start gap-1">
      {() => (
        <>
          <input type="hidden" name="project_id" value={projectId} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Queueing…">
            <Sparkles className="size-3.5" /> {label}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function AiSettingsForm({ enabled, dailyTokens, language }: { enabled: boolean; dailyTokens: number; language: string }) {
  return (
    <ActionForm action={saveAiSettings} className="grid gap-3 sm:grid-cols-2">
      {(state) => (
        <>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="enabled" defaultChecked={enabled} className="mt-0.5 size-4 accent-accent" />
            <span>
              Use the AI assistant
              <span className="block text-[12.5px] text-muted">
                The hub prepares each prompt from your data. The agent on your PC sends it to your own 9router and returns the answer, which is stored here. Prompts are deleted
                once answered.
              </span>
            </span>
          </label>
          <Field label="Daily token budget" htmlFor="ai-tokens" error={state.errors?.daily_tokens} hint="Prompts and answers together. 0 pauses AI.">
            <Input id="ai-tokens" name="daily_tokens" type="number" min={0} max={2000000} step={1000} defaultValue={dailyTokens} />
          </Field>
          <Field label="Answer language" htmlFor="ai-lang">
            <Select id="ai-lang" name="language" defaultValue={language}>
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton variant="secondary">Save</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

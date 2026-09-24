import { ArrowLeft, Loader2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AiAnswer, type CitedSource } from "@/components/ai-answer";
import { JobWatcher } from "@/components/ai-forms";
import { InlineAction } from "@/components/forms";
import { Card, CardBody, CardHeader, Meta } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDue } from "@/lib/format";
import { uuid } from "@/lib/validation";
import { cancelAiJob } from "../../../ai/actions";

export const metadata: Metadata = { title: "Answer" };

const WAITING: Record<string, string> = {
  queued: "Waiting for the agent on your PC to pick this up.",
  running: "Your PC is writing the answer.",
};
const ENDED: Record<string, string> = {
  failed: "The agent could not get an answer",
  expired: "No agent picked this up within 15 minutes. Check that the hub agent is running on your PC, then ask again.",
  cancelled: "You cancelled this question.",
};

export default async function AnswerPage({ params }: PageProps<"/docs/ask/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { user, supabase } = await requireUser();
  const [{ data: job }, { data: profile }] = await Promise.all([
    supabase.from("ai_jobs").select("id, kind, status, question, output, error, sources, created_at, finished_at, used_tokens, model").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", user.id).single(),
  ]);
  if (!job || job.kind !== "ask_docs") notFound();
  const tz = profile?.timezone ?? "Asia/Ho_Chi_Minh";
  const sources = (job.sources ?? []) as unknown as CitedSource[];
  const waiting = job.status === "queued" || job.status === "running";

  return (
    <>
      <Link href="/docs" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-3.5" /> Search
      </Link>
      <h1 className="mb-1 max-w-3xl text-[22px] leading-snug font-semibold tracking-tight">{job.question}</h1>
      <Meta
        className="mb-6 text-[12.5px] text-muted"
        items={[`asked ${formatDue(job.created_at, tz)}`, job.model ? `answered by ${job.model}` : null, job.used_tokens ? `${job.used_tokens.toLocaleString()} tokens` : null]}
      />

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section>
          {waiting ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border p-5">
              <p className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin text-accent motion-reduce:animate-none" /> {WAITING[job.status]}
              </p>
              <JobWatcher jobId={job.id} />
              {job.status === "queued" ? (
                <div>
                  <InlineAction action={cancelAiJob} fields={{ id: job.id }} variant="secondary">
                    Cancel
                  </InlineAction>
                </div>
              ) : null}
            </div>
          ) : job.status === "done" && job.output ? (
            <>
              <AiAnswer output={job.output} sources={sources} className="text-[15px]" />
              <p className="mt-4 text-[12.5px] text-muted">Written by AI from the passages listed here. Check the cited files before relying on it.</p>
            </>
          ) : (
            <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
              {ENDED[job.status] ?? "Something went wrong."}
              {job.status === "failed" && job.error ? `: ${job.error}` : ""}
            </p>
          )}
        </section>

        <Card className="h-fit">
          <CardHeader title="Passages used" description="Found by searching your indexed files, including projects shared with you." />
          <CardBody>
            <ol className="flex flex-col gap-2 text-[13.5px]">
              {sources.map((s) => (
                <li key={s.n} className="flex gap-2">
                  <span className="w-6 shrink-0 font-semibold text-accent">[{s.n}]</span>
                  <Link href={`/projects/${s.projectId}/docs/${s.documentId}`} className="min-w-0 hover:text-accent">
                    <span className="block truncate font-medium">{s.title}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {s.path}, line {s.line}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

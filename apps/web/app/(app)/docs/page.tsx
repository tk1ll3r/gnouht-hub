import { highlightSnippet } from "@hub/core";
import { Search, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AskForm } from "@/components/ai-forms";
import { Badge, buttonClass, Card, CardBody, CardHeader, ColorDot, EmptyState, Input, Meta, PageHeader, Select } from "@/components/ui";
import { loadAiStatus } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { relativeTime } from "@/lib/format";
import { loadProjectOptions } from "@/lib/projects";
import { searchSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Search documents" };

export default async function DocsPage({ searchParams }: PageProps<"/docs">) {
  const params = await searchParams;
  const { q, project } = searchSchema.parse({ q: params.q, project: params.project });
  const { user, supabase } = await requireUser();
  const [projects, ai, { data: recent }] = await Promise.all([
    loadProjectOptions(supabase),
    loadAiStatus(supabase, user.id),
    supabase.from("ai_jobs").select("id, question, status, created_at").eq("kind", "ask_docs").order("created_at", { ascending: false }).limit(5),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  let hits: { chunk_id: number; document_id: string; project_id: string; heading: string | null; content: string; line: number }[] = [];
  let docs = new Map<string, { id: string; title: string; path: string; kind: string }>();
  if (q) {
    const { data } = await supabase.rpc("search_documents", { p_query: q, p_project: project, p_limit: 40 });
    hits = data ?? [];
    const ids = [...new Set(hits.map((h) => h.document_id))];
    if (ids.length) {
      const { data: rows } = await supabase.from("project_documents").select("id, title, path, kind").in("id", ids);
      docs = new Map((rows ?? []).map((r) => [r.id, r]));
    }
  }

  return (
    <>
      <PageHeader title="Search documents" description="Full-text search across every indexed project file. Accents are optional: “tien do” finds “Tiến độ”." />
      <Card className="mb-6">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-4 text-accent" /> Ask your documents
            </span>
          }
          description="An answer written from the best-matching passages, with each claim linked to its file."
        />
        <CardBody>
          {ai.enabled ? (
            <>
              <AskForm projects={projects.map((p) => ({ id: p.id, name: p.name }))} defaultProject={project} />
              {!ai.device ? <p className="mt-2 text-[12.5px] text-warn">No agent with AI set up is online. Questions wait until it is (run hub-agent ai-setup on your PC).</p> : null}
              {recent?.length ? (
                <ul className="mt-4 flex flex-col gap-1 border-t border-border/70 pt-3 text-[13.5px]">
                  {recent.map((q) => (
                    <li key={q.id} className="flex items-baseline justify-between gap-3">
                      <Link href={`/docs/ask/${q.id}`} className="min-w-0 truncate hover:text-accent">
                        {q.question}
                      </Link>
                      <span className="shrink-0 text-[12px] text-muted">
                        {q.status === "done" ? relativeTime(q.created_at) : q.status}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-[13.5px] text-muted">
              Turn on the AI assistant in{" "}
              <Link href="/settings#ai" className="text-accent hover:underline">
                Settings
              </Link>{" "}
              to ask questions. It runs through the 9router on your own PC.
            </p>
          )}
        </CardBody>
      </Card>

      <h2 className="mb-3 text-[15px] font-semibold">Search</h2>
      <form method="get" action="/docs" className="mb-5 flex flex-wrap gap-2" role="search">
        <label htmlFor="docs-q" className="sr-only">
          Search
        </label>
        <Input id="docs-q" name="q" defaultValue={q} placeholder="e.g. hạn nộp abstract" className="min-w-0 flex-1 basis-60" maxLength={200} />
        <label htmlFor="docs-project" className="sr-only">
          Project
        </label>
        <Select id="docs-project" name="project" defaultValue={project ?? ""} className="w-auto">
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.user_id !== user.id ? " (shared)" : ""}
            </option>
          ))}
        </Select>
        <button className={buttonClass("primary")}>
          <Search className="size-4" /> Search
        </button>
      </form>

      {!q ? (
        <Card>
          <EmptyState title={projects.length ? "Type something to search" : "Nothing indexed yet"}>
            {projects.length ? "Matches are ranked with headings weighted above body text." : "Watch a folder with the agent to index your notes and reports."}
          </EmptyState>
        </Card>
      ) : hits.length === 0 ? (
        <Card>
          <EmptyState title="No matches">Try fewer or shorter words. Each word also matches the start of longer ones.</EmptyState>
        </Card>
      ) : (
        <Card>
          <p className="border-b border-border px-4 py-2 text-[12px] text-muted">
            {hits.length}
            {hits.length === 40 ? "+" : ""} matching passages
          </p>
          <ul className="divide-y divide-border">
            {hits.map((hit) => {
              const doc = docs.get(hit.document_id);
              const proj = projectById.get(hit.project_id);
              return (
                <li key={hit.chunk_id}>
                  <Link href={`/projects/${hit.project_id}/docs/${hit.document_id}`} className="block px-4 py-3 hover:bg-surface-2/60">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      {proj ? <ColorDot color={proj.color} size={8} /> : null}
                      <span className="font-medium">{doc?.title ?? "Document"}</span>
                      {hit.heading && hit.heading !== doc?.title ? <span className="text-muted">› {hit.heading}</span> : null}
                      {doc ? <Badge className="ml-auto">{doc.kind}</Badge> : null}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">
                      {highlightSnippet(hit.content, q).map((part, index) =>
                        part.hit ? (
                          <mark key={index} className="hit text-text">
                            {part.text}
                          </mark>
                        ) : (
                          <span key={index}>{part.text}</span>
                        ),
                      )}
                    </p>
                    <Meta className="mt-1 text-[12.5px] text-muted" items={[proj?.name, doc ? `${doc.path}, line ${hit.line}` : null]} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}

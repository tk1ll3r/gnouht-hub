import { highlightSnippet } from "@hub/core";
import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonClass, Card, ColorDot, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadProjectOptions } from "@/lib/projects";
import { searchSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Search documents" };

export default async function DocsPage({ searchParams }: PageProps<"/docs">) {
  const params = await searchParams;
  const { q, project } = searchSchema.parse({ q: params.q, project: params.project });
  const { user, supabase } = await requireUser();
  const projects = await loadProjectOptions(supabase, user.id);
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
      <form method="get" action="/docs" className="mb-5 flex flex-wrap gap-2" role="search">
        <label htmlFor="docs-q" className="sr-only">
          Search
        </label>
        <Input id="docs-q" name="q" defaultValue={q} placeholder="e.g. hạn nộp abstract" className="min-w-0 flex-1 basis-60" autoFocus maxLength={200} />
        <label htmlFor="docs-project" className="sr-only">
          Project
        </label>
        <Select id="docs-project" name="project" defaultValue={project ?? ""} className="w-auto">
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
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
          <EmptyState title="No matches">Try fewer or shorter words — each word also matches as a prefix.</EmptyState>
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
                    <p className="mt-1 truncate text-[12px] text-muted">
                      {proj?.name ?? ""}
                      {doc ? ` · ${doc.path}:${hit.line}` : ""}
                    </p>
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

import { ArrowLeft, Eye, FileCode, FolderTree, ListTree } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentMarkdown } from "@/components/markdown";
import { Badge, ColorDot, Kbd } from "@/components/ui";
import { Breadcrumbs, CodeView, ExplorerTree, languageName, OutlinePanel, outlineTargets, StatusBar } from "@/components/workspace";
import { CopyPathButton, EditorTabs, RegisterFile, WrapToggle } from "@/components/workspace-client";
import { requireUser } from "@/lib/auth";
import { relativeTime } from "@/lib/format";
import { highlightLines } from "@/lib/highlight";
import { cn } from "@/lib/utils";
import { uuid } from "@/lib/validation";
import type { CodeTodo, OutlineSymbol } from "@hub/core";

export const metadata: Metadata = { title: "File" };

/** PDF pages and slides arrive as "## Page N" / "## Slide N" sections of plain text. */
function PlainSections({ content }: { content: string }) {
  const parts = content.split(/^## ((?:Page|Slide) \d+)\s*$/m);
  const sections: { heading: string | null; body: string }[] = [{ heading: null, body: parts[0] ?? "" }];
  for (let i = 1; i < parts.length; i += 2) sections.push({ heading: parts[i]!, body: parts[i + 1] ?? "" });
  return (
    <div className="flex flex-col gap-4 text-sm leading-relaxed">
      {sections
        .filter((s) => s.body.trim() || s.heading)
        .map((s, index) => (
          <section key={index}>
            {s.heading ? <h2 className="mb-1 text-[12px] font-semibold text-muted">{s.heading}</h2> : null}
            <p className="whitespace-pre-wrap">{s.body.trim()}</p>
          </section>
        ))}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * A project file in an editor-like workspace: explorer on the left, open files as tabs, the file with line
 * numbers and highlighting, its outline and TODOs on the right, and a status bar. Read-only: files are
 * edited on the PC and the agent re-syncs them.
 */
export default async function DocumentPage({ params, searchParams }: PageProps<"/projects/[id]/docs/[docId]">) {
  const { id, docId } = await params;
  const query = await searchParams;
  if (!uuid.safeParse(id).success || !uuid.safeParse(docId).success) notFound();
  const { user, supabase } = await requireUser();
  const [{ data: doc }, { data: project }, { data: files }] = await Promise.all([
    supabase.from("project_documents").select("*").eq("id", docId).eq("project_id", id).maybeSingle(),
    supabase.from("projects").select("id, name, color, user_id").eq("id", id).maybeSingle(),
    supabase.from("project_documents").select("id, path, kind, language").eq("project_id", id).order("path").limit(1000),
  ]);
  if (!doc || !project) notFound();

  const outline = asList<OutlineSymbol>(doc.outline);
  const todos = asList<CodeTodo>(doc.todos);
  const isMarkdown = doc.kind === "markdown";
  // Markdown opens rendered; ?view=source shows it with line numbers like any other text file.
  const showSource = !isMarkdown || query.view === "source";
  const lineView = doc.kind === "code" || doc.kind === "text" || (isMarkdown && showSource);
  const lines = lineView ? highlightLines(doc.content, doc.kind === "code" ? doc.language : isMarkdown ? "markdown" : null) : [];
  const mode = lineView ? "lines" : "headings";
  const targets = outlineTargets(outline, mode);
  const name = doc.path.split("/").at(-1) ?? doc.path;
  const tab = { id: doc.id, path: doc.path, kind: doc.kind, language: doc.language };
  const fileContext = {
    projectId: project.id,
    docId: doc.id,
    path: doc.path,
    kind: doc.kind,
    language: doc.language,
    lineCount: lineView ? lines.length : 0,
    symbols: outline.map((s, i) => ({ name: s.name, kind: s.kind, line: s.line, target: targets[i]! })),
  };

  return (
    <>
      <RegisterFile file={fileContext} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link href={`/projects/${project.id}`} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-text">
          <ArrowLeft className="size-3.5" />
          <ColorDot color={project.color} size={8} />
          {project.name}
        </Link>
        <p className="hidden text-[12px] text-muted sm:block">
          <Kbd>Ctrl P</Kbd> open a file <Kbd>Ctrl Shift O</Kbd> symbols <Kbd>?</Kbd> shortcuts
        </p>
      </div>

      <div className="overflow-clip rounded-2xl border border-border bg-surface lg:grid lg:grid-cols-[232px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)_216px]">
        {/* Explorer: a collapsible block on phones, a column from lg up. */}
        <aside className="border-b border-border lg:border-r lg:border-b-0" aria-label="Explorer">
          <details className="group lg:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] text-muted">
              <FolderTree className="size-4" /> Files ({files?.length ?? 0})
            </summary>
            <div className="max-h-72 overflow-y-auto px-1 pb-2">
              <ExplorerTree files={files ?? []} projectId={project.id} currentPath={doc.path} />
            </div>
          </details>
          <div className="hidden lg:sticky lg:top-0 lg:flex lg:max-h-dvh lg:flex-col">
            <p className="flex items-center justify-between px-3 pt-3 pb-1.5 text-[12px] font-semibold text-muted">
              <span>Explorer</span>
              <span className="font-normal">{files?.length ?? 0} files</span>
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
              <ExplorerTree files={files ?? []} projectId={project.id} currentPath={doc.path} />
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-col" aria-label={name}>
          <EditorTabs projectId={project.id} current={tab} />
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
            <Breadcrumbs projectName={project.name} projectId={project.id} path={doc.path} />
            <div className="ml-auto flex items-center gap-1">
              {doc.truncated ? <Badge tone="warn">truncated</Badge> : null}
              {doc.redactions ? <Badge tone="warn">{doc.redactions} secret(s) redacted</Badge> : null}
              {isMarkdown ? (
                <Link
                  href={showSource ? `/projects/${project.id}/docs/${doc.id}` : `/projects/${project.id}/docs/${doc.id}?view=source`}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-text"
                >
                  {showSource ? <Eye className="size-3.5" /> : <FileCode className="size-3.5" />}
                  {showSource ? "Preview" : "Source"}
                </Link>
              ) : null}
              {lineView ? <WrapToggle /> : null}
              <CopyPathButton path={doc.path} />
            </div>
          </div>
          {doc.error ? <p className="mx-3 mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{doc.error}</p> : null}

          <div className={cn("min-h-[50vh] flex-1", !lineView && "px-5 py-4 sm:px-8 sm:py-6")}>
            {!doc.content ? (
              <p className="px-4 py-6 text-sm text-muted">No text could be extracted from this file.</p>
            ) : lineView ? (
              <CodeView lines={lines} />
            ) : isMarkdown ? (
              <DocumentMarkdown className="text-sm">{doc.content}</DocumentMarkdown>
            ) : (
              <PlainSections content={doc.content} />
            )}
          </div>

          <details className="border-t border-border xl:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] text-muted">
              <ListTree className="size-4" /> Outline ({outline.length}){todos.length ? `, ${todos.length} to do` : ""}
            </summary>
            <div className="px-3 pb-3">
              <OutlinePanel outline={outline} todos={todos} mode={mode} />
            </div>
          </details>

          <StatusBar
            items={[
              languageName(doc.kind, doc.language),
              doc.line_count ? `${doc.line_count} lines` : null,
              formatSize(doc.size_bytes),
              doc.modified_at ? `edited ${relativeTime(doc.modified_at)}` : null,
              `indexed ${relativeTime(doc.indexed_at)}`,
              project.user_id !== user.id ? "shared, read-only" : "read-only",
            ]}
          />
        </section>

        <aside className="hidden border-l border-border xl:block" aria-label="Outline">
          <div className="sticky top-0 max-h-dvh overflow-y-auto px-3 py-3">
            <OutlinePanel outline={outline} todos={todos} mode={mode} />
          </div>
        </aside>
      </div>
    </>
  );
}

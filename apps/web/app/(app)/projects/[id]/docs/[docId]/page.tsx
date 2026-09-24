import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentMarkdown } from "@/components/markdown";
import { Badge, Card, CardBody, Meta } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadWorkspace } from "@/lib/data";
import { formatDue } from "@/lib/format";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Document" };

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
            {s.heading ? <h2 className="mb-1 text-[12px] font-semibold tracking-wide text-muted uppercase">{s.heading}</h2> : null}
            <p className="whitespace-pre-wrap">{s.body.trim()}</p>
          </section>
        ))}
    </div>
  );
}

export default async function DocumentPage({ params }: PageProps<"/projects/[id]/docs/[docId]">) {
  const { id, docId } = await params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(docId).success) notFound();
  const { user, supabase } = await requireUser();
  const [{ data: doc }, { data: project }, ws] = await Promise.all([
    supabase.from("project_documents").select("*").eq("id", docId).eq("project_id", id).maybeSingle(),
    supabase.from("projects").select("id, name").eq("id", id).maybeSingle(),
    loadWorkspace(supabase, user.id),
  ]);
  if (!doc || !project) notFound();

  return (
    <>
      <Link href={`/projects/${project.id}`} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-3.5" /> {project.name}
      </Link>
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{doc.title}</h1>
          <Badge>{doc.kind}</Badge>
          {doc.truncated ? <Badge tone="warn">truncated</Badge> : null}
          {doc.redactions ? <Badge tone="warn">{doc.redactions} secret(s) redacted</Badge> : null}
        </div>
        <Meta
          className="mt-1 text-[12.5px] text-muted"
          items={[doc.path, `indexed ${formatDue(doc.indexed_at, ws.options.tz)}`, doc.modified_at ? `edited ${formatDue(doc.modified_at, ws.options.tz)}` : null]}
        />
        {doc.error ? <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{doc.error}</p> : null}
      </header>
      <Card>
        <CardBody className="px-5 py-4 sm:px-8 sm:py-6">
          {!doc.content ? (
            <p className="text-sm text-muted">No text could be extracted from this file.</p>
          ) : doc.kind === "markdown" ? (
            <DocumentMarkdown className="text-sm">{doc.content}</DocumentMarkdown>
          ) : (
            <PlainSections content={doc.content} />
          )}
        </CardBody>
      </Card>
    </>
  );
}

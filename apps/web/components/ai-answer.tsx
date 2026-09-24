import Link from "next/link";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import { linkCitations } from "@hub/core";
import { cn } from "@/lib/utils";

export interface CitedSource {
  n: number;
  documentId: string;
  projectId: string;
  title: string;
  path: string;
  line: number;
}

/**
 * Renders model output. It is untrusted (it may echo injected text), so: no raw HTML, no images, and no
 * clickable links except our own citation links ("[2]" → the cited document). Any other URL is shown as
 * plain text, which blocks both phishing links and image-based data exfiltration.
 */
export function AiAnswer({ output, sources = [], className }: { output: string; sources?: CitedSource[]; className?: string }) {
  const byN = new Map(sources.map((s) => [s.n, s]));
  const components: Components = {
    a({ href, children }) {
      const cite = /^cite:(\d+)$/.exec(href ?? "");
      const source = cite ? byN.get(Number(cite[1])) : undefined;
      if (source) {
        return (
          <Link href={`/projects/${source.projectId}/docs/${source.documentId}`} title={`${source.title} (${source.path}, line ${source.line})`} className="no-underline">
            <sup className="font-semibold text-accent">[{source.n}]</sup>
          </Link>
        );
      }
      return <span>{children}</span>;
    },
    img({ alt }) {
      return <span className="text-muted">{alt ? `[${alt}]` : ""}</span>;
    },
  };
  return (
    <div className={cn("prose-hub", className)}>
      <Markdown
        skipHtml
        components={components}
        urlTransform={(url) => (/^cite:\d+$/.test(url) ? url : defaultUrlTransform(url))}
      >
        {linkCitations(output, sources.length)}
      </Markdown>
    </div>
  );
}

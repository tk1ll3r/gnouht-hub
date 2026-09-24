import { AlertTriangle, CircleDot, Scissors } from "lucide-react";
import { Children, isValidElement, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// The checklist dialect also uses [~] in progress, [!] needs attention and [CẮT]/[-] cut, which GFM
// renders as plain text. Show them with the same icons as the project page.
const MARKERS: { pattern: RegExp; icon: ReactNode; label: string; cut?: boolean }[] = [
  { pattern: /^\[~\]\s*/, icon: <CircleDot className="size-3.5 text-accent" />, label: "In progress" },
  { pattern: /^\[!\]\s*/, icon: <AlertTriangle className="size-3.5 text-warn" />, label: "Needs attention" },
  { pattern: /^\[(?:CẮT|Cắt|cắt|CAT|Cat|cat|-)\]\s*/u, icon: <Scissors className="size-3.5 text-muted" />, label: "Cut", cut: true },
];

function withMarker(children: ReactNode): ReactNode {
  const list = Children.toArray(children);
  const first = list[0];
  if (typeof first !== "string") return children;
  const marker = MARKERS.find((m) => m.pattern.test(first));
  if (!marker) return children;
  const rest = [first.replace(marker.pattern, ""), ...list.slice(1)];
  return (
    <>
      <span className="mr-1.5 inline-block align-[-2px]" role="img" aria-label={marker.label}>
        {marker.icon}
      </span>
      {marker.cut ? <s className="text-muted">{rest}</s> : rest}
    </>
  );
}

// Document content comes from files on the owner's PC (or, in M4, a teammate's). It is rendered
// without raw HTML (react-markdown drops it), with only http(s) links, and without remote images:
// relative links and images cannot resolve here, and remote fetches would leak that a document was opened.
const components: Components = {
  li({ children, className }) {
    const list = Children.toArray(children);
    const hasMarker = typeof list[0] === "string" && MARKERS.some((m) => m.pattern.test(list[0] as string));
    const isTask = className?.includes("task-list-item") || list.some((c) => isValidElement(c) && c.type === "input");
    return <li className={hasMarker || isTask ? "list-none -ml-1" : undefined}>{withMarker(children)}</li>;
  },
  a({ href, children }) {
    if (href && /^https?:\/\//i.test(href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow">
          {children}
        </a>
      );
    }
    return <span title={href ?? undefined}>{children}</span>;
  },
  img({ alt }) {
    return <span className="text-muted">[image{alt ? `: ${alt}` : ""}]</span>;
  },
  input({ checked, type }) {
    // GFM task list checkboxes: display only.
    if (type !== "checkbox") return null;
    return <input type="checkbox" checked={Boolean(checked)} disabled readOnly className="mr-1.5 size-3.5 align-[-2px] accent-accent" />;
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto">
        <table>{children}</table>
      </div>
    );
  },
};

export function DocumentMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-hub prose-doc", className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {children}
      </Markdown>
    </div>
  );
}

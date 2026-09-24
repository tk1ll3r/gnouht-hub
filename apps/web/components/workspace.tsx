import { buildFileTree, headingSlugger, languageLabel, type CodeTodo, type OutlineSymbol, type TreeFolder } from "@hub/core";
import {
  Box,
  Braces,
  ChevronRight,
  Hash,
  ListOrdered,
  Package,
  SquareFunction,
  Table,
  Type,
  Variable,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { HighlightedLine } from "@/lib/highlight";
import { FileIcon } from "./file-icon";
import { cn } from "@/lib/utils";

export interface WorkspaceFile {
  id: string;
  path: string;
  kind: string;
  language: string | null;
}

const INDENT = ["pl-2", "pl-5", "pl-8", "pl-11", "pl-14", "pl-17", "pl-20", "pl-23"];

function TreeLevel({ folder, projectId, currentPath, depth }: { folder: TreeFolder<WorkspaceFile>; projectId: string; currentPath: string; depth: number }) {
  return (
    <ul aria-label={depth ? undefined : "Files"}>
      {folder.children.map((node) => {
        const pad = INDENT[Math.min(depth, INDENT.length - 1)];
        if (node.type === "folder") {
          const open = currentPath.startsWith(`${node.path}/`);
          return (
            <li key={node.path}>
              <details open={open} className="group/folder">
                <summary className={cn("flex cursor-pointer list-none items-center gap-1 rounded-md py-[3px] pr-2 text-[13px] text-muted hover:bg-surface-2 hover:text-text", pad)}>
                  <ChevronRight className="size-3.5 shrink-0 transition-transform group-open/folder:rotate-90" aria-hidden />
                  <span className="truncate">{node.name}</span>
                </summary>
                <TreeLevel folder={node} projectId={projectId} currentPath={currentPath} depth={depth + 1} />
              </details>
            </li>
          );
        }
        const current = node.path === currentPath;
        return (
          <li key={node.path}>
            <Link
              href={`/projects/${projectId}/docs/${node.item.id}`}
              aria-current={current ? "page" : undefined}
              title={node.path}
              className={cn(
                "relative flex items-center gap-1.5 rounded-md py-[3px] pr-2 text-[13px]",
                pad,
                current ? "bg-accent-soft font-medium text-accent" : "text-text hover:bg-surface-2",
              )}
            >
              <span className="w-3.5 shrink-0" aria-hidden />
              <FileIcon kind={node.item.kind} language={node.item.language} />
              <span className="truncate">{node.name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The project's indexed files as a folder tree; folders along the open file's path start expanded. */
export function ExplorerTree({ files, projectId, currentPath }: { files: WorkspaceFile[]; projectId: string; currentPath: string }) {
  return <TreeLevel folder={buildFileTree(files)} projectId={projectId} currentPath={currentPath} depth={0} />;
}

/**
 * Source with line numbers in the margin. Every line is an anchor (#L42) that the outline, search results
 * and "go to line" jump to; the target line gets a highlighter stroke. Text only, classes only: the
 * highlighter never produces markup or inline styles.
 */
export function CodeView({ lines, id = "code-view" }: { lines: HighlightedLine[]; id?: string }) {
  const digits = String(Math.max(lines.length, 1)).length;
  return (
    <div id={id} className="code-view overflow-x-auto" data-digits={Math.min(digits, 6)} data-wrap="false">
      {lines.map((segments, index) => {
        const n = index + 1;
        return (
          <div key={n} id={`L${n}`} className="code-line">
            <a href={`#L${n}`} className="code-ln" aria-label={`Line ${n}`}>
              {n}
            </a>
            <span className="code-text">
              {segments.length
                ? segments.map((s, i) =>
                    s.className ? (
                      <span key={i} className={s.className}>
                        {s.text}
                      </span>
                    ) : (
                      s.text
                    ),
                  )
                : "​"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const SYMBOL_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  heading: { icon: Hash, label: "Heading" },
  module: { icon: Package, label: "Module" },
  class: { icon: Box, label: "Class" },
  interface: { icon: Braces, label: "Interface" },
  type: { icon: Type, label: "Type" },
  enum: { icon: ListOrdered, label: "Enum" },
  function: { icon: SquareFunction, label: "Function" },
  method: { icon: SquareFunction, label: "Method" },
  constant: { icon: Variable, label: "Constant" },
  table: { icon: Table, label: "Table" },
};

export function SymbolIcon({ kind, className }: { kind: string; className?: string }) {
  const entry = SYMBOL_ICONS[kind] ?? SYMBOL_ICONS.function!;
  const Icon = entry.icon;
  return <Icon className={cn("size-3.5 shrink-0", kind === "heading" ? "text-muted" : "text-accent", className)} aria-label={entry.label} />;
}

/** Where an outline entry jumps: a line anchor, or a heading anchor in rendered Markdown. */
export function outlineTargets(outline: OutlineSymbol[], mode: "lines" | "headings"): string[] {
  if (mode === "lines") return outline.map((s) => `#L${s.line}`);
  const slug = headingSlugger();
  return outline.map((s) => `#${slug(s.name)}`);
}

const DEPTH_PAD = ["pl-0", "pl-3", "pl-6", "pl-9", "pl-12", "pl-14", "pl-16", "pl-18", "pl-20"];

export function OutlinePanel({ outline, todos, mode }: { outline: OutlineSymbol[]; todos: CodeTodo[]; mode: "lines" | "headings" }) {
  const targets = outlineTargets(outline, mode);
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="outline-title">
        <h2 id="outline-title" className="mb-1.5 text-[12px] font-semibold text-muted">
          Outline
        </h2>
        {outline.length ? (
          <ul className="flex flex-col">
            {outline.map((symbol, index) => (
              <li key={`${symbol.line}-${index}`} className={DEPTH_PAD[Math.min(symbol.depth, DEPTH_PAD.length - 1)]}>
                <a href={targets[index]} className="flex items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[12.5px] hover:bg-surface-2" title={`Line ${symbol.line}`}>
                  <SymbolIcon kind={symbol.kind} />
                  <span className="min-w-0 truncate">{symbol.name}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">No symbols found in this file.</p>
        )}
      </section>
      {todos.length ? (
        <section aria-labelledby="todos-title">
          <h2 id="todos-title" className="mb-1.5 text-[12px] font-semibold text-muted">
            To do in this file
          </h2>
          <ul className="flex flex-col gap-0.5">
            {todos.map((todo) => (
              <li key={`${todo.line}-${todo.tag}`}>
                <a href={`#L${todo.line}`} className="flex items-baseline gap-1.5 rounded-md px-1.5 py-[3px] text-[12.5px] hover:bg-surface-2">
                  <TodoTag tag={todo.tag} />
                  <span className="min-w-0">{todo.text}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** FIXME and BUG are problems (red pen); TODO, HACK and XXX are notes to self (highlighter). */
export function TodoTag({ tag }: { tag: string }) {
  const urgent = tag === "FIXME" || tag === "BUG";
  return (
    <span className={cn("shrink-0 rounded-[4px] px-1 font-mono text-[10.5px] font-semibold", urgent ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn")}>{tag}</span>
  );
}

export function Breadcrumbs({ projectName, projectId, path }: { projectName: string; projectId: string; path: string }) {
  const parts = path.split("/");
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 overflow-hidden text-[12.5px] text-muted">
      <Link href={`/projects/${projectId}`} className="shrink-0 hover:text-accent">
        {projectName}
      </Link>
      {parts.map((part, index) => (
        <span key={index} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3 shrink-0" aria-hidden />
          <span className={cn("truncate", index === parts.length - 1 && "font-medium text-text")}>{part}</span>
        </span>
      ))}
    </nav>
  );
}

export function StatusBar({ items, end }: { items: ReactNode[]; end?: ReactNode }) {
  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface-2/60 px-3 py-1.5 text-[12px] text-muted">
      {items.filter(Boolean).map((item, index) => (
        <span key={index}>{item}</span>
      ))}
      {end ? <span className="ml-auto">{end}</span> : null}
    </footer>
  );
}

export function languageName(kind: string, language: string | null): string {
  if (kind === "code") return languageLabel(language);
  return { markdown: "Markdown", text: "Plain text", docx: "Word", pdf: "PDF", pptx: "Slides" }[kind] ?? kind;
}

"use client";

import { Check, Copy, TextWrap, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { localSnapshot, rememberFile, subscribeLocal, toggleWrap, writeLocal } from "@/lib/local-state";
import { cn } from "@/lib/utils";
import { usePalette, type FileContext } from "./command-palette";
import { FileIcon } from "./file-icon";

interface Tab {
  id: string;
  path: string;
  kind: string;
  language: string | null;
}

const MAX_TABS = 12;
const NO_TABS: Tab[] = [];

/** Stored tabs plus the current file (refreshed in place, or appended), capped by dropping the oldest others. */
function withCurrent(stored: unknown, current: Tab): Tab[] {
  const list = (Array.isArray(stored) ? stored : []).filter((t): t is Tab => Boolean(t) && typeof t.id === "string" && typeof t.path === "string");
  let next = list.some((t) => t.id === current.id) ? list.map((t) => (t.id === current.id ? current : t)) : [...list, current];
  while (next.length > MAX_TABS) {
    const drop = next.findIndex((t) => t.id !== current.id);
    next = next.filter((_, i) => i !== drop);
  }
  return next;
}

/**
 * Open files of this project, like editor tabs: kept per browser, the current file always among them.
 * Alt+W closes the current tab, Alt+[ and Alt+] move between tabs.
 */
export function EditorTabs({ projectId, current }: { projectId: string; current: Tab }) {
  const { userKey, registerTabs } = usePalette();
  const router = useRouter();
  const key = `${userKey}:tabs:${projectId}`;
  const stored = useSyncExternalStore(
    subscribeLocal,
    () => localSnapshot<Tab[]>(key, NO_TABS),
    () => NO_TABS,
  );
  const tabs = useMemo(() => withCurrent(stored, current), [stored, current]);

  // Persist the merged list (the current file added, the oldest dropped). Merged from the live store, not
  // the render's snapshot: the hydration render still holds the empty server snapshot.
  useEffect(() => {
    const saved = localSnapshot<Tab[]>(key, NO_TABS);
    const merged = withCurrent(saved, current);
    if (merged.map((t) => t.id).join() !== (Array.isArray(saved) ? saved : []).map((t) => t?.id).join()) writeLocal(key, merged);
  }, [key, current]);

  useEffect(() => {
    const index = () => tabs.findIndex((t) => t.id === current.id);
    const go = (tab: Tab | undefined) => tab && router.push(`/projects/${projectId}/docs/${tab.id}`);
    registerTabs({
      next: () => go(tabs[(index() + 1) % tabs.length]),
      prev: () => go(tabs[(index() - 1 + tabs.length) % tabs.length]),
      close: () => close(current.id),
    });
    return () => registerTabs(null);
  });

  function close(id: string) {
    const index = tabs.findIndex((t) => t.id === id);
    const remaining = tabs.filter((t) => t.id !== id);
    writeLocal(key, remaining);
    if (id === current.id) {
      const neighbour = remaining[Math.min(index, remaining.length - 1)];
      router.push(neighbour ? `/projects/${projectId}/docs/${neighbour.id}` : `/projects/${projectId}`);
    }
  }

  return (
    <div role="tablist" aria-label="Open files" className="flex min-w-0 overflow-x-auto border-b border-border bg-surface-2/50">
      {tabs.map((tab) => {
        const active = tab.id === current.id;
        const name = tab.path.split("/").at(-1);
        return (
          <div
            key={tab.id}
            role="presentation"
            className={cn(
              "group relative flex shrink-0 items-center border-r border-border text-[12.5px]",
              active ? "bg-surface text-text" : "text-muted hover:bg-surface/60 hover:text-text",
            )}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                close(tab.id);
              }
            }}
          >
            {active ? <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-accent" /> : null}
            <Link role="tab" aria-selected={active} href={`/projects/${projectId}/docs/${tab.id}`} title={tab.path} className="flex items-center gap-1.5 py-1.5 pr-1 pl-3">
              <FileIcon kind={tab.kind} language={tab.language} />
              <span className="max-w-48 truncate">{name}</span>
            </Link>
            <button
              type="button"
              onClick={() => close(tab.id)}
              className={cn("mr-1.5 rounded p-0.5 hover:bg-surface-2 hover:text-text", active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100")}
              aria-label={`Close ${name}`}
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Tells the palette which file is open (for "go to symbol" and "go to line") and remembers it as recent. */
export function RegisterFile({ file }: { file: FileContext }) {
  const { setFile, userKey } = usePalette();
  useEffect(() => {
    setFile(file);
    rememberFile(userKey, { id: file.docId, projectId: file.projectId, path: file.path, kind: file.kind, language: file.language });
    return () => setFile(null);
  }, [file, setFile, userKey]);
  return null;
}

export function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-text"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(path);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked: nothing to do.
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? "Copied" : "Copy path"}
    </button>
  );
}

/** Word wrap for long lines (Alt+Z), remembered per browser. */
export function WrapToggle() {
  const on = useSyncExternalStore(
    subscribeLocal,
    () => localSnapshot<boolean>("wrap", false) === true,
    () => false,
  );
  useEffect(() => {
    document.getElementById("code-view")?.setAttribute("data-wrap", on ? "true" : "false");
  }, [on]);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={toggleWrap}
      title="Word wrap (Alt+Z)"
      className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] hover:bg-surface-2", on ? "text-accent" : "text-muted hover:text-text")}
    >
      <TextWrap className="size-3.5" aria-hidden />
      Wrap
    </button>
  );
}

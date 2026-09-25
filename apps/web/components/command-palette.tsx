"use client";

import { fuzzyMatch, highlightPositions } from "@hub/core/fuzzy";
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  Command,
  CornerDownLeft,
  FileSearch,
  FolderKanban,
  Gauge,
  Hash,
  Keyboard,
  LogOut,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  TextWrap,
  Users,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clearLocalState, recentFiles, toggleWrap, type RecentFile } from "@/lib/local-state";
import { cn } from "@/lib/utils";
import { FileIcon } from "./file-icon";
import { Kbd } from "./ui";

// ── shared context ────────────────────────────────────────────────────────────

export interface FileContext {
  projectId: string;
  docId: string;
  path: string;
  kind: string;
  language: string | null;
  lineCount: number;
  /** Outline entries with the anchor each one jumps to (#L12, or a heading id in rendered Markdown). */
  symbols: { name: string; kind: string; line: number; target: string }[];
}

interface TabHandlers {
  next(): void;
  prev(): void;
  close(): void;
}

interface PaletteApi {
  userKey: string;
  open(prefix?: string): void;
  setFile(file: FileContext | null): void;
  registerTabs(handlers: TabHandlers | null): void;
}

const PaletteContext = createContext<PaletteApi>({ userKey: "anon", open: () => {}, setFile: () => {}, registerTabs: () => {} });

export function usePalette(): PaletteApi {
  return useContext(PaletteContext);
}

// ── data ──────────────────────────────────────────────────────────────────────

interface PaletteIndex {
  projects: { id: string; name: string; color: string }[];
  files: { id: string; projectId: string; path: string; kind: string; language: string | null }[];
  courses: { id: string; code: string; name: string }[];
}

const INDEX_TTL_MS = 60_000;

// ── keyboard shortcuts ────────────────────────────────────────────────────────

const GO_TO: { key: string; href: string; label: string; icon: LucideIcon }[] = [
  { key: "t", href: "/today", label: "Today", icon: Sun },
  { key: "c", href: "/calendar", label: "Calendar", icon: CalendarDays },
  { key: "o", href: "/courses", label: "Courses", icon: BookOpen },
  { key: "k", href: "/tasks", label: "Tasks", icon: CheckSquare },
  { key: "p", href: "/projects", label: "Projects", icon: FolderKanban },
  { key: "g", href: "/groups", label: "Groups", icon: Users },
  { key: "s", href: "/docs", label: "Search documents", icon: Search },
  { key: "q", href: "/quota", label: "AI quota", icon: Gauge },
];

const MOD = "Ctrl";

export const SHORTCUTS: { group: string; items: { keys: string[]; label: string }[] }[] = [
  {
    group: "Anywhere",
    items: [
      { keys: [MOD, "P"], label: "Go to file, project or course" },
      { keys: [MOD, "K"], label: "Command palette (also Ctrl Shift P, F1)" },
      { keys: ["/"], label: "Search inside files" },
      { keys: ["c"], label: "New task" },
      { keys: [MOD, ","], label: "Settings" },
      { keys: ["?"], label: "This list" },
    ],
  },
  { group: "Go to (press g, then)", items: GO_TO.map((g) => ({ keys: ["g", g.key], label: g.label })) },
  {
    group: "In a file",
    items: [
      { keys: [MOD, "Shift", "O"], label: "Go to symbol" },
      { keys: [MOD, "G"], label: "Go to line" },
      { keys: ["Alt", "Z"], label: "Word wrap" },
      { keys: ["Alt", "W"], label: "Close tab" },
      { keys: ["Alt", "["], label: "Previous tab" },
      { keys: ["Alt", "]"], label: "Next tab" },
    ],
  },
  {
    group: "In the palette",
    items: [
      { keys: [">"], label: "Commands" },
      { keys: ["@"], label: "Symbols in this file" },
      { keys: [":"], label: "Line in this file" },
      { keys: ["#"], label: "Search text in files" },
    ],
  },
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

// ── palette items ─────────────────────────────────────────────────────────────

/** What choosing an item does; run by the provider in the event handler, never during render. */
type Action =
  | { type: "open"; prefix: string }
  | { type: "navigate"; href: string }
  | { type: "jump"; target: string }
  | { type: "wrap" }
  | { type: "copy"; text: string }
  | { type: "help" }
  | { type: "signout" };

interface Item {
  key: string;
  group: string;
  icon: ReactNode;
  label: string;
  labelHits?: number[];
  detail?: string;
  detailHits?: number[];
  hint?: string[];
  score: number;
  action: Action;
}

function Highlighted({ text, hits }: { text: string; hits?: number[] }) {
  if (!hits?.length) return <>{text}</>;
  return (
    <>
      {highlightPositions(text, hits).map((part, i) =>
        part.hit ? (
          <mark key={i} className="bg-transparent font-semibold text-accent">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** Palette entries for the current input: a pure function of the query and the loaded data. */
function buildItems(query: string, index: PaletteIndex | null, file: FileContext | null, recent: RecentFile[]): Item[] {
  const mode = query[0] === ">" ? "command" : query[0] === "@" ? "symbol" : query[0] === ":" ? "line" : query[0] === "#" ? "text" : "file";
  const q = mode === "file" ? query.trim() : query.slice(1).trim();
  const projectById = new Map((index?.projects ?? []).map((p) => [p.id, p]));

  if (mode === "command") {
    const commands: Omit<Item, "score">[] = [
      { key: "cmd:file", group: "Commands", icon: <FileSearch className="size-4" />, label: "Go to file…", hint: [MOD, "P"], action: { type: "open", prefix: "" } },
      ...(file
        ? ([
            { key: "cmd:symbol", group: "Commands", icon: <Hash className="size-4" />, label: "Go to symbol in this file…", hint: [MOD, "Shift", "O"], action: { type: "open", prefix: "@" } },
            { key: "cmd:line", group: "Commands", icon: <CornerDownLeft className="size-4" />, label: "Go to line…", hint: [MOD, "G"], action: { type: "open", prefix: ":" } },
            { key: "cmd:wrap", group: "Commands", icon: <TextWrap className="size-4" />, label: "Toggle word wrap", hint: ["Alt", "Z"], action: { type: "wrap" } },
            { key: "cmd:copy", group: "Commands", icon: <FileSearch className="size-4" />, label: "Copy path of this file", action: { type: "copy", text: file.path } },
          ] satisfies Omit<Item, "score">[])
        : []),
      { key: "cmd:search", group: "Commands", icon: <Search className="size-4" />, label: "Search inside files…", hint: ["/"], action: { type: "open", prefix: "#" } },
      { key: "cmd:ask", group: "Commands", icon: <Sparkles className="size-4" />, label: "Ask your documents", action: { type: "navigate", href: "/docs#ask" } },
      { key: "cmd:task", group: "Commands", icon: <Plus className="size-4" />, label: "New task", hint: ["c"], action: { type: "navigate", href: "/tasks?new=1" } },
      ...GO_TO.map((g): Omit<Item, "score"> => ({ key: `go:${g.key}`, group: "Go to", icon: <g.icon className="size-4" />, label: `Go to ${g.label}`, hint: ["g", g.key], action: { type: "navigate", href: g.href } })),
      { key: "go:settings", group: "Go to", icon: <Settings className="size-4" />, label: "Open Settings", hint: [MOD, ","], action: { type: "navigate", href: "/settings" } },
      { key: "go:security", group: "Go to", icon: <Settings className="size-4" />, label: "Settings: two-step sign-in and account", action: { type: "navigate", href: "/settings#security" } },
      { key: "go:devices", group: "Go to", icon: <Settings className="size-4" />, label: "Settings: devices and the PC agent", action: { type: "navigate", href: "/settings#devices" } },
      { key: "go:ai", group: "Go to", icon: <Settings className="size-4" />, label: "Settings: AI assistant", action: { type: "navigate", href: "/settings#ai" } },
      { key: "go:calendars", group: "Go to", icon: <Settings className="size-4" />, label: "Settings: calendars", action: { type: "navigate", href: "/settings#calendars" } },
      { key: "cmd:help", group: "Commands", icon: <Keyboard className="size-4" />, label: "Keyboard shortcuts", hint: ["?"], action: { type: "help" } },
      { key: "cmd:signout", group: "Commands", icon: <LogOut className="size-4" />, label: "Sign out", action: { type: "signout" } },
    ];
    return commands
      .map((c): Item | null => {
        const m = q ? fuzzyMatch(q, c.label) : { score: 0, positions: [] };
        return m ? { ...c, labelHits: m.positions, score: m.score } : null;
      })
      .filter((c): c is Item => c !== null)
      .sort((a, b) => b.score - a.score);
  }

  if (mode === "symbol") {
    if (!file) return [];
    return file.symbols
      .map((s, i): Item | null => {
        const m = q ? fuzzyMatch(q, s.name) : { score: -i, positions: [] };
        return m
          ? {
              key: `sym:${i}`,
              group: "Symbols",
              icon: <Hash className="size-4" />,
              label: s.name,
              labelHits: m.positions,
              detail: `${s.kind}, line ${s.line}`,
              score: m.score,
              action: { type: "jump", target: s.target },
            }
          : null;
      })
      .filter((s): s is Item => s !== null)
      .sort((a, b) => b.score - a.score);
  }

  if (mode === "line") {
    if (!file) return [];
    const n = Number.parseInt(q, 10);
    if (!q || !Number.isFinite(n)) return [];
    const line = Math.min(Math.max(n, 1), Math.max(file.lineCount, 1));
    return [{ key: "line", group: "Line", icon: <CornerDownLeft className="size-4" />, label: `Go to line ${line}`, detail: `of ${file.lineCount} in ${file.path}`, score: 0, action: { type: "jump", target: `#L${line}` } }];
  }

  if (mode === "text") {
    if (!q) return [];
    const out: Item[] = [];
    if (file) {
      out.push({
        key: "text:project",
        group: "Search",
        icon: <Search className="size-4" />,
        label: `Search “${q}” in this project`,
        score: 1,
        action: { type: "navigate", href: `/docs?q=${encodeURIComponent(q)}&project=${file.projectId}` },
      });
    }
    out.push({ key: "text:all", group: "Search", icon: <Search className="size-4" />, label: `Search “${q}” in all files`, score: 0, action: { type: "navigate", href: `/docs?q=${encodeURIComponent(q)}` } });
    return out;
  }

  // Files, projects and courses.
  const fileItem = (f: { id: string; projectId: string; path: string; kind: string; language: string | null }, score: number, hits: number[], group: string): Item => {
    const cut = f.path.lastIndexOf("/") + 1;
    const folder = f.path.slice(0, Math.max(cut - 1, 0));
    const project = projectById.get(f.projectId)?.name;
    return {
      key: `file:${f.id}`,
      group,
      icon: <FileIcon kind={f.kind} language={f.language} className="size-4" />,
      label: f.path.slice(cut),
      labelHits: hits.filter((h) => h >= cut).map((h) => h - cut),
      detail: [folder, project].filter(Boolean).join(" — "),
      detailHits: hits.filter((h) => h < cut - 1),
      score,
      action: { type: "navigate", href: `/projects/${f.projectId}/docs/${f.id}` },
    };
  };
  if (!q) {
    const out = recent.map((f, i) => fileItem(f, -i, [], "Recently opened"));
    for (const p of (index?.projects ?? []).slice(0, 8)) {
      out.push({ key: `project:${p.id}`, group: "Projects", icon: <FolderKanban className="size-4" />, label: p.name, score: 0, action: { type: "navigate", href: `/projects/${p.id}` } });
    }
    return out;
  }
  const scored: Item[] = [];
  for (const f of index?.files ?? []) {
    const m = fuzzyMatch(q, f.path);
    if (m) scored.push(fileItem(f, m.score, m.positions, "Files"));
  }
  for (const p of index?.projects ?? []) {
    const m = fuzzyMatch(q, p.name);
    if (m) scored.push({ key: `project:${p.id}`, group: "Projects", icon: <FolderKanban className="size-4" />, label: p.name, labelHits: m.positions, detail: "project", score: m.score + 2, action: { type: "navigate", href: `/projects/${p.id}` } });
  }
  for (const c of index?.courses ?? []) {
    const label = `${c.code} ${c.name}`;
    const m = fuzzyMatch(q, label);
    if (m) scored.push({ key: `course:${c.id}`, group: "Courses", icon: <BookOpen className="size-4" />, label, labelHits: m.positions, detail: "course", score: m.score + 1, action: { type: "navigate", href: `/courses/${c.id}` } });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 60);
}

// ── provider ──────────────────────────────────────────────────────────────────

/**
 * Keyboard-first navigation, VS Code style: Ctrl+P opens files, projects and courses; a leading ">"
 * turns the box into the command list, "@" lists the open file's symbols, ":" jumps to a line and "#"
 * searches inside files. The file index comes from /api/palette under the user's own RLS.
 */
export function PaletteProvider({ userKey, signOutAction, children }: { userKey: string; signOutAction: () => Promise<void>; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const signOutRef = useRef<HTMLFormElement>(null);
  const tabsRef = useRef<TabHandlers | null>(null);
  const [file, setFileState] = useState<FileContext | null>(null);
  const fileRef = useRef<FileContext | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [index, setIndex] = useState<PaletteIndex | null>(null);
  const [indexState, setIndexState] = useState<"idle" | "loading" | "error">("idle");
  const loadedAt = useRef(0);
  const [recent, setRecent] = useState<RecentFile[]>([]);

  const setFile = useCallback((next: FileContext | null) => {
    fileRef.current = next;
    setFileState(next);
  }, []);
  const registerTabs = useCallback((handlers: TabHandlers | null) => {
    tabsRef.current = handlers;
  }, []);

  const loadIndex = useCallback(async () => {
    if (Date.now() - loadedAt.current < INDEX_TTL_MS) return;
    loadedAt.current = Date.now();
    setIndexState("loading");
    try {
      const res = await fetch("/api/palette", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setIndex((await res.json()) as PaletteIndex);
      setIndexState("idle");
    } catch {
      loadedAt.current = 0;
      setIndexState("error");
    }
  }, []);

  const open = useCallback(
    (prefix = "") => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      helpRef.current?.close();
      setQuery(prefix);
      setActive(0);
      setRecent(recentFiles(userKey));
      if (!dialog.open) dialog.showModal();
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(prefix.length, prefix.length);
      });
      void loadIndex();
    },
    [loadIndex, userKey],
  );

  const close = useCallback(() => dialogRef.current?.close(), []);
  const navigate = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );
  const jump = useCallback(
    (target: string) => {
      close();
      // Setting the hash scrolls to the anchor and lets :target mark the line.
      window.location.hash = target.replace(/^#/, "");
    },
    [close],
  );
  const signOut = useCallback(() => {
    clearLocalState();
    signOutRef.current?.requestSubmit();
  }, []);
  const showHelp = useCallback(() => {
    close();
    helpRef.current?.showModal();
  }, [close]);
  const run = (action: Action | undefined) => {
    if (!action) return;
    if (action.type === "open") open(action.prefix);
    else if (action.type === "navigate") navigate(action.href);
    else if (action.type === "jump") jump(action.target);
    else if (action.type === "help") showHelp();
    else if (action.type === "signout") signOut();
    else {
      close();
      if (action.type === "wrap") toggleWrap();
      else void navigator.clipboard?.writeText(action.text).catch(() => undefined);
    }
  };

  // Global shortcuts.
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const paletteOpen = dialogRef.current?.open;
      const current = fileRef.current;
      if (mod && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "p" && !e.shiftKey) {
          e.preventDefault();
          open("");
        } else if ((key === "p" && e.shiftKey) || (key === "k" && !e.shiftKey)) {
          e.preventDefault();
          open(">");
        } else if (key === "o" && e.shiftKey && current) {
          e.preventDefault();
          open("@");
        } else if (key === "g" && !e.shiftKey && current) {
          e.preventDefault();
          open(":");
        } else if (key === "," && !paletteOpen) {
          e.preventDefault();
          router.push("/settings");
        }
        return;
      }
      if (e.key === "F1") {
        e.preventDefault();
        open(">");
        return;
      }
      if (e.altKey && !mod && current) {
        const actions: Record<string, () => void> = {
          KeyZ: toggleWrap,
          KeyW: () => tabsRef.current?.close(),
          BracketLeft: () => tabsRef.current?.prev(),
          BracketRight: () => tabsRef.current?.next(),
        };
        const action = actions[e.code];
        if (action) {
          e.preventDefault();
          action();
        }
        return;
      }
      if (paletteOpen || helpRef.current?.open || isTyping(e.target) || e.altKey || mod) return;
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const target = GO_TO.find((g) => g.key === e.key.toLowerCase());
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
        return;
      }
      if (e.key === "g") pendingG = Date.now();
      else if (e.key === "?") {
        e.preventDefault();
        helpRef.current?.showModal();
      } else if (e.key === "/") {
        e.preventDefault();
        open("#");
      } else if (e.key === "c") {
        e.preventDefault();
        router.push("/tasks?new=1");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, router]);

  // Close on navigation (e.g. browser back while open).
  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  const items = useMemo(() => buildItems(query, index, file, recent), [query, index, file, recent]);
  const rows = useMemo(() => items.map((item, i) => ({ item, header: i === 0 || items[i - 1]!.group !== item.group ? item.group : null })), [items]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "PageDown" ? 8 : -8;
      setActive((a) => (items.length ? Math.min(Math.max(a + step, 0), items.length - 1) : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(items[active]?.action);
    }
  };

  const mode = query[0] === ">" ? "Commands" : query[0] === "@" ? "Symbols" : query[0] === ":" ? "Go to line" : query[0] === "#" ? "Search in files" : "Files";
  const empty =
    mode === "Files" && !query.trim()
      ? "Type to find a file, project or course. Start with > for commands."
      : (mode === "Symbols" || mode === "Go to line") && !file
        ? "Open a file first."
        : mode === "Go to line"
          ? `Type a line number (1–${file?.lineCount ?? 1}).`
          : mode === "Search in files"
            ? "Type words to search inside files."
            : indexState === "loading"
              ? "Loading your files…"
              : indexState === "error"
                ? "Could not load your files. Try again."
                : "No matches.";

  const api = useMemo<PaletteApi>(() => ({ userKey, open, setFile, registerTabs }), [userKey, open, setFile, registerTabs]);

  return (
    <PaletteContext.Provider value={api}>
      {children}
      <form ref={signOutRef} action={signOutAction} hidden />
      <dialog
        ref={dialogRef}
        aria-label="Command palette"
        className="mx-auto mt-[10vh] w-[min(640px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-text/30"
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Command className="size-4 shrink-0 text-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={items[active] ? `palette-${active}` : undefined}
            aria-label={mode}
            placeholder="Go to file… (> commands, @ symbols, : line, # search)"
            spellCheck={false}
            autoComplete="off"
            className="h-11 min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-muted"
          />
          <span className="shrink-0 text-[11.5px] text-muted">{mode}</span>
        </div>
        <ul ref={listRef} id="palette-results" role="listbox" aria-label={mode} className="max-h-[min(60vh,420px)] overflow-y-auto py-1">
          {items.length === 0 ? <li className="px-4 py-6 text-center text-[13px] text-muted">{empty}</li> : null}
          {rows.map(({ item, header }, i) => {
            return (
              <li key={item.key} role="presentation">
                {header ? <p className="px-3 pt-2 pb-1 text-[11.5px] font-medium text-muted">{header}</p> : null}
                <div
                  id={`palette-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(item.action)}
                  className={cn("mx-1 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5", i === active ? "bg-accent-soft" : "")}
                >
                  <span className={cn("shrink-0", i === active ? "text-accent" : "text-muted")}>{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">
                    <Highlighted text={item.label} hits={item.labelHits} />
                    {item.detail ? (
                      <span className="ml-2 text-[12px] text-muted">
                        <Highlighted text={item.detail} hits={item.detailHits} />
                      </span>
                    ) : null}
                  </span>
                  {item.hint ? (
                    <span className="flex shrink-0 gap-0.5">
                      {item.hint.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="flex flex-wrap gap-x-3 border-t border-border px-3 py-1.5 text-[11.5px] text-muted">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move, <Kbd>Enter</Kbd> to open, <Kbd>Esc</Kbd> to close
          </span>
          <span className="ml-auto">
            <Kbd>&gt;</Kbd> commands <Kbd>@</Kbd> symbols <Kbd>:</Kbd> line <Kbd>#</Kbd> search
          </span>
        </p>
      </dialog>

      <dialog
        ref={helpRef}
        aria-labelledby="shortcuts-title"
        className="mx-auto mt-[8vh] w-[min(720px,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-text/30"
        onClick={(e) => {
          if (e.target === helpRef.current) helpRef.current?.close();
        }}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="shortcuts-title" className="text-[15px] font-semibold">
            Keyboard shortcuts
          </h2>
          <button type="button" className="text-[13px] text-muted hover:text-text" onClick={() => helpRef.current?.close()}>
            Close
          </button>
        </div>
        <div className="grid gap-6 px-5 py-4 sm:grid-cols-2">
          {SHORTCUTS.map((group) => (
            <section key={group.group}>
              <h3 className="mb-2 text-[12.5px] font-medium text-muted">{group.group}</h3>
              <dl className="flex flex-col gap-1.5">
                {group.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 text-[13px]">
                    <dt>{item.label}</dt>
                    <dd className="flex shrink-0 gap-0.5">
                      {item.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="border-t border-border px-5 py-2.5 text-[12px] text-muted">On a Mac, use ⌘ where it says Ctrl. Single-key shortcuts are off while you type in a field.</p>
      </dialog>
    </PaletteContext.Provider>
  );
}

/** Shows the palette from a visible button (the header), for people who do not use shortcuts. */
export function PaletteButton({ className }: { className?: string }) {
  const { open } = usePalette();
  return (
    <button
      type="button"
      onClick={() => open("")}
      className={cn("flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-muted hover:border-accent/40 hover:text-text", className)}
    >
      <Search className="size-3.5" aria-hidden />
      <span className="flex-1 text-left">Go to…</span>
      <Kbd>{MOD} P</Kbd>
    </button>
  );
}

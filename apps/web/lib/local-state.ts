"use client";

// Small per-browser conveniences (recent files, open tabs, word wrap). They hold file names and paths, so
// every key is scoped to the signed-in user and all of them are wiped when this browser signs out.

const PREFIX = "hub:";

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// A tiny external store over localStorage for useSyncExternalStore: snapshots are cached per key so
// React sees a stable value until something writes (here or in another tab).
const cache = new Map<string, unknown>();
const listeners = new Set<() => void>();

export function writeLocal(key: string, value: unknown): void {
  cache.set(key, value);
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or disabled: these are conveniences, nothing breaks without them.
  }
  for (const listener of listeners) listener();
}

export function subscribeLocal(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIX)) {
      if (e.key) cache.delete(e.key.slice(PREFIX.length));
      else cache.clear();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function localSnapshot<T>(key: string, fallback: T): T {
  if (!cache.has(key)) cache.set(key, readLocal(key, fallback));
  return cache.get(key) as T;
}

export function clearLocalState(): void {
  cache.clear();
  try {
    for (const key of Object.keys(window.localStorage)) if (key.startsWith(PREFIX)) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export interface RecentFile {
  id: string;
  projectId: string;
  path: string;
  kind: string;
  language: string | null;
}

const MAX_RECENT = 20;

export function recentFiles(userKey: string): RecentFile[] {
  const list = readLocal<RecentFile[]>(`${userKey}:recent`, []);
  return Array.isArray(list) ? list.filter((f) => f && typeof f.id === "string" && typeof f.path === "string").slice(0, MAX_RECENT) : [];
}

export function rememberFile(userKey: string, file: RecentFile): void {
  writeLocal(`${userKey}:recent`, [file, ...recentFiles(userKey).filter((f) => f.id !== file.id)].slice(0, MAX_RECENT));
}

/** Word wrap in code views: a per-browser preference (the toggle applies it to #code-view). */
export function toggleWrap(): void {
  writeLocal("wrap", localSnapshot<boolean>("wrap", false) !== true);
}

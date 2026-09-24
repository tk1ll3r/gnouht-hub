import { join } from "node:path";
import { CloudClient, CloudError } from "./cloud";
import { HashCache, syncAllFolders, type FolderSyncResult } from "./docsync";
import type { WatchedFolder } from "./documents";
import { MoodleClient } from "./moodle";
import { NineRouterClient } from "./ninerouter";
import { configDir, type AgentConfig, type SecretStore } from "./store";
import { AGENT_VERSION } from "./version";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export const consoleLogger: Logger = {
  info: (m) => console.log(`${new Date().toISOString()} ${m}`),
  warn: (m) => console.warn(`${new Date().toISOString()} WARN ${m}`),
};

export function cloudFor(config: AgentConfig, secrets: SecretStore): CloudClient {
  const secret = secrets.get("device-secret");
  if (!config.deviceId || !secret) throw new Error("This PC is not paired yet — run `hub-agent pair`");
  return new CloudClient(config.hubUrl, config.deviceId, secret);
}

export interface DocumentsStatus {
  folders: number;
  lastSyncAt: string | null;
  errors: string[];
}

export async function sendHeartbeat(cloud: CloudClient, router: NineRouterClient, documents?: DocumentsStatus) {
  const reachable = await router.reachable();
  const loggedIn = reachable ? await router.login().catch(() => false) : false;
  return cloud.post<{ intervals?: Partial<typeof DEFAULT_INTERVALS> }>("/api/agent/heartbeat", {
    agentVersion: AGENT_VERSION,
    ninerouter: { reachable, loggedIn },
    ...(documents ? { documents } : {}),
  });
}

export async function pushQuota(cloud: CloudClient, router: NineRouterClient) {
  const payload = await router.collect();
  return cloud.post<{ windows: number; usage: number }>("/api/agent/quota", payload);
}

export async function pushUit(cloud: CloudClient, moodle: MoodleClient) {
  return cloud.post<{ coursesCreated: number; coursesLinked: number; deadlines: number }>("/api/agent/uit", await moodle.collect());
}

export function documentCache(): HashCache {
  return new HashCache(join(configDir(), "doc-cache.json"));
}

export async function pushDocuments(cloud: CloudClient, folders: WatchedFolder[], cache: HashCache = documentCache()): Promise<FolderSyncResult[]> {
  return syncAllFolders(cloud, folders, cache);
}

export function describeSync(results: FolderSyncResult[]): string {
  return results
    .map((r) =>
      r.archived
        ? `${r.name}: archived in the hub, skipped`
        : `${r.name}: ${r.files} files, ${r.uploaded} uploaded${r.skipped ? `, ${r.skipped} skipped` : ""}${r.truncated ? " (file limit reached)" : ""}${r.errors.length ? `, ${r.errors.length} error(s)` : ""}`,
    )
    .join("; ");
}

const DEFAULT_INTERVALS = { heartbeatSeconds: 60, quotaSeconds: 300, uitSeconds: 6 * 3600, documentsSeconds: 600 };

/** Debounced file watching: a change marks the folders dirty and a sync follows a few seconds later. */
async function watchFolders(folders: WatchedFolder[], onChange: () => void, log: Logger): Promise<() => Promise<void>> {
  if (!folders.length) return async () => {};
  const { watch } = await import("chokidar");
  const watcher = watch(
    folders.map((f) => f.root),
    {
      ignoreInitial: true,
      followSymlinks: false,
      depth: 15,
      // Skip dot folders and heavy build folders; the sync applies the precise include/exclude globs.
      ignored: (path) => /[\\/](?:\.[^\\/]+|node_modules|venv|__pycache__|site-packages|dist|build)(?:[\\/]|$)/.test(path),
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 250 },
    },
  );
  watcher.on("all", onChange);
  watcher.on("error", (err) => log.warn(`file watcher: ${err instanceof Error ? err.message : String(err)}`));
  return () => watcher.close();
}

/**
 * Long-running loop: heartbeat every minute, quota every 5 minutes, documents every 10 minutes (and a few
 * seconds after a watched file changes), UIT every 6 hours. Failures are logged and retried on the next
 * tick; a revoked device (401) stops the agent instead of hammering the hub.
 */
export async function runDaemon(config: AgentConfig, secrets: SecretStore, log: Logger = consoleLogger, signal?: AbortSignal): Promise<void> {
  const cloud = cloudFor(config, secrets);
  const router = new NineRouterClient(config.ninerouterUrl, secrets.get("9router-password"));
  const moodleToken = secrets.get("moodle-token");
  const moodle = moodleToken ? new MoodleClient(config.moodleUrl, moodleToken) : null;
  const intervals = { ...DEFAULT_INTERVALS };
  const last = { heartbeat: 0, quota: 0, uit: 0, documents: 0 };
  const cache = documentCache();
  const docStatus: DocumentsStatus = { folders: config.projects.length, lastSyncAt: null, errors: [] };
  let changedAt = 0;
  const stopWatching = await watchFolders(config.projects, () => (changedAt ||= Date.now()), log).catch((err: unknown) => {
    log.warn(`file watching disabled: ${err instanceof Error ? err.message : String(err)}`);
    return async () => {};
  });
  log.info(`hub-agent ${AGENT_VERSION} running for ${config.hubUrl} (device ${config.deviceName}, ${config.projects.length} watched folder(s))`);

  try {
    while (!signal?.aborted) {
      const now = Date.now();
      // A burst of edits settles for 5 s before syncing; never more often than every 30 s.
      if (changedAt && now - changedAt > 5_000 && now - last.documents > 30_000) last.documents = 0;
      const due = async (key: keyof typeof last, seconds: number, task: () => Promise<string>) => {
        if (now - last[key] < seconds * 1000) return;
        last[key] = now;
        try {
          log.info(await task());
        } catch (err) {
          if (err instanceof CloudError && err.status === 401 && /unauthorized/.test(err.message)) throw err;
          log.warn(`${key}: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      try {
        await due("heartbeat", intervals.heartbeatSeconds, async () => {
          const res = await sendHeartbeat(cloud, router, docStatus);
          if (res.intervals) Object.assign(intervals, res.intervals);
          return "heartbeat ok";
        });
        await due("quota", intervals.quotaSeconds, async () => {
          const res = await pushQuota(cloud, router);
          return `quota pushed (${res.windows} windows, ${res.usage} usage rows)`;
        });
        if (config.projects.length) {
          await due("documents", intervals.documentsSeconds, async () => {
            changedAt = 0;
            const results = await pushDocuments(cloud, config.projects, cache);
            docStatus.lastSyncAt = new Date().toISOString();
            docStatus.errors = results.flatMap((r) => r.errors).slice(0, 10);
            return `documents synced — ${describeSync(results)}`;
          });
        }
        if (moodle) {
          await due("uit", intervals.uitSeconds, async () => {
            const res = await pushUit(cloud, moodle);
            return `UIT synced (${res.coursesCreated} new courses, ${res.deadlines} deadlines)`;
          });
        }
      } catch (err) {
        log.warn(`device rejected by the hub (${err instanceof Error ? err.message : err}) — it was probably revoked. Run \`hub-agent pair\` again.`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  } finally {
    await stopWatching();
  }
}

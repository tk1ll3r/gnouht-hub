import { CloudClient, CloudError } from "./cloud";
import { MoodleClient } from "./moodle";
import { NineRouterClient } from "./ninerouter";
import type { AgentConfig, SecretStore } from "./store";
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

export async function sendHeartbeat(cloud: CloudClient, router: NineRouterClient) {
  const reachable = await router.reachable();
  const loggedIn = reachable ? await router.login().catch(() => false) : false;
  return cloud.post<{ intervals?: { heartbeatSeconds: number; quotaSeconds: number; uitSeconds: number } }>("/api/agent/heartbeat", {
    agentVersion: AGENT_VERSION,
    ninerouter: { reachable, loggedIn },
  });
}

export async function pushQuota(cloud: CloudClient, router: NineRouterClient) {
  const payload = await router.collect();
  return cloud.post<{ windows: number; usage: number }>("/api/agent/quota", payload);
}

export async function pushUit(cloud: CloudClient, moodle: MoodleClient) {
  return cloud.post<{ coursesCreated: number; coursesLinked: number; deadlines: number }>("/api/agent/uit", await moodle.collect());
}

/**
 * Long-running loop: heartbeat every minute, quota every 5 minutes, UIT every 6 hours. Failures are logged
 * and retried on the next tick; a revoked device (401) stops the agent instead of hammering the hub.
 */
export async function runDaemon(config: AgentConfig, secrets: SecretStore, log: Logger = consoleLogger, signal?: AbortSignal): Promise<void> {
  const cloud = cloudFor(config, secrets);
  const router = new NineRouterClient(config.ninerouterUrl, secrets.get("9router-password"));
  const moodleToken = secrets.get("moodle-token");
  const moodle = moodleToken ? new MoodleClient(config.moodleUrl, moodleToken) : null;
  const intervals = { heartbeatSeconds: 60, quotaSeconds: 300, uitSeconds: 6 * 3600 };
  const last = { heartbeat: 0, quota: 0, uit: 0 };
  log.info(`hub-agent ${AGENT_VERSION} running for ${config.hubUrl} (device ${config.deviceName})`);

  while (!signal?.aborted) {
    const now = Date.now();
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
        const res = await sendHeartbeat(cloud, router);
        if (res.intervals) Object.assign(intervals, res.intervals);
        return "heartbeat ok";
      });
      await due("quota", intervals.quotaSeconds, async () => {
        const res = await pushQuota(cloud, router);
        return `quota pushed (${res.windows} windows, ${res.usage} usage rows)`;
      });
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
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

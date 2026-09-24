import { Entry } from "@napi-rs/keyring";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const SERVICE = "gnouht-hub-agent";

/** Secrets live in the OS credential store (Windows Credential Manager / DPAPI), never in files. */
export interface SecretStore {
  get(name: SecretName): string | null;
  set(name: SecretName, value: string): void;
  delete(name: SecretName): void;
}

export type SecretName = "device-secret" | "9router-password" | "moodle-token";

export const keyringStore: SecretStore = {
  get: (name) => new Entry(SERVICE, name).getPassword() ?? null,
  set: (name, value) => new Entry(SERVICE, name).setPassword(value),
  delete: (name) => {
    new Entry(SERVICE, name).deletePassword();
  },
};

/** In-memory store for tests. */
export function memoryStore(initial: Partial<Record<SecretName, string>> = {}): SecretStore {
  const data = new Map(Object.entries(initial)) as Map<SecretName, string>;
  return { get: (n) => data.get(n) ?? null, set: (n, v) => void data.set(n, v), delete: (n) => void data.delete(n) };
}

export const configSchema = z.object({
  hubUrl: z.url().default("https://hub.gnouht.space"),
  deviceId: z.uuid().nullable().default(null),
  deviceName: z.string().default(""),
  ninerouterUrl: z.url().default("http://127.0.0.1:20128"),
  moodleUrl: z.url().default("https://courses.uit.edu.vn"),
  moodleUsername: z.string().nullable().default(null),
});
export type AgentConfig = z.infer<typeof configSchema>;

export function configDir(): string {
  const base = process.env.HUB_AGENT_HOME ?? (process.platform === "win32" ? process.env.APPDATA ?? join(homedir(), "AppData", "Roaming") : join(homedir(), ".config"));
  return process.env.HUB_AGENT_HOME ? base : join(base, "gnouht-hub-agent");
}

export function loadConfig(): AgentConfig {
  try {
    return configSchema.parse(JSON.parse(readFileSync(join(configDir(), "config.json"), "utf8")));
  } catch {
    return configSchema.parse({});
  }
}

export function saveConfig(config: AgentConfig): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(join(configDir(), "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

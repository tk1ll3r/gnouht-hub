import { Entry } from "@napi-rs/keyring";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { DEFAULT_INCLUDE } from "./documents";

export const SERVICE = "gnouht-hub-agent";

/** Secrets live in the OS credential store (Windows Credential Manager / DPAPI), never in files. */
export interface SecretStore {
  get(name: SecretName): string | null;
  set(name: SecretName, value: string): void;
  delete(name: SecretName): void;
}

export type SecretName = "device-secret" | "9router-password" | "9router-api-key" | "moodle-token";

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
  /** 9router model (or combo) used for AI jobs, e.g. "cc/claude-sonnet-4-5". */
  aiModel: z.string().max(120).nullable().default(null),
  /** Watched project folders (`hub-agent project add`). */
  projects: z
    .array(
      z.object({
        root: z.string().min(1),
        name: z.string().trim().min(1).max(120),
        include: z.array(z.string().min(1).max(1000)).max(20).default(DEFAULT_INCLUDE),
        exclude: z.array(z.string().min(1).max(1000)).max(50).default([]),
      }),
    )
    .max(30)
    .default([]),
});
export type AgentConfig = z.infer<typeof configSchema>;

export function configDir(): string {
  const base = process.env.HUB_AGENT_HOME ?? (process.platform === "win32" ? process.env.APPDATA ?? join(homedir(), "AppData", "Roaming") : join(homedir(), ".config"));
  return process.env.HUB_AGENT_HOME ? base : join(base, "gnouht-hub-agent");
}

/**
 * The saved configuration, or defaults when there is none yet. A file that exists but cannot be read or
 * validated is an error: falling back to defaults would silently forget the pairing and watched folders,
 * and the next save would overwrite them.
 */
export function loadConfig(): AgentConfig {
  const path = join(configDir(), "config.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return configSchema.parse({});
    throw new Error(`Cannot read ${path}: ${(err as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON. Fix it, or delete it and pair again.`);
  }
  const parsed = configSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${path} is not a valid configuration (${issue?.path.join(".") || "root"}: ${issue?.message}). Fix it, or delete it and pair again.`);
  }
  return parsed.data;
}

export function saveConfig(config: AgentConfig): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(join(configDir(), "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

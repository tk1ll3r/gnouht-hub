import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { configDir } from "./store";

function startupFolder(): string {
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

const LAUNCHER = "gnouht-hub-agent.cmd";

/**
 * Starts the agent at Windows logon from the user's Startup folder (no admin rights, no service).
 * Output goes to agent.log in the config directory.
 */
export function installStartup(scriptPath: string): string {
  if (process.platform !== "win32") throw new Error("install-startup is only implemented for Windows");
  const log = join(configDir(), "agent.log");
  mkdirSync(configDir(), { recursive: true });
  const target = join(startupFolder(), LAUNCHER);
  const content = [
    "@echo off",
    "rem Started by gnouht hub agent install-startup. Delete this file to disable.",
    `start "gnouht-hub-agent" /min "${process.execPath}" "${scriptPath}" run >> "${log}" 2>&1`,
    "",
  ].join("\r\n");
  writeFileSync(target, content);
  return target;
}

export function uninstallStartup(): void {
  rmSync(join(startupFolder(), LAUNCHER), { force: true });
}

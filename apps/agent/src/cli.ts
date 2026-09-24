import { statSync } from "node:fs";
import { hostname, platform } from "node:os";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CloudError, pairDevice } from "./cloud";
import { processJobs } from "./ai";
import { aiRuntime, cloudFor, describeSync, pushDocuments, pushQuota, pushUit, runDaemon, sendHeartbeat } from "./daemon";
import { checkFolderScope, CODE_PRESET, DEFAULT_INCLUDE, listFolder } from "./documents";
import { fetchMoodleToken, MoodleClient } from "./moodle";
import { chatCompletion, listModels, NineRouterClient } from "./ninerouter";
import { ask, askHidden } from "./prompt";
import { installStartup, uninstallStartup } from "./startup";
import { configDir, keyringStore, loadConfig, saveConfig } from "./store";
import { AGENT_VERSION } from "./version";

const HELP = `gnouht hub agent ${AGENT_VERSION}

  pair [--hub URL] [--name NAME]   Link this PC to your hub with a code from Settings → Devices
  login-9router                    Store the 9router dashboard password (Credential Manager)
  ai-setup [--model NAME]          Store a 9router API key and pick the model for AI jobs
  login-uit                        Get a Moodle token with your UIT account (password is not stored)
  project add <folder> [--name NAME] [--code] [--include GLOBS] [--exclude GLOBS]
                                   Watch a project folder (globs are comma-separated, e.g. "**/*.md,**/*.pdf");
                                   --code also indexes source files for the hub's code view and search
  project code <folder|number> on|off
                                   Start or stop indexing source files of a watched folder
  project list | project remove <folder|number>
  status                           Check hub, 9router and Moodle connectivity
  push-quota | sync-uit | sync-docs | run-jobs
                                   Run one sync now
  run                              Run continuously (used at logon)
  install-startup | uninstall-startup
  logout                           Forget this device and all stored secrets
`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function globs(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const list = value
    .split(",")
    .map((g) => g.trim().replace(/\\/g, "/"))
    .filter(Boolean);
  return list.length ? list : undefined;
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  return norm(a) === norm(b);
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const config = loadConfig();
  const secrets = keyringStore;

  switch (command) {
    case "pair": {
      const hubUrl = flag(args, "--hub") ?? config.hubUrl;
      const name = flag(args, "--name") ?? hostname().slice(0, 60);
      const code = (flag(args, "--code") ?? (await ask("Pairing code from Settings → Devices: "))).replace(/[\s-]/g, "").toUpperCase();
      const { deviceId, secret } = await pairDevice(hubUrl, { code, name, platform: platform() });
      secrets.set("device-secret", secret);
      saveConfig({ ...config, hubUrl, deviceId, deviceName: name });
      console.log(`Paired as "${name}" with ${hubUrl}. Next: hub-agent login-9router, then hub-agent install-startup.`);
      return 0;
    }
    case "login-9router": {
      const password = await askHidden("9router dashboard password: ");
      const router = new NineRouterClient(config.ninerouterUrl, password);
      if (!(await router.reachable())) throw new Error(`9router is not reachable at ${config.ninerouterUrl}`);
      if (!(await router.login())) throw new Error("9router rejected that password");
      secrets.set("9router-password", password);
      console.log("9router login stored in Windows Credential Manager.");
      return 0;
    }
    case "ai-setup": {
      const apiKey = await askHidden("9router API key (Dashboard → API keys): ");
      if (!apiKey) throw new Error("An API key is required");
      const models = await listModels(config.ninerouterUrl, apiKey);
      if (models.length) console.log(`Models this key can use: ${models.slice(0, 30).join(", ")}${models.length > 30 ? ", …" : ""}`);
      const model = (flag(args, "--model") ?? (await ask(`Model for AI jobs${config.aiModel ? ` [${config.aiModel}]` : ""}: `)) ?? "").trim() || config.aiModel;
      if (!model) throw new Error("Pick a model name from the list above");
      // One tiny request proves the key and the model work before anything is stored.
      await chatCompletion(config.ninerouterUrl, apiKey, { model, messages: [{ role: "user", content: "Reply with OK." }], maxTokens: 5 });
      secrets.set("9router-api-key", apiKey);
      saveConfig({ ...config, aiModel: model.slice(0, 120) });
      console.log(`AI jobs will run on ${model}. Turn on the assistant in the hub under Settings → AI assistant.`);
      return 0;
    }
    case "run-jobs": {
      const ai = aiRuntime(config, secrets);
      if (!ai) throw new Error("Run `hub-agent ai-setup` first");
      const res = await processJobs(cloudFor(config, secrets), ai, 10);
      console.log(`AI jobs: ${res.done} answered, ${res.failed} failed.`);
      return 0;
    }
    case "login-uit": {
      const username = (await ask(`UIT username (MSSV) [${config.moodleUsername ?? ""}]: `)) || config.moodleUsername || "";
      if (!username) throw new Error("A username is required");
      // The password is used once to obtain a revocable Moodle token and then dropped.
      const token = await fetchMoodleToken(config.moodleUrl, username, await askHidden("UIT password (not stored): "));
      secrets.set("moodle-token", token);
      saveConfig({ ...config, moodleUsername: username });
      console.log("Moodle token stored. Your password was not saved. Run `hub-agent sync-uit` to import courses.");
      return 0;
    }
    case "status": {
      console.log(`config: ${configDir()}`);
      const router = new NineRouterClient(config.ninerouterUrl, secrets.get("9router-password"));
      console.log(`9router ${config.ninerouterUrl}: ${(await router.reachable()) ? "reachable" : "unreachable"}, ${secrets.get("9router-password") ? "password stored" : "no password stored"}`);
      console.log(`moodle: ${secrets.get("moodle-token") ? "token stored" : "not connected"}`);
      console.log(`ai: ${aiRuntime(config, secrets) ? `ready (${config.aiModel})` : "not set up (hub-agent ai-setup)"}`);
      if (config.deviceId && secrets.get("device-secret")) {
        const res = await sendHeartbeat(cloudFor(config, secrets), router, undefined, aiRuntime(config, secrets));
        console.log(`hub ${config.hubUrl}: paired as "${config.deviceName}" — heartbeat ok (${JSON.stringify(res.intervals)})`);
      } else {
        console.log(`hub ${config.hubUrl}: not paired`);
      }
      return 0;
    }
    case "push-quota": {
      const res = await pushQuota(cloudFor(config, secrets), new NineRouterClient(config.ninerouterUrl, secrets.get("9router-password")));
      console.log(`Pushed ${res.windows} quota windows and ${res.usage} usage rows.`);
      return 0;
    }
    case "sync-uit": {
      const token = secrets.get("moodle-token");
      if (!token) throw new Error("Run `hub-agent login-uit` first");
      const res = await pushUit(cloudFor(config, secrets), new MoodleClient(config.moodleUrl, token));
      console.log(`UIT: ${res.coursesCreated} new, ${res.coursesLinked} linked courses; ${res.deadlines} deadlines.`);
      return 0;
    }
    case "project": {
      const [sub, target] = args;
      if (sub === "add") {
        if (!target) throw new Error("Usage: hub-agent project add <folder> [--name NAME]");
        const root = resolve(target);
        if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${root} is not a folder`);
        const scope = checkFolderScope(root);
        if (scope) throw new Error(scope);
        if (config.projects.some((p) => samePath(p.root, root))) throw new Error("That folder is already watched");
        const code = args.includes("--code");
        const include = globs(flag(args, "--include"));
        const folder = {
          root,
          name: (flag(args, "--name") ?? basename(root)).slice(0, 120),
          include: include ? (code ? [...new Set([...include, ...CODE_PRESET.slice(DEFAULT_INCLUDE.length)])] : include) : code ? CODE_PRESET : DEFAULT_INCLUDE,
          exclude: globs(flag(args, "--exclude")) ?? [],
        };
        const listing = await listFolder(folder);
        const kinds = new Map<string, number>();
        for (const file of listing.files) kinds.set(file.kind, (kinds.get(file.kind) ?? 0) + 1);
        saveConfig({ ...config, projects: [...config.projects, folder] });
        console.log(`Watching "${folder.name}" (${root})`);
        console.log(`  ${listing.files.length} file(s) to index: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(", ") || "none yet"}`);
        if (listing.skipped) console.log(`  ${listing.skipped} file(s) skipped (too large or unusable names)`);
        if (listing.truncated) console.log("  File limit reached — narrow it with --include/--exclude.");
        console.log("  Only these files' text is uploaded (secrets redacted). Run `hub-agent sync-docs` or wait for the agent.");
        return 0;
      }
      if (sub === "list") {
        if (!config.projects.length) console.log("No watched folders. Add one with `hub-agent project add <folder>`.");
        for (const [index, p] of config.projects.entries()) {
          const listing = await listFolder(p);
          console.log(`${index + 1}. ${p.name} — ${p.root} (${listing.files.length} files; include ${p.include.join(",")}${p.exclude.length ? `; exclude ${p.exclude.join(",")}` : ""})`);
        }
        return 0;
      }
      if (sub === "code") {
        const mode = args[2];
        if (!target || (mode !== "on" && mode !== "off")) throw new Error("Usage: hub-agent project code <folder|number> on|off");
        const index = /^\d+$/.test(target) ? Number(target) - 1 : config.projects.findIndex((p) => samePath(p.root, target));
        const folder = config.projects[index];
        if (!folder) throw new Error("No such watched folder (see `hub-agent project list`)");
        const codeGlobs = CODE_PRESET.slice(DEFAULT_INCLUDE.length);
        const include = mode === "on" ? [...new Set([...folder.include, ...codeGlobs])] : folder.include.filter((g) => !codeGlobs.includes(g));
        const updated = { ...folder, include: include.length ? include : DEFAULT_INCLUDE };
        saveConfig({ ...config, projects: config.projects.map((p, i) => (i === index ? updated : p)) });
        const listing = await listFolder(updated);
        const sources = listing.files.filter((f) => f.kind === "code").length;
        console.log(`${mode === "on" ? "Indexing" : "Stopped indexing"} source files in "${folder.name}" (${sources} source file(s) listed now).`);
        return 0;
      }
      if (sub === "remove") {
        if (!target) throw new Error("Usage: hub-agent project remove <folder|number>");
        const index = /^\d+$/.test(target) ? Number(target) - 1 : config.projects.findIndex((p) => samePath(p.root, target));
        const removed = config.projects[index];
        if (!removed) throw new Error("No such watched folder (see `hub-agent project list`)");
        saveConfig({ ...config, projects: config.projects.filter((_, i) => i !== index) });
        console.log(`Stopped watching "${removed.name}". Its data stays in the hub until you delete the project there.`);
        return 0;
      }
      throw new Error("Usage: hub-agent project add|list|code|remove");
    }
    case "sync-docs": {
      if (!config.projects.length) throw new Error("No watched folders — run `hub-agent project add <folder>` first");
      const results = await pushDocuments(cloudFor(config, secrets), config.projects);
      console.log(describeSync(results));
      for (const error of results.flatMap((r) => r.errors).slice(0, 10)) console.log(`  ! ${error}`);
      return results.some((r) => r.projectId === null) ? 1 : 0;
    }
    case "run":
      await runDaemon(config, secrets);
      return 1;
    case "install-startup": {
      console.log(`Installed ${installStartup(fileURLToPath(import.meta.url))}`);
      return 0;
    }
    case "uninstall-startup":
      uninstallStartup();
      console.log("Removed from startup.");
      return 0;
    case "logout":
      for (const name of ["device-secret", "9router-password", "9router-api-key", "moodle-token"] as const) secrets.delete(name);
      saveConfig({ ...config, deviceId: null, deviceName: "" });
      console.log("Forgot the device and every stored secret. Also revoke the device in Settings → Devices.");
      return 0;
    default:
      console.log(HELP);
      return command && command !== "help" ? 1 : 0;
  }
}

// exitCode instead of process.exit(): exiting while fetch sockets are closing aborts Node on Windows.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const message = err instanceof CloudError ? `hub: ${err.message}` : err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    process.exitCode = 1;
  },
);

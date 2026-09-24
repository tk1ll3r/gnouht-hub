import { hostname, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { CloudError, pairDevice } from "./cloud";
import { cloudFor, pushQuota, pushUit, runDaemon, sendHeartbeat } from "./daemon";
import { fetchMoodleToken, MoodleClient } from "./moodle";
import { NineRouterClient } from "./ninerouter";
import { ask, askHidden } from "./prompt";
import { installStartup, uninstallStartup } from "./startup";
import { configDir, keyringStore, loadConfig, saveConfig } from "./store";
import { AGENT_VERSION } from "./version";

const HELP = `gnouht hub agent ${AGENT_VERSION}

  pair [--hub URL] [--name NAME]   Link this PC to your hub with a code from Settings → Devices
  login-9router                    Store the 9router dashboard password (Credential Manager)
  login-uit                        Get a Moodle token with your UIT account (password is not stored)
  status                           Check hub, 9router and Moodle connectivity
  push-quota | sync-uit            Run one sync now
  run                              Run continuously (used at logon)
  install-startup | uninstall-startup
  logout                           Forget this device and all stored secrets
`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
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
      if (config.deviceId && secrets.get("device-secret")) {
        const res = await sendHeartbeat(cloudFor(config, secrets), router);
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
      for (const name of ["device-secret", "9router-password", "moodle-token"] as const) secrets.delete(name);
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

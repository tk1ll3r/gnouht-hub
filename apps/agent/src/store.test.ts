import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CODE_PRESET } from "./documents";
import { loadConfig, saveConfig } from "./store";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hub-agent-store-"));
  process.env.HUB_AGENT_HOME = home;
});
afterEach(() => {
  delete process.env.HUB_AGENT_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("starts from defaults when there is no file yet", () => {
    expect(loadConfig()).toMatchObject({ deviceId: null, projects: [] });
  });

  it("round-trips a folder watched with the --code preset", () => {
    const config = loadConfig();
    saveConfig({ ...config, deviceId: "0b8f4f7e-6d8c-4d8a-9d43-0c6a3c6f1b10", projects: [{ root: "/tmp/x", name: "X", slug: "x-project", projectId: null, include: CODE_PRESET, exclude: [] }] });
    expect(loadConfig().projects[0]!.include).toEqual(CODE_PRESET);
    expect(loadConfig().deviceId).toBe("0b8f4f7e-6d8c-4d8a-9d43-0c6a3c6f1b10");
  });

  it("refuses a damaged file instead of silently forgetting the pairing", () => {
    writeFileSync(join(home, "config.json"), "{ not json");
    expect(() => loadConfig()).toThrow(/not valid JSON/);
    writeFileSync(join(home, "config.json"), JSON.stringify({ deviceId: "not-a-uuid" }));
    expect(() => loadConfig()).toThrow(/deviceId/);
  });
});

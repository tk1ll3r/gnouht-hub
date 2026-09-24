#!/usr/bin/env node
// Runs the Supabase CLI against this repo. On Windows the CLI and Docker live inside WSL, so the call is
// forwarded with `wsl.exe --cd <repo>`; everywhere else (CI, macOS, Linux) the local `supabase` binary is used.
//
//   node scripts/supabase.mjs <supabase args...>
//   node scripts/supabase.mjs --gen-types     # regenerate packages/core/src/db.types.ts from the local DB
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distro = process.env.HUB_WSL_DISTRO ?? "Ubuntu-24.04";
const typesFile = resolve(repoRoot, "packages/core/src/db.types.ts");

function command(args) {
  if (process.platform === "win32") {
    return { cmd: "wsl.exe", args: ["-d", distro, "--cd", repoRoot, "-e", "supabase", ...args] };
  }
  return { cmd: "supabase", args };
}

function run(args, { capture = false } = {}) {
  const { cmd, args: argv } = command(args);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, argv, {
      cwd: repoRoot,
      stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    });
    let out = "";
    if (capture) child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolvePromise(out) : reject(new Error(`supabase exited with ${code}`))));
  });
}

const args = process.argv.slice(2);
try {
  if (args[0] === "--gen-types") {
    const types = await run(["gen", "types", "typescript", "--local", "--schema", "public"], { capture: true });
    writeFileSync(typesFile, types.replace(/\r\n/g, "\n"));
    console.log(`wrote ${typesFile}`);
  } else {
    await run(args);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

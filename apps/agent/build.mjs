// Bundles the agent into one ESM file (dist/hub-agent.mjs). The native keyring binding stays external.
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/hub-agent.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["@napi-rs/keyring"],
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  legalComments: "none",
  logLevel: "info",
});

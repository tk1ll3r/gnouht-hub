import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) },
      // `server-only` throws outside the React server bundle; unit tests exercise server modules directly.
      { find: "server-only", replacement: fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)) },
    ],
  },
  test: {
    name: "web",
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
});

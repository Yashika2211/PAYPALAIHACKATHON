import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/policy/**", "lib/state/**", "lib/agents/protocol.ts", "lib/negotiation/bundle-solver.ts", "lib/ledger.ts", "lib/rate-limit.ts", "lib/paypal/redact.ts"],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});

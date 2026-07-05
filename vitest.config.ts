import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      include: [".pi/extensions/**/*.ts"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@earendil-works/pi-coding-agent": path.resolve(
        "/home/james/.nvm/versions/node/v22.18.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js"
      ),
    },
  },
});

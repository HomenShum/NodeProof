import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The tool-use CLI test spawns the compiled dist/cli.js; give it room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

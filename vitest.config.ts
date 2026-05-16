import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      include: ["lib/scoring/**"],
      thresholds: { lines: 95, functions: 95, branches: 95 },
    },
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
});

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Minimal config so unit tests can import pure helpers using the "@/..." alias.
// Tests target framework-free logic (graph building, agent<->node mapping).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});

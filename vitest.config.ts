import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@profile": path.resolve(__dirname, "src/profile"),
      "@jobs": path.resolve(__dirname, "src/jobs"),
      "@shared": path.resolve(__dirname, "src/shared"),
      "@ui": path.resolve(__dirname, "ui/src")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
  }
});

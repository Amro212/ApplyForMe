import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: path.resolve(__dirname, "ui"),
  plugins: [react()],
  resolve: {
    alias: {
      "@profile": path.resolve(__dirname, "src/profile"),
      "@jobs": path.resolve(__dirname, "src/jobs"),
      "@shared": path.resolve(__dirname, "src/shared"),
      "@ui": path.resolve(__dirname, "ui/src")
    }
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname)]
    }
  },
  build: {
    outDir: path.resolve(__dirname, "dist/client"),
    emptyOutDir: true
  }
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    // The shared SVG artwork lives at the repository root.
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(projectRoot, "index.html"),
        player: resolve(projectRoot, "player.html")
      }
    }
  }
});

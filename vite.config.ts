import { defineConfig } from "vite";

export default defineConfig({
  base: "./", // relative paths, so the build runs from itch.io, GitHub Pages or a plain folder
  build: { chunkSizeWarningLimit: 1500 }, // three.js alone is ~700 kB
});

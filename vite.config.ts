import { defineConfig } from "vite";

const game = process.env.GAME_SERVER ?? "localhost:8080"; // where `npm run server:dev` listens

export default defineConfig({
  base: "./", // relative paths, so the build runs from itch.io, GitHub Pages or a plain folder
  build: { chunkSizeWarningLimit: 1500 }, // three.js alone is ~700 kB
  // the game server in dev
  server: { proxy: { "/ws": { target: `ws://${game}`, ws: true }, "/api": `http://${game}` } },
});

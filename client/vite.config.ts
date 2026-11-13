import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the client runs on :5178 and Vite proxies the server on :3008, so the pages talk to
// one origin exactly as in production.
const server = "http://localhost:3008";
export default defineConfig({
  // Relative asset URLs, so the built page works at the root and under a prefix
  // (/leaderboard/; the server injects <base href="/leaderboard/">).
  base: "./",
  plugins: [react()],
  server: {
    host: true,
    port: 5178,
    proxy: {
      "/api": server,
      "/uploads": server,
      "/__bargames": server,
      "/socket.io": { target: server, ws: true },
    },
  },
});

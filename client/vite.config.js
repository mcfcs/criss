import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev we run the client on 5173 and proxy API + WebSocket to the server on
// 3001. `allowedHosts: true` lets a tunnel host (e.g. cloudflared) reach Vite
// when running as a Discord Activity. In Discord, requests are same-origin and
// routed by the Activity URL mapping (map "/" -> your backend) — see README.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:3001",
      "/ws": { target: "ws://localhost:3001", ws: true },
    },
  },
});

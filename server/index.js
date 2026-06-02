// criss — authoritative realtime server for the Discord crossword game.
//
// Responsibilities:
//   1. POST /api/token  — Discord OAuth2 code -> access_token exchange.
//   2. GET  /api/layouts — list available layouts (for the client menu).
//   3. WebSocket /ws     — realtime game rooms (one shared puzzle per room).
//   4. Serve the built client (../client/dist) in production.
import dotenv from "dotenv";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { Game } from "./game.js";
import { loadPool, layoutCatalog } from "./puzzleStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load the repo-root .env first, then a server/.env if present (local wins).
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config();
const PORT = process.env.PORT || 3001;

const app = express();
app.use(express.json());

// --- Discord OAuth2 token exchange (called by the Activity client) ---
app.post("/api/token", async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "missing code" });
    if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
      return res.status(500).json({ error: "server missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET" });
    }
    const body = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
    });
    const r = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error_description || "token exchange failed" });
    res.json({ access_token: data.access_token });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/layouts", (_req, res) => res.json(layoutCatalog()));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// --- Serve built client in production (no-op if dist isn't built yet) ---
const dist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(dist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
  res.sendFile(path.join(dist, "index.html"), (err) => (err ? next() : null));
});

const server = http.createServer(app);

// ===================== Realtime layer =====================
const wss = new WebSocketServer({ server, path: "/ws" });
const games = new Map(); // roomId -> Game
const sockets = new Map(); // roomId -> Set<ws>
let connSeq = 1;

const getGame = (roomId) => {
  if (!games.has(roomId)) games.set(roomId, new Game(roomId));
  return games.get(roomId);
};
const roomSet = (roomId) => {
  if (!sockets.has(roomId)) sockets.set(roomId, new Set());
  return sockets.get(roomId);
};
const send = (ws, obj) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};
const broadcast = (roomId, obj) => {
  const s = sockets.get(roomId);
  if (!s) return;
  const msg = JSON.stringify(obj);
  for (const ws of s) if (ws.readyState === ws.OPEN) ws.send(msg);
};
const broadcastState = (roomId) => broadcast(roomId, getGame(roomId).publicState());

wss.on("connection", (ws) => {
  ws.connId = connSeq++;
  ws.roomId = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handle(ws, msg);
  });

  ws.on("close", () => {
    if (!ws.roomId) return;
    const game = games.get(ws.roomId);
    if (game) game.removePlayer(ws.connId);
    const s = sockets.get(ws.roomId);
    if (s) {
      s.delete(ws);
      if (s.size === 0) {
        // Last player left: drop the room to free memory.
        sockets.delete(ws.roomId);
        games.delete(ws.roomId);
        return;
      }
    }
    broadcastState(ws.roomId);
  });
});

function handle(ws, msg) {
  switch (msg.type) {
    case "hello": {
      // { type:"hello", room, user:{id, username} }
      const roomId = String(msg.room || "lobby");
      ws.roomId = roomId;
      const game = getGame(roomId);
      roomSet(roomId).add(ws);
      game.addPlayer(ws.connId, {
        id: msg.user?.id || `guest-${ws.connId}`,
        username: msg.user?.username || `Guest ${ws.connId}`,
      });
      // Auto-start a quick game if the room is empty so there's always a board.
      if (!game.hasPuzzle()) {
        try {
          game.newGame({ layoutName: msg.layout || "Mini 5x5 - Open", difficulty: msg.difficulty || null });
        } catch (e) {
          send(ws, { type: "error", message: String(e) });
        }
      }
      broadcastState(roomId);
      break;
    }
    case "new_game": {
      if (!ws.roomId) return;
      const game = getGame(ws.roomId);
      try {
        game.newGame({ layoutName: msg.layout || null, difficulty: msg.difficulty || null });
        broadcastState(ws.roomId);
      } catch (e) {
        send(ws, { type: "error", message: String(e) });
      }
      break;
    }
    case "input": {
      if (!ws.roomId) return;
      const game = games.get(ws.roomId);
      const player = game?.players.get(ws.connId);
      if (!game || !player) return;
      const res = game.applyInput(player.id, msg.row, msg.col, msg.letter);
      if (res) broadcastState(ws.roomId);
      break;
    }
    case "reveal": {
      if (!ws.roomId) return;
      const game = games.get(ws.roomId);
      if (!game) return;
      const res = game.reveal(msg.row, msg.col);
      if (res) broadcastState(ws.roomId);
      break;
    }
    case "ping":
      send(ws, { type: "pong" });
      break;
    default:
      break;
  }
}

// Warm the dataset at boot so the first game isn't slow.
loadPool();
server.listen(PORT, () => {
  console.log(`[criss] server listening on http://localhost:${PORT}`);
  console.log(`[criss] websocket on ws://localhost:${PORT}/ws`);
});

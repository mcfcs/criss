// Shared per-room game store. Both the WebSocket layer (Activity clients) and
// the Discord bot use this single store, so a room's game is the same object
// regardless of which front-end touches it. Listeners are notified on any
// mutation so every surface (WS broadcast, bot message edit) stays in sync.
import { Game } from "./game.js";

const games = new Map(); // roomId -> Game
const listeners = new Set(); // (roomId) => void

export function getGame(roomId) {
  if (!games.has(roomId)) games.set(roomId, new Game(roomId));
  return games.get(roomId);
}

export function hasGame(roomId) {
  return games.has(roomId);
}

export function dropGame(roomId) {
  games.delete(roomId);
}

/** Subscribe to room changes. Returns an unsubscribe function. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Notify all listeners that a room's game state changed. */
export function emitChange(roomId) {
  for (const fn of listeners) {
    try {
      fn(roomId);
    } catch (e) {
      console.error("[gameStore] listener error:", e);
    }
  }
}

// Client for crosswithfriends.com (a Down for a Cross deployment): search the
// public puzzle list, and fetch a full puzzle (grid + clues + solution) by
// joining a game over socket.io — that's the only place the server hands the
// solution to clients. Converts the result into our internal puzzle format.
//
// For personal play with friends, the same way the site itself works. Be a
// good citizen: this fetches a single puzzle on demand, not in bulk.
import { io } from "socket.io-client";

const SITE = "https://www.crosswithfriends.com";
const SOCKET = "https://downforacross-com.onrender.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36";
const headers = { "User-Agent": UA, Referer: `${SITE}/`, Origin: SITE };

const randHex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
const randSlug = (n) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");

/** Search puzzles by title/author. Returns lightweight metadata only. */
export async function searchPuzzles(query, { mini = true, standard = true, page = 0, pageSize = 20 } = {}) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  params.set("filter[nameOrTitleFilter]", query || "");
  if (standard) params.set("filter[sizeFilter][Standard]", "true");
  if (mini) params.set("filter[sizeFilter][Mini]", "true");
  const res = await fetch(`${SITE}/api/puzzle_list?${params}`, { headers });
  if (!res.ok) throw new Error(`search failed (${res.status})`);
  const data = await res.json();
  return (data.puzzles || []).map((p) => {
    const info = p.content?.info || {};
    const grid = p.content?.grid || [];
    return {
      pid: p.pid,
      title: info.titleOverride || info.title || "(untitled)",
      author: (info.author || "").replace(/^By\s+/i, ""),
      type: info.type || "",
      size: grid.length ? `${grid[0].length}x${grid.length}` : "",
      rows: grid.length,
    };
  });
}

/** Fetch a full puzzle by pid and convert it to our internal format. */
export async function fetchPuzzle(pid) {
  const dfacId = randHex(8);
  // Reserve a gid number (fall back to a random number if the counter is down).
  let gidNum;
  try {
    const r = await fetch(`${SITE}/api/counters/gid`, { method: "POST", headers });
    const j = await r.json().catch(() => ({}));
    gidNum = j.gid || j.value || j.count || j.counter;
  } catch {
    /* ignore */
  }
  if (!gidNum) gidNum = 900000000 + Math.floor(Math.random() * 99999999);
  const gid = `${gidNum}-${randSlug(4)}`;

  // Create the game server-side (this loads the puzzle by pid).
  const created = await fetch(`${SITE}/api/game`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ gid, pid, dfac_id: dfacId }),
  });
  if (!created.ok) throw new Error(`create game failed (${created.status})`);

  // Join over socket.io and pull all game events; the first is "create".
  const events = await syncGameEvents(gid, dfacId);
  const createEvent = events.find((e) => e && e.type === "create");
  if (!createEvent) throw new Error("no create event (puzzle not found?)");
  return convert(createEvent.params.game, pid);
}

function syncGameEvents(gid, dfacId, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const socket = io(SOCKET, {
      transports: ["websocket"],
      auth: { dfacId },
      extraHeaders: { Origin: SITE },
      reconnection: false,
      timeout: 12000,
    });
    const done = (fn, arg) => {
      clearTimeout(timer);
      try { socket.close(); } catch { /* ignore */ }
      fn(arg);
    };
    const timer = setTimeout(() => done(reject, new Error("timed out fetching puzzle")), timeoutMs);
    socket.on("connect_error", (e) => done(reject, new Error("socket connect failed: " + e.message)));
    socket.on("connect", () => {
      socket.emit("join_game", gid, () => {
        socket.emit("sync_all_game_events", gid, (evts) => done(resolve, Array.isArray(evts) ? evts : []));
      });
    });
  });
}

/** Convert a DFAC game object into our internal puzzle format. */
function convert(game, pid) {
  const grid = game.grid;
  const sol = game.solution;
  const H = grid.length;
  const W = grid[0].length;
  const layout = grid.map((row) => row.map((c) => (c.black ? "#" : ".")).join(""));

  const entries = [];
  for (const direction of ["across", "down"]) {
    const clues = (game.clues && game.clues[direction]) || [];
    for (let n = 0; n < clues.length; n++) {
      const clue = clues[n];
      if (clue == null) continue;
      // cells belonging to clue number n in this direction
      const cells = [];
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++) {
          const cell = grid[r][c];
          if (!cell.black && cell.parents && cell.parents[direction] === n) cells.push([r, c]);
        }
      if (cells.length < 1) continue;
      cells.sort((a, b) => (direction === "across" ? a[1] - b[1] : a[0] - b[0]));
      const [row, col] = cells[0];
      const answer = cells.map(([r, c]) => (sol[r][c] || "").toUpperCase()).join("").replace(/[^A-Z]/g, "");
      if (answer.length !== cells.length) continue; // skip rebus / non-letter answers
      entries.push({ number: n, direction, row, col, length: cells.length, answer, clue: String(clue) });
    }
  }
  entries.sort((a, b) => a.number - b.number || (a.direction === "across" ? -1 : 1));

  const info = game.info || {};
  return {
    layoutName: `cwf:${info.titleOverride || info.title || pid}`.slice(0, 80),
    requestedLayout: null,
    source: "crosswithfriends",
    pid,
    width: W,
    height: H,
    layout,
    entries,
  };
}

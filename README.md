# criss 🧩

A crossword game you play with friends on **Discord**. It generates crosswords
from a word/clue dataset and runs as a **Discord Activity** (Embedded App) — a
real interactive grid you click and type into, with live multiplayer and a
scoreboard. It also runs as a normal web app in your browser, so you can build
and play without touching Discord.

Generation is adapted from [crossword-app](https://github.com/mcfcs/crossword-app):
the same `findSlots` / numbering logic, plus a CSP template filler (for the
symmetric 15×15 layouts) and an organic generator (irregular puzzles).

---

## How it works

```
        ┌────────────────────┐        WebSocket (/ws)       ┌────────────────────┐
Discord │  client (Vite/React)│ ───────────────────────────▶│  server (Express+ws)│
Activity│  • Embedded App SDK │ ◀─────────────────────────── │  • authoritative    │
iframe  │  • interactive grid │     full game state          │    game state       │
        └────────────────────┘                              │  • crossword gen    │
                  │  POST /api/token (OAuth2 code → token)    │  • clues.csv pool   │
                  └───────────────────────────────────────▶  └────────────────────┘
```

- **Server is authoritative.** It generates the puzzle, holds the shared grid,
  validates every letter, tracks who solved which clue, and broadcasts state.
  Clients never receive the answers.
- **One room = one shared puzzle.** In Discord the room is the Activity
  `instanceId` (everyone launching it together shares a board). In the browser
  it's the `?room=` query param (default `local-lobby`).
- **Scoring:** completing a clue awards points equal to its length to whoever
  typed the final correct letter. Solved clues lock. First to fill the board
  wins; the scoreboard shows the leader 👑.

---

## Prerequisites

- **Node 18+** (developed on Node 25).
- A **word/clue dataset** at `server/data/clues.csv`
  (`Date,Word,Clue,Difficulty` or `Word,Clue,Difficulty`). A small
  `server/data/words.sample.csv` is bundled as a fallback so it runs out of the
  box; the big `clues.csv` (not committed) makes the 15×15 templates fill well.

---

## Quick start (local, no Discord needed)

```bash
npm run install:all          # installs server + client deps

# terminal 1 — game server (http + websocket on :3001)
npm run dev:server

# terminal 2 — client dev server (Vite on :5173, proxies /api and /ws to :3001)
npm run dev:client
```

Open **http://localhost:5173** and play. To test **multiplayer locally**, open
two tabs in the same room with different names:

```
http://localhost:5173/?room=test&name=Alice
http://localhost:5173/?room=test&name=Bob
```

They share one board in real time.

---

## Run it as a Discord Activity

### 1. Create the Discord application
1. Go to the [Developer Portal](https://discord.com/developers/applications) →
   **New Application**.
2. Copy the **Application ID** (this is your client id) and, under **OAuth2**,
   the **Client Secret**.
3. **Activities → Settings → Enable Activities.**

### 2. Configure the Activity URL mapping
Under **Activities → URL Mappings**, map the root to where your app is served:

| Prefix | Target |
| ------ | ------ |
| `/`    | your public URL (the tunnel or deploy below) |

This makes `/`, `/api/token`, and `/ws` all reachable from inside Discord's
iframe proxy (WebSockets are proxied too).

### 3. Set environment variables
```bash
cp .env.example .env
# then edit .env:
#   DISCORD_CLIENT_ID=...
#   DISCORD_CLIENT_SECRET=...
```
Also expose the client id to the client build (Vite needs the `VITE_` prefix).
Create `client/.env`:
```
VITE_DISCORD_CLIENT_ID=your_application_id
```

### 4. Expose it over HTTPS with a tunnel (dev)
Discord can only load the Activity from a public HTTPS URL. With both dev
servers running, point a tunnel at the **client** (Vite proxies `/api` + `/ws`
back to the server):

```bash
# example using cloudflared
cloudflared tunnel --url http://localhost:5173
```

Put the resulting `https://….trycloudflare.com` URL into the **URL Mapping**
from step 2.

### 5. Launch it
In a Discord **voice channel**, open the **Activities (🚀)** picker → your app.
Friends in the channel join the same board. (Activities can also be launched in
text channels / DMs depending on your app's settings.)

---

## Deploying for real

- **One-origin (simplest):** `npm run build` (outputs `client/dist`), then run
  `npm start`. The server serves the built client *and* the API/WebSocket from a
  single origin — point your host (Railway, Fly.io, Render, a VPS) at it and map
  `/` to that URL in Discord. Set the env vars from step 3 on the host.
- **Split hosting:** deploy `client/dist` to a static host (Vercel/Netlify/
  Cloudflare Pages) and the server elsewhere; then the client's `/api` and `/ws`
  must reach the server (configure a rewrite/proxy, or map `/api` and `/ws`
  separately in Discord).

---

## Choosing layouts & datasets

- **Layouts** live in `server/crossword/layouts.js` (your five 15×15 templates
  plus minis). Pick one in the UI, or "Random layout". Templates are filled by
  the CSP solver; if one can't be filled within budget it falls back to an
  organic puzzle so a game always starts.
- **Difficulty** filters by the CSV's `Difficulty` column when the pool is large
  enough.
- **Swap datasets** via `CLUES_CSV=/path/to/your.csv` in `.env`, or drop a file
  at `server/data/clues.csv`.

> The 15×15 **Open** layout has a full-width 15-letter row crossing many long
> words — a genuinely hard fill. It may fall back to organic mode; the other
> nine layouts fill in <60 ms.

---

## Project structure

```
criss/
├─ server/
│  ├─ index.js              # express + ws: /api/token, /ws rooms, serves client
│  ├─ game.js               # authoritative per-room game state + scoring
│  ├─ puzzleStore.js        # loads dataset, makes puzzles
│  ├─ crossword/
│  │  ├─ generator.js       # CSP template fill + organic generation
│  │  └─ layouts.js         # black-square templates
│  └─ data/
│     ├─ words.sample.csv   # bundled fallback word list
│     └─ clues.csv          # your big dataset (gitignored)
├─ client/
│  ├─ src/
│  │  ├─ App.jsx            # game UI + keyboard/click crossword input
│  │  ├─ discordSdk.js      # Embedded App SDK handshake + local fallback
│  │  ├─ net.js             # websocket client
│  │  ├─ components/        # Grid, Clues, Scoreboard
│  │  └─ crossword/puzzle.js# client-side puzzle indexing
│  └─ vite.config.js        # dev proxy for /api and /ws
└─ package.json             # root scripts
```

---

## Controls

- **Click** a cell to select; click again to toggle across/down.
- **Type** letters to fill; **Backspace** to delete; **arrow keys** to move;
  **Space/Tab** to switch direction.
- Click a clue to jump to it. **Reveal letter** fills the selected cell (no
  points).

---

## Ideas / next steps

- Optimistic local input (instant letters before the server echoes).
- A companion **bot** to announce/launch games and post a daily puzzle.
- Persist rooms/scores (currently in-memory; a room is dropped when empty).
- Smarter dictionary scoring to prefer common words over crosswordese in fills.
```

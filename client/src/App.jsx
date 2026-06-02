import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initSession } from "./discordSdk.js";
import { connect } from "./net.js";
import { indexPuzzle, entryCells, clueId } from "./crossword/puzzle.js";
import Grid from "./components/Grid.jsx";
import Clues from "./components/Clues.jsx";
import Scoreboard from "./components/Scoreboard.jsx";

const DIFFICULTIES = [
  { value: "", label: "Any difficulty" },
  { value: "EASY", label: "Easy" },
  { value: "MODERATE", label: "Moderate" },
  { value: "DIFFICULT", label: "Hard" },
];

export default function App() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [state, setState] = useState(null); // server game state
  const [sel, setSel] = useState(null); // {r,c}
  const [dir, setDir] = useState("across");
  const [layouts, setLayouts] = useState([]);
  const [layout, setLayout] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [now, setNow] = useState(Date.now());
  const stateAtRef = useRef(Date.now());
  const netRef = useRef(null);

  // ---- boot: session + websocket ----
  useEffect(() => {
    let net;
    initSession()
      .then((s) => {
        setSession(s);
        net = connect({
          room: s.room,
          user: s.user,
          onState: (m) => {
            stateAtRef.current = Date.now();
            setState(m);
          },
          onError: (msg) => setError(msg),
        });
        netRef.current = net;
      })
      .catch((e) => setError(String(e?.message || e)));
    fetch("/api/layouts")
      .then((r) => r.json())
      .then(setLayouts)
      .catch(() => {});
    return () => net?.close();
  }, []);

  // ---- local timer tick ----
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const puzzle = state?.puzzle || null;
  const index = useMemo(() => (puzzle ? indexPuzzle(puzzle) : null), [puzzle]);

  // First selection when a new puzzle arrives.
  const sig = puzzle ? `${puzzle.layoutName}-${puzzle.width}x${puzzle.height}` : null;
  const sigRef = useRef(null);
  useEffect(() => {
    if (puzzle && sig !== sigRef.current) {
      sigRef.current = sig;
      const first = puzzle.entries.find((e) => e.direction === "across") || puzzle.entries[0];
      if (first) {
        setSel({ r: first.row, c: first.col });
        setDir(first.direction);
      }
    }
  }, [puzzle, sig]);

  const solvedSet = useMemo(() => new Set(state?.solved || []), [state]);
  const solvedCells = useMemo(() => {
    const s = new Set();
    if (puzzle && state?.solved) {
      for (const e of puzzle.entries) {
        if (solvedSet.has(clueId(e))) for (const [r, c] of entryCells(e)) s.add(`${r},${c}`);
      }
    }
    return s;
  }, [puzzle, state, solvedSet]);

  const currentEntry = useMemo(() => {
    if (!index || !sel) return null;
    return index.entryAt(sel.r, sel.c, dir) || index.entryAt(sel.r, sel.c, dir === "across" ? "down" : "across");
  }, [index, sel, dir]);

  const currentCells = useMemo(() => {
    const s = new Set();
    if (currentEntry) for (const [r, c] of entryCells(currentEntry)) s.add(`${r},${c}`);
    return s;
  }, [currentEntry]);

  // ---- interaction helpers ----
  const send = (obj) => netRef.current?.send(obj);

  const selectCell = useCallback(
    (r, c) => {
      if (!index || index.isBlock(r, c)) return;
      setSel((prev) => {
        if (prev && prev.r === r && prev.c === c) {
          // toggle direction if both exist
          setDir((d) => {
            const other = d === "across" ? "down" : "across";
            return index.entryAt(r, c, other) ? other : d;
          });
          return prev;
        }
        // keep dir if an entry exists there, else switch
        setDir((d) => (index.entryAt(r, c, d) ? d : index.entryAt(r, c, "across") ? "across" : "down"));
        return { r, c };
      });
    },
    [index],
  );

  const selectClue = useCallback((e) => {
    setSel({ r: e.row, c: e.col });
    setDir(e.direction);
  }, []);

  const nextInWord = useCallback(
    (r, c) => {
      if (!currentEntry) return null;
      const cells = entryCells(currentEntry);
      const i = cells.findIndex(([cr, cc]) => cr === r && cc === c);
      return i >= 0 && i < cells.length - 1 ? { r: cells[i + 1][0], c: cells[i + 1][1] } : null;
    },
    [currentEntry],
  );
  const prevInWord = useCallback(
    (r, c) => {
      if (!currentEntry) return null;
      const cells = entryCells(currentEntry);
      const i = cells.findIndex(([cr, cc]) => cr === r && cc === c);
      return i > 0 ? { r: cells[i - 1][0], c: cells[i - 1][1] } : null;
    },
    [currentEntry],
  );

  const stepGrid = useCallback(
    (r, c, dr, dc) => {
      if (!index) return null;
      let nr = r + dr;
      let nc = c + dc;
      while (nr >= 0 && nc >= 0 && nr < puzzle.height && nc < puzzle.width) {
        if (!index.isBlock(nr, nc)) return { r: nr, c: nc };
        nr += dr;
        nc += dc;
      }
      return null;
    },
    [index, puzzle],
  );

  // ---- keyboard ----
  useEffect(() => {
    if (!puzzle || !sel) return;
    const onKey = (ev) => {
      const k = ev.key;
      if (/^[a-zA-Z]$/.test(k)) {
        ev.preventDefault();
        send({ type: "input", row: sel.r, col: sel.c, letter: k.toUpperCase() });
        const nx = nextInWord(sel.r, sel.c);
        if (nx) setSel(nx);
      } else if (k === "Backspace") {
        ev.preventDefault();
        const cur = state.fills[sel.r][sel.c];
        if (cur) {
          send({ type: "input", row: sel.r, col: sel.c, letter: null });
        } else {
          const pv = prevInWord(sel.r, sel.c);
          if (pv) {
            setSel(pv);
            send({ type: "input", row: pv.r, col: pv.c, letter: null });
          }
        }
      } else if (k === "Delete") {
        ev.preventDefault();
        send({ type: "input", row: sel.r, col: sel.c, letter: null });
      } else if (k === " " || k === "Tab") {
        ev.preventDefault();
        setDir((d) => {
          const other = d === "across" ? "down" : "across";
          return index.entryAt(sel.r, sel.c, other) ? other : d;
        });
      } else if (k.startsWith("Arrow")) {
        ev.preventDefault();
        const map = { ArrowUp: [-1, 0, "down"], ArrowDown: [1, 0, "down"], ArrowLeft: [0, -1, "across"], ArrowRight: [0, 1, "across"] };
        const [dr, dc, nd] = map[k];
        setDir(nd);
        const nx = stepGrid(sel.r, sel.c, dr, dc);
        if (nx) setSel(nx);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [puzzle, sel, state, index, nextInWord, prevInWord, stepGrid]);

  // ---- render ----
  if (error) {
    return (
      <div className="screen center">
        <div className="card">
          <h2>Something went wrong</h2>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }
  if (!session || !state) {
    return (
      <div className="screen center">
        <div className="card">
          <h1 className="logo">criss</h1>
          <p className="muted">Connecting…</p>
        </div>
      </div>
    );
  }

  const total = puzzle ? puzzle.entries.length : 0;
  const elapsed = (state.elapsedMs || 0) + (now - stateAtRef.current);

  return (
    <div className="screen">
      <header className="topbar">
        <div className="brand">
          criss <span className="tag">{session.mode === "discord" ? "· Discord" : "· local"}</span>
        </div>
        <div className="controls">
          <select value={layout} onChange={(e) => setLayout(e.target.value)} title="Layout">
            <option value="">Random layout</option>
            {layouts.map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} title="Difficulty">
            {DIFFICULTIES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <button className="primary" onClick={() => send({ type: "new_game", layout, difficulty })}>
            New puzzle
          </button>
        </div>
      </header>

      {puzzle ? (
        <main className="play">
          <section className="board">
            <Grid
              puzzle={puzzle}
              index={index}
              fills={state.fills}
              solvedCells={solvedCells}
              selected={sel}
              currentCells={currentCells}
              onCellClick={selectCell}
            />
            <div className="cluebar">
              {currentEntry ? (
                <>
                  <span className="cluebar-num">
                    {currentEntry.number} {currentEntry.direction}
                  </span>
                  <span className="cluebar-text">{currentEntry.clue}</span>
                  <button className="ghost" onClick={() => sel && send({ type: "reveal", row: sel.r, col: sel.c })}>
                    Reveal letter
                  </button>
                </>
              ) : (
                <span className="muted">Pick a clue to start</span>
              )}
            </div>
            {state.complete && (
              <div className="win">🎉 Solved in {Math.floor(elapsed / 1000)}s — nice work!</div>
            )}
          </section>

          <aside className="side">
            <Scoreboard
              players={state.players}
              scores={state.scores}
              meId={session.user.id}
              solvedCount={state.solved.length}
              total={total}
              elapsedMs={elapsed}
            />
            <Clues puzzle={puzzle} solved={solvedSet} currentId={currentEntry ? clueId(currentEntry) : null} onSelect={selectClue} />
          </aside>
        </main>
      ) : (
        <div className="center grow">
          <div className="card">
            <p className="muted">No puzzle yet.</p>
            <button className="primary" onClick={() => send({ type: "new_game", layout, difficulty })}>
              Start a puzzle
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

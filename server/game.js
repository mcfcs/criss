// Per-room authoritative crossword game state.
import { makePuzzle } from "./puzzleStore.js";

const cellsOf = (e) => {
  const out = [];
  for (let i = 0; i < e.length; i++) {
    const r = e.direction === "across" ? e.row : e.row + i;
    const c = e.direction === "across" ? e.col + i : e.col;
    out.push([r, c]);
  }
  return out;
};

export class Game {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = new Map(); // connId -> { id, username, connId }
    this.puzzleFull = null; // includes answers (server only)
    this.fills = null; // height x width of letter | null
    this.solved = new Set(); // "across-5"
    this.solvedBy = new Map(); // clueId -> userId
    this.solvedCells = new Set(); // "r,c" (locked, correct)
    this.scores = new Map(); // userId -> points
    this.startedAt = null;
    this.generating = false; // a puzzle is currently being generated
  }

  addPlayer(connId, user) {
    this.players.set(connId, { ...user, connId });
  }
  removePlayer(connId) {
    this.players.delete(connId);
  }
  hasPuzzle() {
    return !!this.puzzleFull;
  }

  newGame({ layoutName = null, difficulty = null } = {}) {
    const full = makePuzzle({ layoutName, difficulty });
    this.puzzleFull = full;
    this.w = full.width;
    this.h = full.height;
    this.layout = full.layout;
    this.fills = Array.from({ length: full.height }, () => Array(full.width).fill(null));
    this.solved = new Set();
    this.solvedBy = new Map();
    this.solvedCells = new Set();
    this.scores = new Map();
    this.startedAt = Date.now();
  }

  #inBounds(r, c) {
    return r >= 0 && c >= 0 && r < this.h && c < this.w;
  }
  #isOpen(r, c) {
    return this.#inBounds(r, c) && this.layout[r][c] === ".";
  }

  /** A player types a letter (or null to clear) into a cell. */
  applyInput(userId, r, c, letter) {
    if (!this.puzzleFull || !this.#isOpen(r, c)) return null;
    const key = `${r},${c}`;
    if (this.solvedCells.has(key)) return null; // locked (already correct)
    const L = letter ? String(letter).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) : null;
    this.fills[r][c] = L || null;
    const newlySolved = this.#checkSolves(userId, r, c);
    return { newlySolved, complete: this.isComplete() };
  }

  /** Reveal the correct letter for a single cell (no points awarded). */
  reveal(r, c) {
    if (!this.puzzleFull || !this.#isOpen(r, c)) return null;
    const key = `${r},${c}`;
    if (this.solvedCells.has(key)) return null;
    for (const e of this.puzzleFull.entries) {
      const cells = cellsOf(e);
      for (let i = 0; i < cells.length; i++) {
        if (cells[i][0] === r && cells[i][1] === c) {
          this.fills[r][c] = e.answer[i];
          const newlySolved = this.#checkSolves(null, r, c);
          return { newlySolved, complete: this.isComplete() };
        }
      }
    }
    return null;
  }

  /** Find an entry by clue number + direction. */
  findEntry(number, direction) {
    if (!this.puzzleFull) return null;
    return this.puzzleFull.entries.find((e) => e.number === Number(number) && e.direction === direction) || null;
  }

  /**
   * Submit a whole-word answer for a clue (the natural input for a bot).
   * Correct → fills + locks the clue, credits the player, detects crossings/win.
   * Wrong → nothing changes.
   */
  submitAnswer(userId, number, direction, word) {
    const e = this.findEntry(number, direction);
    if (!e) return { error: "no_clue" };
    const id = `${e.direction}-${e.number}`;
    if (this.solved.has(id)) return { alreadySolved: true, entry: e };
    const guess = String(word || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (guess.length !== e.length) return { correct: false, entry: e, reason: "length" };
    if (guess !== e.answer) return { correct: false, entry: e };
    // Correct: write the letters, then let #checkSolves credit this clue and
    // any crossing clue it completes.
    const cells = cellsOf(e);
    for (let i = 0; i < cells.length; i++) {
      const [r, c] = cells[i];
      if (!this.solvedCells.has(`${r},${c}`)) this.fills[r][c] = e.answer[i];
    }
    let newly = [];
    for (const [r, c] of cells) newly = newly.concat(this.#checkSolves(userId, r, c));
    return { correct: true, entry: e, newlySolved: [...new Set(newly)], complete: this.isComplete() };
  }

  /** Reveal an entire clue's letters (no points awarded). */
  revealClue(number, direction) {
    const e = this.findEntry(number, direction);
    if (!e) return { error: "no_clue" };
    for (const [r, c] of cellsOf(e)) this.reveal(r, c);
    return { entry: e, complete: this.isComplete() };
  }

  #checkSolves(userId, r, c) {
    const newly = [];
    for (const e of this.puzzleFull.entries) {
      const clueId = `${e.direction}-${e.number}`;
      if (this.solved.has(clueId)) continue;
      const cells = cellsOf(e);
      if (!cells.some(([er, ec]) => er === r && ec === c)) continue;
      if (!cells.every(([er, ec]) => this.fills[er][ec])) continue;
      const word = cells.map(([er, ec]) => this.fills[er][ec]).join("");
      if (word !== e.answer) continue;
      // Solved!
      this.solved.add(clueId);
      for (const [er, ec] of cells) this.solvedCells.add(`${er},${ec}`);
      if (userId) {
        this.scores.set(userId, (this.scores.get(userId) || 0) + e.length);
        this.solvedBy.set(clueId, userId);
      }
      newly.push(clueId);
    }
    return newly;
  }

  isComplete() {
    return this.puzzleFull && this.solved.size === this.puzzleFull.entries.length;
  }

  /** State safe to send to clients (answers stripped). */
  publicState() {
    return {
      type: "state",
      room: this.roomId,
      puzzle: this.puzzleFull
        ? {
            layoutName: this.puzzleFull.layoutName,
            requestedLayout: this.puzzleFull.requestedLayout || null,
            width: this.w,
            height: this.h,
            layout: this.layout,
            entries: this.puzzleFull.entries.map(({ answer, ...rest }) => rest),
          }
        : null,
      fills: this.fills,
      solved: [...this.solved],
      solvedBy: Object.fromEntries(this.solvedBy),
      scores: Object.fromEntries(this.scores),
      players: [...this.players.values()].map((p) => ({ id: p.id, username: p.username })),
      complete: this.isComplete(),
      elapsedMs: this.startedAt ? Date.now() - this.startedAt : 0,
    };
  }
}

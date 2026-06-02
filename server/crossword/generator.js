// Crossword generation core.
//
// Strategy: organic placement. Start with one word, then repeatedly place
// new words so each crosses an existing word at a matching letter, with no
// illegal adjacencies. This reliably yields a valid, irregular crossword from
// any word list (the way human-style generators work) and is fast.
//
// CSV parsing mirrors the original crossword-app (src/utils/crosswordUtils.js).

export function parseWordsCSV(text) {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] || "").toLowerCase().split(",").map((s) => s.trim());
  const wordIdx = header.indexOf("word") >= 0 ? header.indexOf("word") : 1;
  const clueIdx = header.indexOf("clue") >= 0 ? header.indexOf("clue") : 2;
  const diffIdx = header.indexOf("difficulty");

  const out = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const parts = splitCSVLine(line);
    const word = (parts[wordIdx] || "").replace(/"/g, "").trim().toUpperCase().replace(/[^A-Z]/g, "");
    const clue = (parts[clueIdx] || "").replace(/"/g, "").trim();
    const difficulty = diffIdx >= 0 ? (parts[diffIdx] || "").replace(/"/g, "").trim() : "";
    if (word.length >= 3 && clue && !seen.has(word)) {
      seen.add(word);
      out.push({ word, clue, difficulty });
    }
  }
  return out;
}

function splitCSVLine(line) {
  const parts = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  parts.push(cur);
  return parts;
}

// ---- RNG (seedable so a seed reproduces a puzzle) ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Number entries by start-cell scan order (standard crossword numbering). */
function assignNumbers(placements) {
  const numberMap = new Map();
  const keys = [...new Set(placements.map((p) => `${p.row},${p.col}`))];
  keys.sort((A, B) => {
    const [ar, ac] = A.split(",").map(Number);
    const [br, bc] = B.split(",").map(Number);
    return ar !== br ? ar - br : ac - bc;
  });
  let n = 1;
  for (const k of keys) numberMap.set(k, n++);
  return placements
    .map((p) => ({
      number: numberMap.get(`${p.row},${p.col}`),
      direction: p.direction,
      row: p.row,
      col: p.col,
      length: p.word.length,
      answer: p.word,
      clue: p.clue,
    }))
    .sort((a, b) => a.number - b.number || (a.direction === "across" ? -1 : 1));
}

// =====================================================================
// Fixed-template fill (CSP backtracking) — fills the symmetric black-square
// layouts from the original crossword-app. Needs a large dictionary.
// =====================================================================

const cellOf = (slot, i) =>
  slot.direction === "across" ? [slot.row, slot.col + i] : [slot.row + i, slot.col];

/** Find across/down slots (runs of >= 2 open cells). '#' = block, '.' = open. */
export function findSlots(layout) {
  const rows = layout.length;
  const cols = layout[0].length;
  const open = (r, c) => layout[r][c] === ".";
  const slots = [];
  for (let r = 0; r < rows; r++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      if (c < cols && open(r, c)) { if (start === -1) start = c; }
      else { if (start !== -1 && c - start >= 2) slots.push({ row: r, col: start, length: c - start, direction: "across" }); start = -1; }
    }
  }
  for (let c = 0; c < cols; c++) {
    let start = -1;
    for (let r = 0; r <= rows; r++) {
      if (r < rows && open(r, c)) { if (start === -1) start = r; }
      else { if (start !== -1 && r - start >= 2) slots.push({ row: start, col: c, length: r - start, direction: "down" }); start = -1; }
    }
  }
  return slots;
}

// Index words by length and by (position,letter) for fast pattern matching.
function buildIndex(pool) {
  const byLen = new Map();
  for (const w of pool) {
    const L = w.word.length;
    let e = byLen.get(L);
    if (!e) { e = { words: [], pos: Array.from({ length: L }, () => new Map()) }; byLen.set(L, e); }
    const idx = e.words.length;
    e.words.push(w);
    for (let i = 0; i < L; i++) {
      const m = e.pos[i];
      const ch = w.word[i];
      if (!m.has(ch)) m.set(ch, []);
      m.get(ch).push(idx);
    }
  }
  return byLen;
}

function fillLayout(layoutGrid, pool, rng, { timeBudgetMs, candidateCap = 60 }) {
  const slots = findSlots(layoutGrid);
  const index = buildIndex(pool);
  const deadline = Date.now() + timeBudgetMs;
  const N = slots.length;

  // Map each open cell to the (slot,pos) that pass through it, then derive
  // crossing relationships: crossers[i] = [{ other, myPos, theirPos }].
  const cellMap = new Map();
  slots.forEach((slot, si) => {
    for (let i = 0; i < slot.length; i++) {
      const [r, c] = cellOf(slot, i);
      const key = r * 1000 + c;
      if (!cellMap.has(key)) cellMap.set(key, []);
      cellMap.get(key).push({ si, pos: i });
    }
  });
  const crossers = Array.from({ length: N }, () => []);
  for (const members of cellMap.values()) {
    if (members.length < 2) continue;
    for (const a of members) for (const b of members) {
      if (a.si !== b.si) crossers[a.si].push({ other: b.si, myPos: a.pos, theirPos: b.pos });
    }
  }

  // Live candidate list per slot (array of word strings). Start = all words of
  // that length. cand[i] === null once slot i is assigned.
  const cand = slots.map((s) => {
    const e = index.get(s.length);
    return e ? e.words.map((w) => w.word) : [];
  });
  const used = new Set();
  const solutionWords = new Array(N).fill(null);
  let assignedCount = 0;

  function solve() {
    if (Date.now() > deadline) return false;
    if (assignedCount === N) return true;
    // MRV using cached candidate counts.
    let target = -1, min = Infinity;
    for (let i = 0; i < N; i++) {
      if (cand[i] === null) continue;
      const len = cand[i].length;
      if (len === 0) return false;
      if (len < min) { min = len; target = i; if (min === 1) break; }
    }
    const list = shuffle(cand[target].slice(), rng);
    const slot = slots[target];
    const myCrossers = crossers[target];
    const limit = Math.min(list.length, candidateCap);
    for (let k = 0; k < limit; k++) {
      const word = list[k];
      if (used.has(word)) continue;
      // Forward check: filter each crossing slot to words agreeing on the
      // shared letter; bail if any becomes empty.
      const saved = [];
      let ok = true;
      for (const x of myCrossers) {
        if (cand[x.other] === null) continue;
        const letter = word[x.myPos];
        const filtered = cand[x.other].filter((w) => w[x.theirPos] === letter);
        saved.push([x.other, cand[x.other]]);
        cand[x.other] = filtered;
        if (filtered.length === 0) { ok = false; break; }
      }
      if (ok) {
        const savedSelf = cand[target];
        cand[target] = null; used.add(word); solutionWords[target] = word; assignedCount++;
        if (solve()) return true;
        cand[target] = savedSelf; used.delete(word); solutionWords[target] = null; assignedCount--;
      }
      for (const [oi, oldList] of saved) cand[oi] = oldList; // restore crossers
      if (Date.now() > deadline) return false;
    }
    return false;
  }

  if (!solve()) return null;

  const placements = slots.map((slot, i) => {
    const word = solutionWords[i];
    const w = pool.find((p) => p.word === word);
    return { row: slot.row, col: slot.col, direction: slot.direction, word, clue: w ? w.clue : "" };
  });
  return {
    layoutName: "template",
    width: layoutGrid[0].length,
    height: layoutGrid.length,
    layout: layoutGrid,
    entries: assignNumbers(placements),
  };
}

function buildOnce(pool, rng, { targetWords, maxDim }) {
  const SIZE = maxDim * 2 + 1; // generous working grid; we crop later
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const placed = [];
  const usedWords = new Set();

  const cell = (r, c) => (r < 0 || c < 0 || r >= SIZE || c >= SIZE ? "#" : grid[r][c]);

  function canPlace(word, row, col, dir) {
    const dr = dir === "down" ? 1 : 0;
    const dc = dir === "across" ? 1 : 0;
    // ends must be empty (don't extend an existing word)
    if (cell(row - dr, col - dc) !== null) return -1;
    if (cell(row + dr * word.length, col + dc * word.length) !== null) return -1;

    let crossings = 0;
    for (let i = 0; i < word.length; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      const existing = cell(r, c);
      if (existing === "#") return -1;
      if (existing !== null) {
        if (existing !== word[i]) return -1;
        crossings++; // legal crossing
      } else {
        // empty cell we will fill: perpendicular neighbors must be empty,
        // otherwise we'd glue onto a parallel word.
        const pr = dir === "across" ? 1 : 0;
        const pc = dir === "across" ? 0 : 1;
        if (cell(r - pr, c - pc) !== null) return -1;
        if (cell(r + pr, c + pc) !== null) return -1;
      }
    }
    return crossings;
  }

  function put(word, clue, row, col, dir) {
    const dr = dir === "down" ? 1 : 0;
    const dc = dir === "across" ? 1 : 0;
    for (let i = 0; i < word.length; i++) grid[row + dr * i][col + dc * i] = word[i];
    placed.push({ word, clue, row, col, direction: dir });
    usedWords.add(word);
  }

  // Candidate ordering: longer words first (interlock better) with jitter.
  const candidates = shuffle([...pool], rng).sort(
    (a, b) => b.word.length - a.word.length + (rng() - 0.5) * 3,
  );

  // Seed with the first long word, centered horizontally.
  const first = candidates[0];
  const mid = Math.floor(SIZE / 2);
  put(first.word, first.clue, mid, mid - Math.floor(first.word.length / 2), "across");

  for (const cand of candidates) {
    if (placed.length >= targetWords) break;
    if (usedWords.has(cand.word)) continue;
    const word = cand.word;

    // Find every spot where a letter of `word` can cross an existing letter.
    const spots = [];
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      for (const p of placed) {
        for (let j = 0; j < p.word.length; j++) {
          if (p.word[j] !== ch) continue;
          const cr = p.direction === "down" ? p.row + j : p.row;
          const cc = p.direction === "across" ? p.col + j : p.col;
          // place `word` perpendicular to p, crossing at (cr,cc) on letter i
          const dir = p.direction === "across" ? "down" : "across";
          const row = dir === "down" ? cr - i : cr;
          const col = dir === "across" ? cc - i : cc;
          const cross = canPlace(word, row, col, dir);
          if (cross >= 1) spots.push({ row, col, dir, cross });
        }
      }
    }
    if (spots.length) {
      // Prefer denser placements (more crossings) to keep the grid compact,
      // but keep some randomness so puzzles vary.
      spots.sort((a, b) => b.cross - a.cross);
      const topCross = spots[0].cross;
      const best = spots.filter((s) => s.cross >= topCross);
      const pick = best[Math.floor(rng() * best.length)];
      put(word, cand.clue, pick.row, pick.col, pick.dir);
    }
  }

  if (placed.length < Math.min(6, targetWords)) return null;

  // Crop to bounding box.
  let minR = SIZE, minC = SIZE, maxR = 0, maxC = 0;
  for (const p of placed) {
    const dr = p.direction === "down" ? 1 : 0;
    const dc = p.direction === "across" ? 1 : 0;
    minR = Math.min(minR, p.row);
    minC = Math.min(minC, p.col);
    maxR = Math.max(maxR, p.row + dr * (p.word.length - 1));
    maxC = Math.max(maxC, p.col + dc * (p.word.length - 1));
  }
  const height = maxR - minR + 1;
  const width = maxC - minC + 1;
  const translated = placed.map((p) => ({ ...p, row: p.row - minR, col: p.col - minC }));

  // Build template: '.' for any cell used by a word, '#' otherwise.
  const tpl = Array.from({ length: height }, () => Array(width).fill("#"));
  for (const p of translated) {
    const dr = p.direction === "down" ? 1 : 0;
    const dc = p.direction === "across" ? 1 : 0;
    for (let i = 0; i < p.word.length; i++) tpl[p.row + dr * i][p.col + dc * i] = ".";
  }

  return {
    width,
    height,
    layout: tpl.map((row) => row.join("")),
    entries: assignNumbers(translated),
  };
}

/**
 * Generate a complete puzzle.
 * @returns {{ width, height, layout, entries }} entries include `answer` (server-side only).
 */
export function generatePuzzle({
  pool,
  layout = null, // fixed template { name, grid } -> template fill; null -> organic
  seed = 12345,
  targetWords = 18,
  maxDim = 11,
  minLen = 3,
  maxLen = 8,
  difficulty = null, // e.g. "EASY" | "MODERATE" | "DIFFICULT"
  attempts = 60,
  timeBudgetMs = 1200,
  candidateCap = 100,
  fallbackOrganic = true, // if a template can't be filled, return an organic puzzle
}) {
  const applyDifficulty = (list) => {
    if (!difficulty) return list;
    const d = list.filter((w) => (w.difficulty || "").toUpperCase() === difficulty.toUpperCase());
    return d.length > 800 ? d : list;
  };

  // Fixed-template mode: fill the user's symmetric black-square layout.
  // Templates contain long slots, so DON'T cap max length here — only enforce
  // the minimum (>= 3) and an optional difficulty narrowing.
  if (layout && layout.grid) {
    let tplPool = applyDifficulty(pool.filter((w) => w.word.length >= minLen));
    if (tplPool.length < 1000) tplPool = pool;
    // timeBudgetMs is the TOTAL budget across attempts so worst-case latency
    // is bounded even when a template can't be filled.
    const deadline = Date.now() + timeBudgetMs;
    for (let a = 0; a < attempts; a++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const rng = mulberry32(seed + a * 2654435761);
      const res = fillLayout(layout.grid, tplPool, rng, { timeBudgetMs: remaining, candidateCap });
      if (res) { res.layoutName = layout.name || "template"; return res; }
    }
    if (!fallbackOrganic) return null;
    // Couldn't fill this template in budget — fall back to an organic puzzle
    // so a game always gets a board.
  }

  // Organic mode: cap length for compact, playable grids.
  let filtered = applyDifficulty(pool.filter((w) => w.word.length >= minLen && w.word.length <= maxLen));
  if (filtered.length < 200) filtered = pool;

  // Organic mode: grow an irregular crossword from the pool.
  let best = null;
  for (let a = 0; a < attempts; a++) {
    const rng = mulberry32(seed + a * 2654435761);
    const res = buildOnce(filtered, rng, { targetWords, maxDim });
    if (res && (!best || res.entries.length > best.entries.length)) {
      best = res;
      if (best.entries.length >= targetWords) break;
    }
  }
  if (best && !best.layoutName) best.layoutName = "Freeform";
  return best;
}

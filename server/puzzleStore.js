// Loads the word/clue dataset once and produces puzzles on demand.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWordsCSV, generatePuzzle } from "./crossword/generator.js";
import { getLayout, LAYOUTS } from "./crossword/layouts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDatasetPath() {
  // Prefer an explicit env path, else the big clues.csv, else the bundled sample.
  const candidates = [
    process.env.CLUES_CSV,
    path.join(__dirname, "data", "clues.csv"),
    path.join(__dirname, "data", "words.sample.csv"),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  throw new Error("No dataset found. Set CLUES_CSV or add server/data/words.sample.csv");
}

let pool = null;

export function loadPool() {
  if (pool) return pool;
  const file = resolveDatasetPath();
  const t0 = Date.now();
  pool = parseWordsCSV(fs.readFileSync(file, "utf8"));
  console.log(`[puzzle] loaded ${pool.length} words from ${path.basename(file)} in ${Date.now() - t0}ms`);
  return pool;
}

let seedCounter = 1;

/**
 * Make a puzzle. Returns the FULL puzzle (entries include `answer`); the
 * server keeps it and sanitizes before sending to clients.
 *
 * Difficulty is best-effort: a single difficulty often can't fill a dense
 * 15x15 quickly, so we try it briefly, then drop it (keeping the chosen
 * layout), then try same-size sibling templates, then organic. This keeps the
 * player's layout when possible and never produces a broken board.
 * `requestedLayout` lets the UI note when we had to substitute the layout.
 */
export function makePuzzle({ layoutName = null, difficulty = null } = {}) {
  loadPool();
  const seed = (seedCounter = (seedCounter * 1103515245 + 12345) & 0x7fffffff);

  const target = layoutName ? getLayout(layoutName) : pickRandomLayout(seed);
  const siblings = target ? LAYOUTS.filter((l) => l.size === target.size && l.name !== target.name) : [];

  // Short budgets: fillable templates fill in <60ms, so anything that doesn't
  // resolve quickly (e.g. "Open 15x15") fails fast and we move on.
  const attempts = [];
  if (target) {
    if (difficulty) attempts.push({ layout: target, difficulty, budget: 500 }); // chosen layout + difficulty
    attempts.push({ layout: target, difficulty: null, budget: 400 }); // chosen layout, any words
    for (const s of siblings) attempts.push({ layout: s, difficulty: null, budget: 400 }); // other templates
  }

  for (const a of attempts) {
    const p = generatePuzzle({
      pool,
      layout: a.layout,
      difficulty: a.difficulty,
      seed,
      timeBudgetMs: a.budget,
      fallbackOrganic: false,
    });
    if (p) return { ...p, requestedLayout: layoutName || null };
  }

  // Organic always succeeds — prefer difficulty, fall back to any words.
  const organic =
    generatePuzzle({ pool, difficulty, seed, fallbackOrganic: false }) ||
    generatePuzzle({ pool, seed, fallbackOrganic: true });
  if (!organic) throw new Error("Failed to generate a puzzle");
  return { ...organic, requestedLayout: layoutName || null };
}

function pickRandomLayout(seed) {
  return LAYOUTS[Math.abs(seed) % LAYOUTS.length];
}

export function layoutCatalog() {
  return LAYOUTS.map((l) => ({ name: l.name, size: l.size, width: l.grid[0].length, height: l.grid.length }));
}

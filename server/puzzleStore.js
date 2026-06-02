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
 */
export function makePuzzle({ layoutName = null, difficulty = null } = {}) {
  loadPool();
  const seed = (seedCounter = (seedCounter * 1103515245 + 12345) & 0x7fffffff);
  const layout = layoutName ? getLayout(layoutName) : null;
  const puzzle = generatePuzzle({ pool, layout, difficulty, seed, timeBudgetMs: 2500 });
  if (!puzzle) throw new Error("Failed to generate a puzzle");
  return puzzle;
}

export function layoutCatalog() {
  return LAYOUTS.map((l) => ({ name: l.name, size: l.size, width: l.grid[0].length, height: l.grid.length }));
}

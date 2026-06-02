// Discord-agnostic text rendering of a game's board, clues, and scores.
// bot.js wraps these into an embed; kept separate so it's testable headlessly.

const clueId = (e) => `${e.direction}-${e.number}`;

/** ASCII grid: blocks as ▓, empty cells as ·, filled cells as the letter. */
export function renderGrid(game) {
  if (!game.puzzleFull) return "(no puzzle)";
  const rows = [];
  for (let r = 0; r < game.h; r++) {
    let line = "";
    for (let c = 0; c < game.w; c++) {
      if (game.layout[r][c] === "#") line += "▓ ";
      else line += (game.fills[r][c] || "·") + " ";
    }
    rows.push(line.trimEnd());
  }
  return rows.join("\n");
}

/** Clue lines for one direction, e.g. "3. Capital of PH (6) ✓". */
export function renderClues(game, direction, { max = 40 } = {}) {
  if (!game.puzzleFull) return "";
  const entries = game.puzzleFull.entries.filter((e) => e.direction === direction);
  const lines = entries.slice(0, max).map((e) => {
    const done = game.solved.has(clueId(e)) ? " ✓" : "";
    return `\`${e.number}\` ${e.clue} (${e.length})${done}`;
  });
  if (entries.length > max) lines.push(`…and ${entries.length - max} more`);
  return lines.join("\n") || "—";
}

/** "Solved 3/10 · ⏱ 1:20" */
export function renderProgress(game) {
  if (!game.puzzleFull) return "";
  const total = game.puzzleFull.entries.length;
  const secs = game.startedAt ? Math.floor((Date.now() - game.startedAt) / 1000) : 0;
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return `Solved ${game.solved.size}/${total} · ⏱ ${time}`;
}

/** Scoreboard lines sorted high→low, with names resolved from players. */
export function renderScores(game) {
  const names = new Map([...game.players.values()].map((p) => [p.id, p.username]));
  const rows = [...game.scores.entries()].sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return "No points yet — be the first!";
  return rows
    .map(([id, score], i) => `${i === 0 ? "👑" : `${i + 1}.`} ${names.get(id) || id} — **${score}**`)
    .join("\n");
}

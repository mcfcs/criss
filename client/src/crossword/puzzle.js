// Client-side puzzle indexing for grid rendering and keyboard navigation.

export function indexPuzzle(puzzle) {
  const acrossAt = {}; // "r,c" -> entry
  const downAt = {};
  const numberAt = {}; // "r,c" -> clue number (only at slot starts)

  for (const e of puzzle.entries) {
    numberAt[`${e.row},${e.col}`] = e.number;
    for (let i = 0; i < e.length; i++) {
      const r = e.direction === "across" ? e.row : e.row + i;
      const c = e.direction === "across" ? e.col + i : e.col;
      if (e.direction === "across") acrossAt[`${r},${c}`] = e;
      else downAt[`${r},${c}`] = e;
    }
  }

  const isBlock = (r, c) => puzzle.layout[r][c] === "#";
  const entryAt = (r, c, dir) => (dir === "across" ? acrossAt : downAt)[`${r},${c}`] || null;

  return { acrossAt, downAt, numberAt, isBlock, entryAt };
}

export const clueId = (e) => `${e.direction}-${e.number}`;

const _ta = typeof document !== "undefined" ? document.createElement("textarea") : null;
export function decodeHtml(str) {
  if (!_ta) return str;
  _ta.innerHTML = str;
  return _ta.value;
}

// Cells of an entry, in order.
export function entryCells(e) {
  const out = [];
  for (let i = 0; i < e.length; i++) {
    const r = e.direction === "across" ? e.row : e.row + i;
    const c = e.direction === "across" ? e.col + i : e.col;
    out.push([r, c]);
  }
  return out;
}

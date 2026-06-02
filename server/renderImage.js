// Render a game's board to a PNG: a landscape "puzzle sheet" with the grid on
// the left and the clue list rendered into the image on the right. Landscape
// fills Discord's width-capped embed better (so it looks bigger) and moves the
// clues out of cluttered text fields. Falls back to null if canvas is missing.
let createCanvas = null;
try {
  ({ createCanvas } = await import("@napi-rs/canvas"));
} catch {
  console.warn("[render] @napi-rs/canvas not available — bot will use ASCII board.");
}

export const imageAvailable = () => !!createCanvas;

const GRID_LINE = "#9aa3b0";
const BG = "#0e1116";
const BLOCK = "#0b0d12";
const CELL = "#f7f7f2";
const CELL_SOLVED = "#bfe6cd";
const TEXT = "#11151c";
const TEXT_SOLVED = "#0c3a22";
const CLUE_TEXT = "#dfe6ef";
const CLUE_DONE = "#6b7686";
const HEADER = "#f2c14e";

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (!cur || ctx.measureText(test).width <= maxWidth) cur = test;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildClueLines(ctx, game, maxWidth) {
  const lines = [];
  for (const dir of ["across", "down"]) {
    lines.push({ kind: "header", text: dir === "across" ? "ACROSS" : "DOWN" });
    const entries = game.puzzleFull.entries.filter((e) => e.direction === dir);
    for (const e of entries) {
      const solved = game.solved.has(`${e.direction}-${e.number}`);
      const wrapped = wrapText(ctx, `${e.number}. ${e.clue}`, maxWidth);
      wrapped.forEach((t, i) => lines.push({ kind: "clue", text: i === 0 ? t : "    " + t, solved }));
    }
  }
  return lines;
}

export async function renderBoardPNG(game) {
  if (!createCanvas || !game.puzzleFull) return null;
  const p = game.puzzleFull;
  const W = p.width;
  const H = p.height;
  const cell = W <= 7 ? 70 : W <= 11 ? 52 : 40;
  const pad = 18;
  const gridW = W * cell;
  const gridH = H * cell;

  const clueColW = 470;
  const gap = 26;
  const lineH = 26;
  const clueFont = "20px sans-serif";
  const headerFont = "bold 22px sans-serif";

  // Pass 1 — lay out clue lines to size the canvas.
  const measure = createCanvas(10, 10).getContext("2d");
  measure.font = clueFont;
  let lines = buildClueLines(measure, game, clueColW - 12);
  const maxClueH = Math.max(gridH, 820);
  const fitCount = Math.floor(maxClueH / lineH);
  let truncated = 0;
  if (lines.length > fitCount) {
    truncated = game.puzzleFull.entries.length; // approx; show a hint instead of exact
    lines = lines.slice(0, fitCount - 1);
    lines.push({ kind: "more", text: "…more clues — tap a cell in the Activity or scroll" });
  }
  const cluesH = lines.length * lineH;

  const canvasW = pad + gridW + gap + clueColW + pad;
  const canvasH = pad + Math.max(gridH, cluesH) + pad;
  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // --- grid ---
  const numberAt = {};
  for (const e of p.entries) numberAt[`${e.row},${e.col}`] = e.number;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const x = pad + c * cell;
      const y = pad + r * cell;
      if (p.layout[r][c] === "#") {
        ctx.fillStyle = BLOCK;
        ctx.fillRect(x, y, cell, cell);
        continue;
      }
      const solved = game.solvedCells.has(`${r},${c}`);
      ctx.fillStyle = solved ? CELL_SOLVED : CELL;
      ctx.fillRect(x, y, cell, cell);
      ctx.strokeStyle = GRID_LINE;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cell, cell);

      const num = numberAt[`${r},${c}`];
      if (num != null) {
        ctx.fillStyle = "#5b636e";
        ctx.font = `${Math.round(cell * 0.27)}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(String(num), x + 3, y + 2);
      }
      const letter = game.fills[r][c];
      if (letter) {
        ctx.fillStyle = solved ? TEXT_SOLVED : TEXT;
        ctx.font = `bold ${Math.round(cell * 0.56)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(letter, x + cell / 2, y + cell * 0.6);
      }
    }
  }

  // --- clues ---
  const cx = pad + gridW + gap;
  let cy = pad;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const ln of lines) {
    if (ln.kind === "header") {
      cy += 6;
      ctx.fillStyle = HEADER;
      ctx.font = headerFont;
      ctx.fillText(ln.text, cx, cy);
    } else if (ln.kind === "more") {
      ctx.fillStyle = CLUE_DONE;
      ctx.font = "italic 18px sans-serif";
      ctx.fillText(ln.text, cx, cy);
    } else {
      ctx.fillStyle = ln.solved ? CLUE_DONE : CLUE_TEXT;
      ctx.font = clueFont;
      ctx.fillText((ln.solved ? "✓ " : "") + ln.text, cx, cy);
    }
    cy += lineH;
  }

  return canvas.encode("png");
}

// Render a game's board to PNGs: a grid image and a separate clues image.
// Uses a geometric sans (Jost — a free Futura-style face; drop a licensed
// Futura.ttf in assets/fonts to override). Falls back to null if canvas is
// missing (the bot then uses an ASCII board).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let createCanvas = null;
let FONT = "sans-serif";
try {
  const mod = await import("@napi-rs/canvas");
  createCanvas = mod.createCanvas;
  const fontsDir = path.join(__dirname, "assets", "fonts");
  const futura = path.join(fontsDir, "Futura.ttf"); // optional user-supplied
  const jost = path.join(fontsDir, "Jost.ttf");
  if (fs.existsSync(futura) && mod.GlobalFonts.registerFromPath(futura, "BoardFont")) FONT = "BoardFont";
  else if (fs.existsSync(jost) && mod.GlobalFonts.registerFromPath(jost, "BoardFont")) FONT = "BoardFont";
} catch {
  console.warn("[render] @napi-rs/canvas not available — bot will use ASCII board.");
}

export const imageAvailable = () => !!createCanvas;

const BG = "#0e1116";
const BLOCK = "#0b0d12";
const GRID_LINE = "#9aa3b0";
const CELL = "#f7f7f2";
const CELL_SOLVED = "#bfe6cd";
const TEXT = "#11151c";
const TEXT_SOLVED = "#0c3a22";
const CLUE = "#dfe6ef";
const CLUE_DONE = "#6b7686";
const HEADER = "#f2c14e";

// ---------------- grid image ----------------
export async function renderGridPNG(game) {
  if (!createCanvas || !game.puzzleFull) return null;
  const p = game.puzzleFull;
  const W = p.width;
  const H = p.height;
  const cell = W <= 7 ? 92 : W <= 11 ? 66 : 48; // bigger than before
  const pad = 20;
  const canvas = createCanvas(W * cell + pad * 2, H * cell + pad * 2);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

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
        ctx.font = `500 ${Math.round(cell * 0.25)}px ${FONT}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(String(num), x + 4, y + 3);
      }
      const letter = game.fills[r][c];
      if (letter) {
        ctx.fillStyle = solved ? TEXT_SOLVED : TEXT;
        ctx.font = `600 ${Math.round(cell * 0.58)}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(letter, x + cell / 2, y + cell * 0.6);
      }
    }
  }
  return canvas.encode("png");
}

// ---------------- clues image (two columns) ----------------
function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const out = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (!cur || ctx.measureText(test).width <= maxWidth) cur = test;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function columnLines(ctx, game, direction, maxWidth, fontSize) {
  ctx.font = `${fontSize}px ${FONT}`;
  const lines = [{ kind: "header", text: direction === "across" ? "ACROSS" : "DOWN" }];
  for (const e of game.puzzleFull.entries.filter((x) => x.direction === direction)) {
    const solved = game.solved.has(`${e.direction}-${e.number}`);
    wrapText(ctx, `${e.number}. ${e.clue} (${e.length})`, maxWidth).forEach((t, i) =>
      lines.push({ kind: "clue", text: i === 0 ? t : "    " + t, solved }),
    );
  }
  return lines;
}

export async function renderCluesPNG(game) {
  if (!createCanvas || !game.puzzleFull) return null;
  const fontSize = 18;
  const lineH = 24;
  const colW = 460;
  const gap = 34;
  const pad = 20;
  const maxRows = 46; // cap height so big grids don't make a giant image

  const measure = createCanvas(10, 10).getContext("2d");
  let across = columnLines(measure, game, "across", colW - 10, fontSize);
  let down = columnLines(measure, game, "down", colW - 10, fontSize);
  const cap = (lines) => {
    if (lines.length <= maxRows) return lines;
    const kept = lines.slice(0, maxRows - 1);
    kept.push({ kind: "more", text: "…more (use the Activity for the full list)" });
    return kept;
  };
  across = cap(across);
  down = cap(down);

  const rows = Math.max(across.length, down.length);
  const canvas = createCanvas(pad * 2 + colW * 2 + gap, pad * 2 + rows * lineH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const drawCol = (lines, x0) => {
    let y = pad;
    for (const ln of lines) {
      if (ln.kind === "header") {
        ctx.fillStyle = HEADER;
        ctx.font = `600 20px ${FONT}`;
      } else if (ln.kind === "more") {
        ctx.fillStyle = CLUE_DONE;
        ctx.font = `italic ${fontSize}px ${FONT}`;
      } else {
        ctx.fillStyle = ln.solved ? CLUE_DONE : CLUE;
        ctx.font = `${fontSize}px ${FONT}`;
      }
      ctx.fillText((ln.kind === "clue" && ln.solved ? "✓ " : "") + ln.text, x0, y);
      y += lineH;
    }
  };
  drawCol(across, pad);
  drawCol(down, pad + colW + gap);

  return canvas.encode("png");
}

// Render a game's board to a PNG (a real-looking crossword: numbered cells,
// black squares, letters, solved cells tinted). Used by the bot for a much
// nicer board than ASCII. Falls back gracefully if the canvas lib is missing.
let createCanvas = null;
try {
  ({ createCanvas } = await import("@napi-rs/canvas"));
} catch {
  console.warn("[render] @napi-rs/canvas not available — bot will use ASCII board.");
}

export const imageAvailable = () => !!createCanvas;

export async function renderBoardPNG(game) {
  if (!createCanvas || !game.puzzleFull) return null;
  const p = game.puzzleFull;
  const W = p.width;
  const H = p.height;
  // Smaller cells for big grids so the image stays a sane size.
  const cell = W > 10 ? 40 : 56;
  const pad = 14;
  const canvas = createCanvas(W * cell + pad * 2, H * cell + pad * 2);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0e1116";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const numberAt = {};
  for (const e of p.entries) numberAt[`${e.row},${e.col}`] = e.number;

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const x = pad + c * cell;
      const y = pad + r * cell;
      if (p.layout[r][c] === "#") {
        ctx.fillStyle = "#0b0d12";
        ctx.fillRect(x, y, cell, cell);
        continue;
      }
      const solved = game.solvedCells.has(`${r},${c}`);
      ctx.fillStyle = solved ? "#bfe6cd" : "#f7f7f2";
      ctx.fillRect(x, y, cell, cell);
      ctx.strokeStyle = "#9aa3b0";
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
        ctx.fillStyle = solved ? "#0c3a22" : "#11151c";
        ctx.font = `bold ${Math.round(cell * 0.56)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(letter, x + cell / 2, y + cell * 0.6);
      }
    }
  }
  return canvas.encode("png");
}

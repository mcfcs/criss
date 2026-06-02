import { memo } from "react";

function Grid({ puzzle, index, fills, solvedCells, selected, currentCells, onCellClick }) {
  const { width, height, layout } = puzzle;
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${width}, 1fr)`,
        gridTemplateRows: `repeat(${height}, 1fr)`,
        aspectRatio: `${width} / ${height}`,
        containerType: "inline-size",
        // 1cqw = 1% of grid width, so this equals the exact cell width in px.
        "--cell": `${100 / width}cqw`,
      }}
    >
      {Array.from({ length: height }).map((_, r) =>
        Array.from({ length: width }).map((__, c) => {
          const block = layout[r][c] === "#";
          if (block) return <div key={`${r},${c}`} className="cell block" />;
          const key = `${r},${c}`;
          const num = index.numberAt[key];
          const isSel = selected && selected.r === r && selected.c === c;
          const inWord = currentCells.has(key);
          const solved = solvedCells.has(key);
          const cls = [
            "cell",
            isSel ? "selected" : "",
            inWord && !isSel ? "highlight" : "",
            solved ? "solved" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={key} className={cls} onClick={() => onCellClick(r, c)}>
              {num != null && <span className="num">{num}</span>}
              <span className="letter">{fills[r][c] || ""}</span>
            </div>
          );
        }),
      )}
    </div>
  );
}

export default memo(Grid);

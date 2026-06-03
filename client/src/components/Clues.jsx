import { clueId, decodeHtml } from "../crossword/puzzle.js";

function ClueList({ title, entries, solved, currentId, onSelect }) {
  return (
    <div className="clue-list">
      <h3>{title}</h3>
      <ol>
        {entries.map((e) => {
          const id = clueId(e);
          const cls = [id === currentId ? "current" : "", solved.has(id) ? "done" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={id} className={cls} onClick={() => onSelect(e)}>
              <span className="cnum">{e.number}</span>
              <span className="ctext">{decodeHtml(e.clue)}</span>
              {solved.has(id) && <span className="check">✓</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function Clues({ puzzle, solved, currentId, onSelect }) {
  const across = puzzle.entries.filter((e) => e.direction === "across");
  const down = puzzle.entries.filter((e) => e.direction === "down");
  return (
    <div className="clues">
      <ClueList title="Across" entries={across} solved={solved} currentId={currentId} onSelect={onSelect} />
      <ClueList title="Down" entries={down} solved={solved} currentId={currentId} onSelect={onSelect} />
    </div>
  );
}

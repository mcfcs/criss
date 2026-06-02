function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function Scoreboard({ players, scores, meId, solvedCount, total, elapsedMs }) {
  const rows = players
    .map((p) => ({ ...p, score: scores[p.id] || 0 }))
    .sort((a, b) => b.score - a.score);
  const leader = rows.length && rows[0].score > 0 ? rows[0].id : null;

  return (
    <div className="scoreboard">
      <div className="score-head">
        <span className="progress">
          {solvedCount}/{total} solved
        </span>
        <span className="timer">{fmtTime(elapsedMs)}</span>
      </div>
      <ul className="players">
        {rows.map((p) => (
          <li key={p.id} className={[p.id === meId ? "me" : "", p.id === leader ? "leader" : ""].filter(Boolean).join(" ")}>
            <span className="pname">
              {p.id === leader ? "👑 " : ""}
              {p.username}
              {p.id === meId ? " (you)" : ""}
            </span>
            <span className="pscore">{p.score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { Navigate } from '../App';
import { PaperScreen } from '../components/ui';
import { loadLeaderboard, type BoardRow } from '../lib/vatar';

/** The Lagos Life leaderboard: total wins, best first. Only reachable from inside Lagos Life. */
export function Leaderboard({ navigate }: { navigate: Navigate }) {
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [me, setMe] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadLeaderboard()
      .then((b) => {
        if (!live) return;
        setRows(b.top);
        setMe(b.me?.label ?? '');
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  return (
    <PaperScreen title="Leaderboard" onBack={() => navigate({ name: 'home' })}>
      <p className="muted">Most wins in Lagos Life. Win games to climb!</p>
      {failed && <p className="muted">Couldn't load the board. Try again in a moment.</p>}
      {!rows && !failed && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && <p className="muted">No scores yet. Be the first!</p>}
      {rows && rows.length > 0 && (
        <ol className="board">
          {rows.map((r) => (
            <li key={r.rank}>
              <span className="board-rank">{r.rank}</span>
              <span className="board-name">{r.name}</span>
              <strong>{r.score}</strong>
            </li>
          ))}
        </ol>
      )}
      {me && <p className="hand">You: {me}</p>}
    </PaperScreen>
  );
}

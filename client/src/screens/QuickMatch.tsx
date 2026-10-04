import { useEffect, useState } from 'react';
import { QUICK_TARGET, QUICK_WAIT_SECONDS } from '@biro/shared';
import type { Navigate } from '../App';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Button, PaperScreen } from '../components/ui';
import { online, useOnline } from '../lib/online';
import { usePrefs } from '../lib/prefs';

const TIPS = [
  'Grab the pen near its tip and flick sideways to add spin.',
  'The orange cone means shaky aim: pulling all the way back is risky.',
  'You have 15 seconds a turn, so do not overthink it.',
  'Falling off yourself gives your opponent a point. Easy does it!',
  'The dotted line shows where your pen will go and what it will hit.',
];

/**
 * Quick match: wait for another player. If nobody turns up, offer the Computer so there is always a game to play.
 * When a partner is found the app takes both players straight to the table (see App).
 */
export function QuickMatch({ navigate }: { navigate: Navigate }) {
  const prefs = usePrefs();
  const net = useOnline();
  const [seconds, setSeconds] = useState(0);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);

  useEffect(() => {
    let alive = true;
    void online.quickJoin(prefs.name.trim() || 'Player', prefs.skin).then((r) => {
      if (!alive) return;
      if (r.ok) setJoined(true);
      else setError(r.error);
    });
    const tick = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      alive = false;
      window.clearInterval(tick);
      online.quickCancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function playComputer() {
    online.quickCancel();
    navigate({ name: 'game-ai', difficulty: prefs.difficulty, target: QUICK_TARGET });
  }

  const long = seconds >= QUICK_WAIT_SECONDS;

  return (
    <PaperScreen title="Quick match" onBack={() => navigate({ name: 'online' })}>
      <div className="lobby">
        <div className="matchup">
          <PlayerAvatar name={prefs.name || 'You'} skin={prefs.skin} size={76} />
          <span className="vs marker">vs</span>
          <span className="avatar-empty marker" aria-hidden="true">
            ?
          </span>
        </div>

        {error ? (
          <>
            <p className="error-msg">{error}</p>
            <Button variant="blue" onClick={() => navigate({ name: 'online' })}>
              Back
            </Button>
          </>
        ) : !long ? (
          <>
            <p className="hand big">
              Looking for an opponent<span className="dots" />
            </p>
            <p className="muted">{joined ? `Searching for ${seconds}s · first to ${QUICK_TARGET}` : 'Connecting to the server…'}</p>
            <p className="muted small">Tip: {tip}</p>
          </>
        ) : (
          <div className="sticky-card yellow quick-fallback">
            <h2 className="marker">{joined ? "Nobody's around right now" : 'The server is slow to answer'}</h2>
            <p className="muted">{joined ? 'Play the Computer while you wait, or keep looking.' : 'It may be waking up. You can play the Computer in the meantime.'}</p>
            <Button variant="blue" size="lg" onClick={playComputer}>
              🤖 Play the Computer
            </Button>
            <Button variant="ghost" onClick={() => setSeconds(0)}>
              Keep waiting
            </Button>
          </div>
        )}
        {net.connection === 'reconnecting' && <p className="error-msg">Connection lost, reconnecting…</p>}
      </div>
      <div className="grow" />
      <p className="muted small center">Messages are switched off in quick matches; reactions still work.</p>
    </PaperScreen>
  );
}

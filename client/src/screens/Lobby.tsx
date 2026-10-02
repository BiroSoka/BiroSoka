import { useMemo, useState } from 'react';
import { ROYALE, distinctSkinList } from '@biro/shared';
import type { Navigate } from '../App';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Button, PaperScreen } from '../components/ui';
import { online, useOnline } from '../lib/online';
import { usePrefs } from '../lib/prefs';

export function Lobby({ navigate }: { navigate: Navigate }) {
  const net = useOnline();
  const prefs = usePrefs();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const room = net.room;
  const royale = room?.mode === 'royale';
  const code = room?.code ?? '-----';
  const link = `${window.location.origin}/?room=${code}`;
  const isHost = net.seat === 0;

  async function share() {
    const text = royale ? `Fancy a Battle Royale of Biro Soka? Join with code ${code}` : `Fancy a game of Biro Soka? Join with code ${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Biro Soka', text, url: link });
        return;
      } catch {
        /* cancelled: fall through to copy */
      }
    }
    await copy(`${text}\n${link}`);
  }

  async function copy(value = code) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  }

  function cancel() {
    online.leave();
    navigate({ name: 'online' });
  }

  async function start() {
    setError(null);
    setStarting(true);
    const r = await online.startRoyale();
    setStarting(false);
    if (!r.ok) setError(r.error);
  }

  // Pens are made distinct so the roster shows the colours people will really play with.
  const seats = [0, 1, 2, 3].filter((i) => room?.players[i]);
  const skinsKey = seats.map((i) => room!.players[i]!.skin).join();
  const skins = useMemo(() => {
    const list = distinctSkinList(seats.map((i) => room!.players[i]!.skin));
    const out: Record<number, string> = {};
    seats.forEach((seat, k) => (out[seat] = list[k]));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skinsKey, seats.join()]);

  if (room?.status === 'abandoned') {
    return (
      <PaperScreen title="Waiting room" onBack={cancel}>
        <p className="error-msg">{net.error ?? 'The host left, so this game is over.'}</p>
        <div className="grow" />
        <Button variant="blue" onClick={cancel}>
          Back to menu
        </Button>
      </PaperScreen>
    );
  }

  if (royale) {
    const joined = seats.length;
    const canStart = joined >= ROYALE.minPlayers;
    return (
      <PaperScreen title="Battle Royale" onBack={cancel}>
        <div className="lobby">
          <p className="hand big">{isHost ? 'Send this code to your friends' : 'Waiting in the lobby'}</p>
          <button type="button" className="room-code" onClick={() => copy()} aria-label={`Room code ${code}, tap to copy`}>
            {code.split('').map((c, i) => (
              <span key={i}>{c}</span>
            ))}
          </button>
          <p className="muted">{copied ? 'Copied!' : 'Tap the code to copy it'}</p>
          <div className="lobby-actions">
            <Button variant="red" onClick={share}>
              📨 Share invite
            </Button>
          </div>

          <ul className="roster" aria-label="Players">
            {[0, 1, 2, 3].map((seat) => {
              const p = room?.players[seat] ?? null;
              return p ? (
                <li key={seat} className={`roster-slot ${p.connected ? '' : 'offline'}`}>
                  <PlayerAvatar name={p.name} skin={skins[seat]} size={52} />
                  <strong>{seat === net.seat ? `${p.name} (you)` : p.name}</strong>
                  <small>{seat === 0 ? '👑 host' : p.connected ? `player ${seat + 1}` : 'offline'}</small>
                </li>
              ) : (
                <li key={seat} className="roster-slot empty">
                  <span className="avatar-empty marker" aria-hidden="true">
                    ?
                  </span>
                  <strong>Waiting…</strong>
                  <small>seat {seat + 1}</small>
                </li>
              );
            })}
          </ul>
          <p className="muted small">
            First to {room?.target ?? prefs.target} · play goes clockwise · last pen on the desk scores · 15 seconds a turn
          </p>
          {net.connection === 'reconnecting' && <p className="error-msg">Connection lost, reconnecting…</p>}
          {error && <p className="error-msg">{error}</p>}
        </div>
        <div className="grow" />
        {isHost ? (
          <Button variant="blue" size="lg" onClick={start} disabled={!canStart || starting}>
            {starting ? 'Starting…' : canStart ? `Start game (${joined} players)` : `Need ${ROYALE.minPlayers - joined} more player${ROYALE.minPlayers - joined > 1 ? 's' : ''}…`}
          </Button>
        ) : (
          <p className="hand big center">
            Waiting for the host to start<span className="dots" />
          </p>
        )}
        <Button variant="ghost" onClick={cancel}>
          {isHost ? 'Cancel' : 'Leave'}
        </Button>
      </PaperScreen>
    );
  }

  return (
    <PaperScreen title="Waiting room" onBack={cancel}>
      <div className="lobby">
        <p className="hand big">Send this code to your friend</p>
        <button type="button" className="room-code" onClick={() => copy()} aria-label={`Room code ${code}, tap to copy`}>
          {code.split('').map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </button>
        <p className="muted">{copied ? 'Copied!' : 'Tap the code to copy it'}</p>

        <div className="lobby-actions">
          <Button variant="red" size="lg" onClick={share}>
            📨 Share invite
          </Button>
        </div>

        <div className="matchup">
          <PlayerAvatar name={prefs.name || 'You'} skin={prefs.skin} size={76} />
          <span className="vs marker">vs</span>
          <span className="avatar-empty marker" aria-hidden="true">?</span>
        </div>
        <p className="hand">
          Waiting for a challenger<span className="dots" />
        </p>
        <p className="muted small">First to {room?.target ?? prefs.target} · a coin toss decides who starts</p>
        {net.connection === 'reconnecting' && <p className="error-msg">Connection lost, reconnecting…</p>}
      </div>
      <div className="grow" />
      <Button variant="ghost" onClick={cancel}>
        Cancel
      </Button>
    </PaperScreen>
  );
}

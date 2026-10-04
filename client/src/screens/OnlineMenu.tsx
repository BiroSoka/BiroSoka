import { useEffect, useState } from 'react';
import { CODE_LENGTH, ROYALE, TARGET_SCORES, normalizeCode, type GameMode } from '@biro/shared';
import type { Navigate } from '../App';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Button, PaperScreen, Segmented } from '../components/ui';
import { online, useOnline } from '../lib/online';
import { setPrefs, usePrefs } from '../lib/prefs';

export function OnlineMenu({ navigate, initialCode }: { navigate: Navigate; initialCode?: string }) {
  const prefs = usePrefs();
  const net = useOnline();
  const [code, setCode] = useState(initialCode ?? '');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<GameMode>('duel');

  useEffect(() => {
    online.connect();
  }, []);

  const name = prefs.name.trim();
  const needName = name.length === 0;

  async function create() {
    if (needName) return setError('Pop your name in first.');
    setBusy('create');
    setError(null);
    const target = mode === 'royale' && !ROYALE.targets.includes(prefs.target) ? ROYALE.defaultTarget : prefs.target;
    const r = await online.create(name, prefs.skin, target, mode);
    setBusy(null);
    if (r.ok) {
      if (mode === 'royale') setPrefs({ seenRoyale: true });
      navigate({ name: 'lobby' });
    } else setError(r.error);
  }

  async function join() {
    if (needName) return setError('Pop your name in first.');
    if (code.length !== CODE_LENGTH) return setError(`Room codes are ${CODE_LENGTH} characters.`);
    setBusy('join');
    setError(null);
    const r = await online.joinRoom(code, name, prefs.skin);
    setBusy(null);
    if (r.ok) {
      if (r.room.mode === 'royale') setPrefs({ seenRoyale: true });
      navigate(r.room.mode === 'royale' ? { name: 'lobby' } : { name: 'game-online' });
    } else setError(r.error);
  }

  function quick() {
    if (needName) return setError('Pop your name in first.');
    setError(null);
    navigate({ name: 'quickmatch' });
  }

  const targets: readonly number[] = mode === 'royale' ? ROYALE.targets : TARGET_SCORES;
  const shownTarget = targets.includes(prefs.target) ? prefs.target : mode === 'royale' ? ROYALE.defaultTarget : prefs.target;

  // A sleeping free host can take up to a minute to answer: say so instead of leaving people guessing.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (net.connection === 'online') {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(t);
  }, [net.connection]);
  const status =
    net.connection === 'online'
      ? 'Connected'
      : net.connection === 'idle'
        ? ''
        : slow
          ? 'Still connecting. The server may be waking up, which can take up to a minute…'
          : 'Connecting to server…';

  return (
    <PaperScreen title="Play a Friend" onBack={() => navigate({ name: 'home' })}>
      <button type="button" className="guide-link" onClick={() => navigate({ name: 'howto-online' })}>
        <span aria-hidden="true">📖</span> First time? See how to play with a friend
      </button>

      <section className="field">
        <div className="name-head">
          <label className="hand" htmlFor="name">
            Your name
          </label>
          <PlayerAvatar name={prefs.name || 'You'} skin={prefs.skin} size={40} />
        </div>
        <input
          id="name"
          className="text-input"
          maxLength={16}
          placeholder="e.g. Tunde"
          value={prefs.name}
          autoComplete="nickname"
          onChange={(e) => setPrefs({ name: e.target.value })}
        />
      </section>

      <section className="quick-card">
        <Button variant="green" size="lg" onClick={quick} disabled={busy !== null}>
          ⚡ Quick match
        </Button>
        <p className="muted small">Play someone online right now. No code needed.</p>
      </section>

      <div className="or hand">or play a friend</div>

      <section className="sticky-card">
        <h2 className="marker">Join a game</h2>
        <p className="muted">Got a code from a friend? Type it in.</p>
        <div className="join-row">
          <input
            className="code-input"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="TG482"
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            aria-label="Room code"
          />
          <Button variant="red" onClick={join} disabled={busy !== null}>
            {busy === 'join' ? 'Joining…' : 'Join'}
          </Button>
        </div>
      </section>

      <div className="or hand">or</div>

      <section className="sticky-card yellow">
        <h2 className="marker">Start a game</h2>
        <Segmented
          label="Game mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'duel' as GameMode, label: '1 vs 1' },
            {
              value: 'royale' as GameMode,
              label: (
                <>
                  ⚔️ Battle Royale
                  {!prefs.seenRoyale && <span className="new-badge">NEW</span>}
                </>
              ),
            },
          ]}
        />
        <p className="muted">
          {mode === 'royale'
            ? 'Up to 4 friends on one desk. Last pen standing scores a point. You get a code to share.'
            : "You'll get a code to send your friend."}
        </p>
        <Segmented
          label="Target score"
          value={shownTarget}
          onChange={(target) => setPrefs({ target })}
          options={targets.map((t) => ({ value: t as number, label: `First to ${t}` }))}
        />
        <Button variant="blue" onClick={create} disabled={busy !== null} className="full">
          {busy === 'create' ? 'Creating…' : 'Create room'}
        </Button>
      </section>

      {error && <p className="error-msg">{error}</p>}
      <p className="status-line muted">{status}</p>
    </PaperScreen>
  );
}

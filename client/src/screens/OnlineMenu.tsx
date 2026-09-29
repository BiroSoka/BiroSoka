import { useEffect, useState } from 'react';
import { CODE_LENGTH, TARGET_SCORES, normalizeCode } from '@biro/shared';
import type { Navigate } from '../App';
import { Button, PaperScreen, Segmented } from '../components/ui';
import { online, useOnline } from '../lib/online';
import { setPrefs, usePrefs } from '../lib/prefs';

export function OnlineMenu({ navigate, initialCode }: { navigate: Navigate; initialCode?: string }) {
  const prefs = usePrefs();
  const net = useOnline();
  const [code, setCode] = useState(initialCode ?? '');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    online.connect();
  }, []);

  const name = prefs.name.trim();
  const needName = name.length === 0;

  async function create() {
    if (needName) return setError('Pop your name in first.');
    setBusy('create');
    setError(null);
    const r = await online.create(name, prefs.skin, prefs.target);
    setBusy(null);
    if (r.ok) navigate({ name: 'lobby' });
    else setError(r.error);
  }

  async function join() {
    if (needName) return setError('Pop your name in first.');
    if (code.length !== CODE_LENGTH) return setError(`Room codes are ${CODE_LENGTH} characters.`);
    setBusy('join');
    setError(null);
    const r = await online.joinRoom(code, name, prefs.skin);
    setBusy(null);
    if (r.ok) navigate({ name: 'game-online' });
    else setError(r.error);
  }

  const status = net.connection === 'online' ? 'Connected' : net.connection === 'idle' ? '' : 'Connecting to server…';

  return (
    <PaperScreen title="Play a Friend" onBack={() => navigate({ name: 'home' })}>
      <button type="button" className="guide-link" onClick={() => navigate({ name: 'howto-online' })}>
        <span aria-hidden="true">📖</span> First time? See how to play with a friend
      </button>

      <section className="field">
        <label className="hand" htmlFor="name">
          Your name
        </label>
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
        <p className="muted">You'll get a code to send your friend.</p>
        <Segmented
          label="Target score"
          value={prefs.target}
          onChange={(target) => setPrefs({ target })}
          options={TARGET_SCORES.map((t) => ({ value: t as number, label: `First to ${t}` }))}
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

import { useState } from 'react';
import type { Navigate } from '../App';
import { Button, PaperScreen, PenPreview } from '../components/ui';
import { online, useOnline } from '../lib/online';
import { usePrefs } from '../lib/prefs';

export function Lobby({ navigate }: { navigate: Navigate }) {
  const net = useOnline();
  const prefs = usePrefs();
  const [copied, setCopied] = useState(false);
  const code = net.room?.code ?? '-----';
  const link = `${window.location.origin}/?room=${code}`;

  async function share() {
    const text = `Fancy a game of Biro Soka? Join with code ${code}`;
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

        <div className="waiting-pen">
          <PenPreview skin={prefs.skin} width={160} height={160} angle={0.8} className="spin" />
        </div>
        <p className="hand">
          Waiting for a challenger<span className="dots" />
        </p>
        <p className="muted small">First to {net.room?.target ?? prefs.target} · you go first</p>
        {net.connection === 'reconnecting' && <p className="error-msg">Connection lost, reconnecting…</p>}
      </div>
      <div className="grow" />
      <Button variant="ghost" onClick={cancel}>
        Cancel
      </Button>
    </PaperScreen>
  );
}

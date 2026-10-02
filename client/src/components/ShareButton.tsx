import { useEffect, useRef, useState } from 'react';
import type { TableThemeId } from '@biro/shared';
import { sfx } from '../lib/audio';
import { renderShareCard, shareResult, type ShareOutcome } from '../lib/shareCard';
import { Button } from './ui';

const MESSAGES: Record<ShareOutcome, string> = {
  shared: 'Shared! 🎉',
  cancelled: '',
  saved: 'Picture saved. Post it anywhere!',
  'saved-copied': 'Picture saved and link copied. Post it anywhere!',
  copied: 'Link copied. Paste it anywhere!',
  failed: "Couldn't share from here. Try again?",
};

interface Props {
  name: string;
  headline: string;
  score: string;
  detail: string;
  skinId: string;
  table: TableThemeId;
  /** The message that goes with the picture. */
  text: string;
}

/** "Share my win": makes a picture of the result and sends it to the phone's share sheet. */
export function ShareButton({ text, ...info }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const building = useRef<Promise<File | null> | null>(null);

  function build(): Promise<File | null> {
    if (!building.current) {
      building.current = (async () => {
        try {
          // The winner's avatar is already on the win screen; the picture reuses it.
          const svg = document.querySelector<SVGElement>('.result-avatar svg');
          const blob = await renderShareCard(info, svg);
          const f = new File([blob], 'biro-soka-win.jpg', { type: 'image/jpeg' });
          setFile(f);
          return f;
        } catch {
          return null; // share the text and link only
        }
      })();
    }
    return building.current;
  }

  // Make the picture as soon as the win screen appears, so Share is instant when tapped
  // (phones only allow the share sheet straight after a tap).
  useEffect(() => {
    void build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onClick() {
    if (busy) return;
    sfx.tap();
    setBusy(true);
    setMessage('');
    const ready = file ?? (await build());
    const outcome = await shareResult(ready, text);
    setBusy(false);
    setMessage(MESSAGES[outcome]);
  }

  return (
    <>
      <Button variant="yellow" onClick={onClick} disabled={busy}>
        📤 Share my win
      </Button>
      {message && <p className="muted small share-msg">{message}</p>}
    </>
  );
}

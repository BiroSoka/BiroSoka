import { useState, type FormEvent } from 'react';
import { CHAT_MAX, EMOTES, cleanChat, getSkin, type Emote } from '@biro/shared';
import { sfx } from '../lib/audio';
import { PlayerAvatar } from './PlayerAvatar';

export interface ChatLine {
  id: number;
  seat: number;
  text: string;
}

/** The smiley button: opens a small panel with quick reactions and a box for a short typed message. */
export function ReactionDock({ onEmote, onSend, textEnabled = true }: { onEmote: (e: Emote) => void; onSend: (text: string) => Promise<string | null>; textEnabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clean = cleanChat(text);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!clean || busy) return;
    setBusy(true);
    const problem = await onSend(clean);
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setText('');
    setError(null);
    setOpen(false);
  }

  return (
    <div className="emote-wrap">
      <button
        type="button"
        className="emote-btn"
        onClick={() => {
          sfx.tap();
          setOpen((o) => !o);
          setError(null);
        }}
        aria-label="Send a reaction or message"
        aria-expanded={open}
      >
        😄
      </button>
      {open && (
        <div className="emote-menu chat-panel">
          <div className="emote-row">
            {EMOTES.map((e) => (
              <button
                type="button"
                key={e}
                onClick={() => {
                  onEmote(e);
                  setOpen(false);
                }}
              >
                {e}
              </button>
            ))}
          </div>
          {textEnabled && (
          <form className="chat-form" onSubmit={submit}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={CHAT_MAX}
              placeholder="Say something…"
              enterKeyHint="send"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Message"
            />
            <button type="submit" disabled={!clean || busy}>
              Send
            </button>
          </form>
          )}
          <small className={`chat-hint ${error ? 'bad' : ''}`}>{!textEnabled ? 'Messages are off in quick matches. Reactions still work!' : (error ?? `${clean.length}/${CHAT_MAX} · only the other players see it`)}</small>
        </div>
      )}
    </div>
  );
}

/** Recent messages, shown for a few seconds and then gone. Text is rendered as plain text. */
export function ChatFeed({ lines, who }: { lines: ChatLine[]; who: (seat: number) => { name: string; skin: string } | null }) {
  return (
    <div className="chat-feed" aria-live="polite">
      {lines.slice(-3).map((l) => {
        const p = who(l.seat);
        return (
          <div key={l.id} className="chat-line" style={{ ['--pen' as string]: getSkin(p?.skin).capColor }}>
            <PlayerAvatar name={p?.name ?? ''} skin={p?.skin ?? 'blue'} size={22} />
            <span>
              <b>{p?.name || 'Player'}</b> {l.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { SKINS, cleanChat, distinctSkinList, getSkin, type Emote, type RoyaleState } from '@biro/shared';
import type { Navigate } from '../App';
import { ChatFeed, ReactionDock, type ChatLine } from '../components/ChatDock';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { TurnTimer } from '../components/TurnTimer';
import { Button, Confetti, Modal, Toggle } from '../components/ui';
import { getPrefs, isUnlocked, setPrefs, unlockedSkins, usePrefs } from '../lib/prefs';
import { RoyaleController, type RoyaleEvent, type RoyaleHud, type RoyalePhase } from '../game/royaleController';
import { sfx } from '../lib/audio';
import { music } from '../lib/music';
import { online, useOnline } from '../lib/online';
import { pickQuip } from '../lib/quips';
import { onlineSecondsLeft, useTurnClock } from '../lib/turnClock';
import { useAudioState } from '../lib/useAudio';

interface Toast {
  id: number;
  title: string;
  sub: string;
  quip?: string;
  tone: 'good' | 'bad' | 'neutral';
}

const shortName = (n: string) => (n.length > 9 ? `${n.slice(0, 8)}…` : n);

export function RoyaleScreen({ navigate }: { navigate: Navigate }) {
  const prefs = usePrefs();
  const net = useOnline();
  const audioState = useAudioState();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrlRef = useRef<RoyaleController | null>(null);
  const [hud, setHud] = useState<RoyaleHud | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [paused, setPaused] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [chats, setChats] = useState<ChatLine[]>([]);
  const [bubbles, setBubbles] = useState<{ id: number; seat: number; emote: Emote }[]>([]);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [startState] = useState<RoyaleState | null>(() => online.getState().room?.royale ?? null);
  const recordedRef = useRef<number | null>(null);

  const room = net.room;
  const mySeat = net.seat ?? 0;

  // ---- who is who ---------------------------------------------------------
  const seatInfo = (i: number) => room?.players[i] ?? null;
  const present = [0, 1, 2, 3].filter((i) => seatInfo(i) !== null);
  const skinsKey = present.map((i) => seatInfo(i)!.skin).join();
  const skins = useMemo(() => {
    const list = distinctSkinList(present.map((i) => seatInfo(i)!.skin));
    const out = ['blue', 'red', 'green', 'black'];
    present.forEach((seat, k) => (out[seat] = list[k]));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skinsKey, present.join()]);
  const names = [0, 1, 2, 3].map((i) => seatInfo(i)?.name ?? '');
  const namesRef = useRef(names);
  namesRef.current = names;

  // ---- controller lifecycle -----------------------------------------------
  useEffect(() => {
    if (!startState) {
      navigate({ name: 'online' });
      return;
    }
    const p = getPrefs();
    const ctrl = new RoyaleController({
      canvas: canvasRef.current!,
      mySeat,
      skins,
      names: namesRef.current,
      state: startState,
      startHeld: startState.shotNo === 0,
      prefs: { guide: p.guide, haptics: p.haptics, theme: p.table },
      onHud: setHud,
      sendShot: (flick, shotNo) => online.shot(flick, shotNo),
    });
    ctrlRef.current = ctrl;
    setHud(ctrl.hud);

    const offShot = online.onRoyaleShot((m) => ctrl.receiveShot(m));
    const offEmote = online.onEmote(({ seat, emote }) => showBubble(seat, emote));
    const offChat = online.onChat(({ seat, text }) => showChat(seat, text));
    // The server's clock ran out for someone, or a player left.
    const offSkip = online.onSkip((m) => {
      if (!m.royale) return;
      ctrl.applyServerState(m.royale);
      const who = namesRef.current[m.seat] || 'Someone';
      if (!m.royale.active[m.seat]) showNotice('PLAYER LEFT', `${who} left the game`);
      else showNotice("TIME'S UP!", m.seat === online.getState().seat ? 'Your turn passes' : `${who} lost their turn`);
    });
    return () => {
      offShot();
      offEmote();
      offChat();
      offSkip();
      ctrl.destroy();
      ctrlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    ctrlRef.current?.setPrefs({ guide: prefs.guide, haptics: prefs.haptics, theme: prefs.table });
  }, [prefs.guide, prefs.haptics, prefs.table]);

  useEffect(() => {
    ctrlRef.current?.setLooks(skins, names);
  }, [skins, names.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Server snapshots keep the table in step (reconnects, missed messages, the host starting another match).
  useEffect(() => {
    if (room?.royale) ctrlRef.current?.offerSnapshot(room.royale);
  }, [room?.royale]);

  // Music plays only while a match is on screen, and follows both the music and sound switches.
  useEffect(() => {
    if (prefs.music && prefs.sound) music.start();
    else music.stop();
    return () => music.stop();
  }, [prefs.music, prefs.sound]);

  const secondsLeft = useTurnClock(onlineSecondsLeft);

  // ---- toasts -------------------------------------------------------------
  function showNotice(title: string, sub: string) {
    const id = Date.now() + Math.random();
    setToast({ id, title, sub, tone: 'neutral' });
    window.setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), 1900);
  }

  function showBubble(seat: number, emote: Emote) {
    const id = Date.now() + Math.random();
    setBubbles((b) => [...b, { id, seat, emote }]);
    window.setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), 2200);
  }

  function sendEmote(e: Emote) {
    online.emote(e);
    showBubble(mySeat, e);
  }

  function showChat(seat: number, text: string) {
    const id = Date.now() + Math.random();
    setChats((c) => [...c.slice(-4), { id, seat, text }]);
    window.setTimeout(() => setChats((c) => c.filter((x) => x.id !== id)), 6500);
  }

  /** Returns a problem to show the player, or null when the message went out. */
  async function sendChat(raw: string): Promise<string | null> {
    const text = cleanChat(raw);
    if (!text) return null;
    const r = await online.chat(text);
    if (!r.ok) return r.error;
    showChat(mySeat, text);
    return null;
  }

  const eventId = hud?.event?.id;
  useEffect(() => {
    const ev = hud?.event;
    if (!ev) return;
    const t = describeEvent(ev, mySeat, namesRef.current);
    if (!t) return;
    setToast(t);
    const timer = window.setTimeout(() => setToast((cur) => (cur?.id === t.id ? null : cur)), 2100);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // ---- results ------------------------------------------------------------
  const state = hud?.state;
  const over = hud?.phase === 'over' && state?.winner != null;
  const iWon = over && state!.winner === mySeat;
  const abandoned = room?.status === 'abandoned';

  useEffect(() => {
    if (!over || !state) return;
    if (recordedRef.current === state.seed) return;
    recordedRef.current = state.seed;
    const before = unlockedSkins(getPrefs().stats);
    setPrefs((p) => {
      const s = { ...p.stats };
      if (iWon) s.onlineWins++;
      else s.onlineLosses++;
      return { stats: s };
    });
    const after = SKINS.filter((s) => isUnlocked(s, getPrefs().stats)).map((s) => s.id);
    setUnlocked(after.filter((id) => !before.includes(id)));
  }, [over, state, iWon]);

  useEffect(() => {
    if (hud?.phase === 'intro') setUnlocked([]);
  }, [hud?.phase]);

  const isHost = mySeat === 0;
  const [startError, setStartError] = useState<string | null>(null);
  async function playAgain() {
    setStartError(null);
    const r = await online.startRoyale();
    if (!r.ok) setStartError(r.error);
  }

  function quit() {
    online.leave();
    navigate({ name: 'online' });
  }

  // ---- render -------------------------------------------------------------
  const phase: RoyalePhase = hud?.phase ?? 'ready';
  const offline = present.filter((i) => i !== mySeat && state?.active[i] && !seatInfo(i)!.connected);
  const iAmOut = !!state && state.winner === null && state.active[mySeat] && !state.alive[mySeat];
  const ranking = state
    ? [0, 1, 2, 3]
        .filter((i) => seatInfo(i) !== null && (state.active[i] || state.scores[i] > 0))
        .sort((a, b) => state.scores[b] - state.scores[a] || a - b)
    : [];

  return (
    <div className="game" onPointerDown={() => { sfx.unlock(); if (prefs.music) music.start(); }}>
      <div className="stage">
        <canvas ref={canvasRef} className="table-canvas" />
      </div>

      {state && (
        <header className="hud hud-royale">
          <button type="button" className="hud-menu" onClick={() => setPaused(true)} aria-label="Pause">
            <span />
            <span />
            <span />
          </button>
          <div className="royale-chips">
            {present.map((seat) => (
              <RoyaleChip
                key={seat}
                name={seat === mySeat ? 'You' : shortName(names[seat])}
                avatarName={names[seat]}
                skin={skins[seat]}
                score={state.scores[seat]}
                active={state.turn === seat && state.winner === null && state.alive[seat]}
                out={state.active[seat] && !state.alive[seat] && state.winner === null}
                left={!state.active[seat]}
                offline={state.active[seat] && !seatInfo(seat)!.connected}
                bubble={bubbles.filter((b) => b.seat === seat).at(-1)?.emote}
              />
            ))}
          </div>
          <div className="hud-target">
            <small>first to</small>
            <strong>{state.target}</strong>
          </div>
        </header>
      )}

      {secondsLeft !== null && state && state.winner === null && phase !== 'intro' && !abandoned && (
        <TurnTimer seconds={secondsLeft} mine={state.turn === mySeat && state.alive[mySeat]} name={state.turn === mySeat ? undefined : shortName(names[state.turn])} />
      )}

      {toast && (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          <strong className="marker">{toast.title}</strong>
          <span>{toast.sub}</span>
          {toast.quip && <em className="quip">{toast.quip}</em>}
        </div>
      )}

      {phase === 'intro' && state && (
        <RoyaleIntro state={state} names={names} skins={skins} mySeat={mySeat} onDone={() => ctrlRef.current?.release()} />
      )}

      <ChatFeed lines={chats} who={(seat) => ({ name: names[seat] || 'Player', skin: skins[seat] })} />

      <footer className="hint">
        <span>{hintFor(phase, state, mySeat, names, iAmOut)}</span>
        <ReactionDock onEmote={sendEmote} onSend={sendChat} />
      </footer>

      {prefs.sound && audioState !== 'running' && <div className="sound-pill">🔈 Tap the screen to turn sound on</div>}
      {offline.length > 0 && !abandoned && (
        <div className="banner">{offline.map((i) => names[i]).join(', ')} {offline.length > 1 ? 'are' : 'is'} offline. Their turns are skipped after 15s.</div>
      )}
      {net.connection === 'reconnecting' && <div className="banner warn">You're offline. Reconnecting…</div>}

      {paused && !confirmQuit && (
        <Modal onClose={() => setPaused(false)}>
          <h2 className="marker">Paused</h2>
          <p className="muted small">The game keeps running for everyone else. Your 15 seconds still count.</p>
          <div className="modal-body">
            <Toggle label="Sound effects" checked={prefs.sound} onChange={(sound) => setPrefs({ sound })} />
            <Toggle label="Music" checked={prefs.music} onChange={(m) => setPrefs({ music: m })} />
            <Toggle label="Long aim guide" checked={prefs.guide === 'long'} onChange={(v) => setPrefs({ guide: v ? 'long' : 'short' })} />
          </div>
          <div className="modal-actions">
            <Button variant="blue" onClick={() => setPaused(false)}>
              Resume
            </Button>
            <Button variant="ghost" onClick={() => (over ? quit() : setConfirmQuit(true))}>
              Quit game
            </Button>
          </div>
        </Modal>
      )}

      {confirmQuit && (
        <Modal onClose={() => setConfirmQuit(false)}>
          <h2 className="marker">Quit?</h2>
          <p className="modal-body">{isHost ? 'You are the host, so this ends the game for everyone.' : 'The others carry on without you.'}</p>
          <div className="modal-actions">
            <Button variant="red" onClick={quit}>
              Quit
            </Button>
            <Button variant="ghost" onClick={() => setConfirmQuit(false)}>
              Keep playing
            </Button>
          </div>
        </Modal>
      )}

      {over && state && !abandoned && (
        <Modal>
          {iWon && <Confetti />}
          <PlayerAvatar name={names[state.winner!]} skin={skins[state.winner!]} size={84} className="result-avatar" />
          <h2 className={`marker result ${iWon ? 'win' : 'lose'}`}>{iWon ? 'You win!' : `${names[state.winner!]} wins`}</h2>
          <ol className="ranking">
            {ranking.map((seat) => (
              <li key={seat} className={seat === state.winner ? 'first' : ''}>
                <PlayerAvatar name={names[seat]} skin={skins[seat]} size={28} />
                <span className="rk-name">{seat === mySeat ? `${names[seat]} (you)` : names[seat]}</span>
                <strong>{state.scores[seat]}</strong>
              </li>
            ))}
          </ol>
          {unlocked.length > 0 && (
            <div className="unlock-banner">
              🎉 New pen unlocked: <b>{unlocked.map((id) => getSkin(id).name).join(', ')}</b>
            </div>
          )}
          <div className="modal-actions">
            {isHost ? (
              <Button variant="blue" onClick={playAgain}>
                Play again
              </Button>
            ) : (
              <p className="muted small">Waiting for the host to start another game…</p>
            )}
            {startError && <p className="error-msg">{startError}</p>}
            <Button variant="ghost" onClick={quit}>
              Menu
            </Button>
          </div>
        </Modal>
      )}

      {abandoned && (
        <Modal>
          <h2 className="marker">Game over</h2>
          <p className="modal-body">{net.error ?? 'The host left the game.'}</p>
          <div className="modal-actions">
            <Button variant="blue" onClick={quit}>
              Back to menu
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RoyaleChip({
  name,
  avatarName,
  skin,
  score,
  active,
  out,
  left,
  offline,
  bubble,
}: {
  name: string;
  avatarName: string;
  skin: string;
  score: number;
  active: boolean;
  out: boolean;
  left: boolean;
  offline: boolean;
  bubble?: Emote;
}) {
  return (
    <div className={`rchip ${active ? 'active' : ''} ${out ? 'out' : ''} ${left ? 'left' : ''}`} style={{ ['--pen' as string]: getSkin(skin).capColor }}>
      <span className="rchip-face">
        <PlayerAvatar name={avatarName} skin={skin} size={30} />
        {out && <i className="rchip-x" aria-label="out this round">✖</i>}
        {offline && <i className="rchip-off" aria-label="offline">⚡</i>}
      </span>
      <span className="rchip-score" key={score}>
        {score}
      </span>
      <span className="rchip-name">{left ? 'left' : name}</span>
      {bubble && (
        <span className="bubble" key={bubble + Math.random()}>
          {bubble}
        </span>
      )}
    </div>
  );
}

/** The opening screen of a match: the clockwise order of play and who flicks first. */
function RoyaleIntro({ state, names, skins, mySeat, onDone }: { state: RoyaleState; names: string[]; skins: string[]; mySeat: number; onDone: () => void }) {
  useEffect(() => {
    sfx.coin(true);
    const t = window.setTimeout(onDone, 3600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const seats = [0, 1, 2, 3].filter((i) => state.active[i]);
  return (
    <div className="toss intro" onClick={onDone} role="dialog" aria-label="Battle Royale">
      <p className="toss-title marker">Battle Royale</p>
      <p className="intro-rule">Last pen on the desk scores a point. First to {state.target} wins.</p>
      <ol className="intro-order">
        {seats.map((seat, k) => (
          <li key={seat} className={seat === state.starter ? 'starter' : ''}>
            <PlayerAvatar name={names[seat]} skin={skins[seat]} size={58} />
            <small>{seat === mySeat ? 'You' : shortName(names[seat])}</small>
            {seat === state.starter && <b className="starter-tag">starts</b>}
            {k < seats.length - 1 && <span className="arrow" aria-hidden="true">→</span>}
          </li>
        ))}
      </ol>
      <p className="toss-sub">
        {state.starter === mySeat ? 'You flick first' : `${names[state.starter]} flicks first`} · play goes clockwise · 15s per turn
      </p>
    </div>
  );
}

function describeEvent(ev: RoyaleEvent, me: number, names: string[]): Toast | null {
  const nm = (i: number) => (i === me ? 'You' : names[i] || 'Someone');
  const spin = ev.spin >= 0.35;
  if (ev.roundOver) {
    if (ev.roundWinner === null) return { id: ev.id, title: 'NO POINT', sub: 'The last pens fell together', quip: pickQuip('both'), tone: 'neutral' };
    if (ev.roundWinner === me) return { id: ev.id, title: 'ROUND WON!', sub: 'Last pen standing: +1', quip: pickQuip('ko-win', { spin }), tone: 'good' };
    return { id: ev.id, title: `${nm(ev.roundWinner).toUpperCase()} TAKES IT`, sub: 'Last pen standing: +1', quip: pickQuip(ev.eliminated.includes(me) ? 'ko-lose' : 'ko-win', { spin }), tone: 'bad' };
  }
  if (ev.eliminated.length === 0) return null;
  const mineOut = ev.eliminated.includes(me);
  const ownGoal = ev.eliminated.length === 1 && ev.eliminated[0] === ev.shooter;
  if (mineOut) {
    return ownGoal
      ? { id: ev.id, title: 'OWN GOAL!', sub: "You're out this round", quip: pickQuip('own-me'), tone: 'bad' }
      : { id: ev.id, title: "YOU'RE OUT!", sub: 'Knocked off the desk', quip: pickQuip('ko-lose', { spin }), tone: 'bad' };
  }
  if (ownGoal) return { id: ev.id, title: `${nm(ev.shooter).toUpperCase()} FELL OFF!`, sub: 'Out for the round, no penalty', quip: pickQuip('own-them'), tone: 'good' };
  const who = ev.eliminated.map(nm).join(' & ');
  return {
    id: ev.id,
    title: ev.eliminated.length > 1 ? 'DOUBLE KNOCKOUT!' : `${who.toUpperCase()} IS OUT!`,
    sub: ev.eliminated.length > 1 ? `${who} are out` : 'Knocked off the desk',
    quip: pickQuip('ko-win', { spin }),
    tone: ev.shooter === me ? 'good' : 'neutral',
  };
}

function hintFor(phase: RoyalePhase, state: RoyaleState | undefined, me: number, names: string[], iAmOut: boolean): string {
  switch (phase) {
    case 'ready':
      return (state?.shotNo ?? 0) < 2 ? 'Your turn: drag back from your pen, let go to flick' : 'Your turn';
    case 'aiming':
      return 'Let go to flick · drag back onto the pen to cancel';
    case 'waiting':
      if (iAmOut) return "You're out this round. Watch the rest!";
      return state ? `Waiting for ${state.turn === me ? 'your turn' : names[state.turn]}…` : '';
    case 'settling':
      return 'Checking with the referee…';
    case 'over':
      return state?.winner === me ? 'Well flicked!' : 'Game over!';
    default:
      return '';
  }
}


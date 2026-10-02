import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SKINS,
  cleanChat,
  distinctSkins,
  getSkin,
  newMatch,
  other,
  randomSeed,
  type Difficulty,
  type Emote,
  type MatchState,
  type Seat,
} from '@biro/shared';
import type { Navigate } from '../App';
import { ChatFeed, ReactionDock, type ChatLine } from '../components/ChatDock';
import { CoinToss } from '../components/CoinToss';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Button, Confetti, Modal, Toggle } from '../components/ui';
import { GameController, type HudState, type LastShot, type Phase } from '../game/controller';
import { sfx } from '../lib/audio';
import { music } from '../lib/music';
import { pickQuip } from '../lib/quips';
import { useAudioState } from '../lib/useAudio';
import { onlineSecondsLeft, useTurnClock } from '../lib/turnClock';
import { TurnTimer } from '../components/TurnTimer';
import { online, useOnline } from '../lib/online';
import { displayName, getPrefs, isUnlocked, setPrefs, unlockedSkins, usePrefs } from '../lib/prefs';
import { AI_OPPONENTS } from './AiSetup';

interface Props {
  mode: 'ai' | 'online';
  difficulty: Difficulty;
  target: number;
  navigate: Navigate;
}

interface Toast {
  id: number;
  title: string;
  sub: string;
  /** A short random comment, shown under the score line. */
  quip?: string;
  tone: 'good' | 'bad' | 'neutral';
}

export function GameScreen({ mode, difficulty, target, navigate }: Props) {
  const prefs = usePrefs();
  const net = useOnline();
  const audioState = useAudioState();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrlRef = useRef<GameController | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [paused, setPaused] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [chats, setChats] = useState<ChatLine[]>([]);
  const [bubbles, setBubbles] = useState<{ id: number; seat: Seat; emote: Emote }[]>([]);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  // The opening match is fixed up front so the coin toss can show who starts. Only the very
  // first game gets a toss; rematches alternate who starts.
  const [startMatch] = useState<MatchState | null>(() =>
    mode === 'ai' ? newMatch(target, randomSeed(), Math.random() < 0.5 ? 1 : 0) : (online.getState().room?.match ?? null),
  );
  const [tossing, setTossing] = useState(startMatch?.shotNo === 0);
  const seedRef = useRef(startMatch?.seed);
  const recordedRef = useRef<number | null>(null);

  const mySeat: Seat = mode === 'online' ? ((net.seat ?? 0) as Seat) : 0;
  const oppSeat = other(mySeat);

  // Pick the AI's pen once per game: a different colour from yours.
  const aiSkin = useMemo(() => {
    const pool = SKINS.filter((s) => s.id !== prefs.skin && s.unlock.type === 'free');
    return pool[Math.floor(Math.random() * pool.length)].id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rawSkins: [string, string] =
    mode === 'ai'
      ? [prefs.skin, aiSkin]
      : [net.room?.players[0]?.skin ?? 'blue', net.room?.players[1]?.skin ?? 'red'];
  const skins = distinctSkins(rawSkins[0], rawSkins[1]);

  const names: [string, string] =
    mode === 'ai'
      ? [displayName(prefs), AI_OPPONENTS[difficulty].name]
      : [net.room?.players[0]?.name ?? 'Player 1', net.room?.players[1]?.name ?? 'Player 2'];
  const myName = mode === 'online' ? 'You' : names[mySeat];
  const oppName = names[oppSeat];

  // ---- controller lifecycle -----------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const start = startMatch;
    if (!start) {
      navigate({ name: 'online' });
      return;
    }
    const p = getPrefs();
    const ctrl = new GameController({
      canvas,
      mode,
      mySeat,
      skins,
      difficulty,
      match: start,
      startHeld: start.shotNo === 0,
      prefs: { guide: p.guide, haptics: p.haptics, theme: p.table },
      onHud: setHud,
      sendShot: mode === 'online' ? (flick, shotNo) => online.shot(flick, shotNo) : undefined,
      onNotice: (text) => showNotice("TIME'S UP!", text),
    });
    ctrlRef.current = ctrl;
    setHud(ctrl.state);

    const offShot = online.onShot((m) => ctrl.receiveShot(m));
    const offEmote = online.onEmote(({ seat, emote }) => showBubble(seat as Seat, emote));
    const offChat = online.onChat(({ seat, text }) => showChat(seat, text));
    // The server's 15-second clock ran out for whoever was due to flick.
    const offSkip = online.onSkip((m) => {
      if (!m.match) return;
      ctrl.applySkip(m.match);
      showNotice("TIME'S UP!", m.seat === online.getState().seat ? 'Your turn passes' : 'Their turn passes');
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

  // The pause menu freezes the turn clock (vs Computer; an online game cannot pause).
  useEffect(() => {
    ctrlRef.current?.setPaused(paused || confirmQuit);
  }, [paused, confirmQuit]);

  const secondsLeft = useTurnClock(() => (mode === 'ai' ? (ctrlRef.current?.timeLeft() ?? null) : onlineSecondsLeft()));

  // Music plays only while a match is on screen, and follows both the music and sound switches.
  useEffect(() => {
    if (prefs.music && prefs.sound) music.start();
    else music.stop();
    return () => music.stop();
  }, [prefs.music, prefs.sound]);

  useEffect(() => {
    ctrlRef.current?.setSkins(skins);
  }, [skins[0], skins[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  // Online: feed server snapshots to the controller (reconnects, rematches).
  useEffect(() => {
    if (mode === 'online' && net.room?.match) ctrlRef.current?.offerSnapshot(net.room.match);
  }, [mode, net.room?.match]);

  // ---- toasts -------------------------------------------------------------
  const lastShotId = hud?.lastShot?.id;
  useEffect(() => {
    const s = hud?.lastShot;
    if (!s) return;
    const t = describeShot(s, mySeat, mode === 'online' ? oppName : oppName);
    if (!t) return;
    setToast(t);
    const timer = window.setTimeout(() => setToast((cur) => (cur?.id === t.id ? null : cur)), 2100);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastShotId]);

  function showNotice(title: string, sub: string) {
    const id = Date.now() + Math.random();
    setToast({ id, title, sub, tone: 'neutral' });
    window.setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), 1800);
  }

  function showBubble(seat: Seat, emote: Emote) {
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

  // ---- results / stats ----------------------------------------------------
  const match = hud?.match;
  const over = hud?.phase === 'over' && match?.winner != null;
  const iWon = over && match!.winner === mySeat;

  useEffect(() => {
    if (!over || !match) return;
    if (recordedRef.current === match.seed) return;
    recordedRef.current = match.seed;
    const before = unlockedSkins(getPrefs().stats);
    setPrefs((p) => {
      const s = { ...p.stats };
      if (mode === 'ai') {
        if (iWon) s.aiWins++;
        else s.aiLosses++;
        if (iWon && difficulty === 'hard') s.beatHard = true;
      } else if (iWon) s.onlineWins++;
      else s.onlineLosses++;
      return { stats: s };
    });
    const after = SKINS.filter((s) => isUnlocked(s, getPrefs().stats)).map((s) => s.id);
    setUnlocked(after.filter((id) => !before.includes(id)));
  }, [over, match, iWon, mode, difficulty]);

  function rematch() {
    setUnlocked([]);
    if (mode === 'ai') {
      const prev = match!;
      const next = newMatch(target, randomSeed(), other(prev.firstTurn));
      ctrlRef.current?.newMatch(next);
      announceStart(next);
    } else {
      online.rematch();
    }
  }

  function announceStart(m: MatchState) {
    const id = Date.now();
    setToast({ id, title: 'REMATCH', sub: m.firstTurn === mySeat ? 'You start' : `${oppName} starts`, tone: 'neutral' });
    window.setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), 1800);
  }

  // Online: the server started a rematch.
  const netSeed = net.room?.match?.seed;
  useEffect(() => {
    const m = net.room?.match;
    if (mode !== 'online' || !m || seedRef.current === m.seed) return;
    seedRef.current = m.seed;
    setUnlocked([]);
    announceStart(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, netSeed]);

  function quit() {
    if (mode === 'online') {
      online.leave();
      navigate({ name: 'online' });
    } else {
      navigate({ name: 'home' });
    }
  }

  // ---- render -------------------------------------------------------------
  const phase: Phase = hud?.phase ?? 'ready';
  const oppInfo = net.room?.players[oppSeat];
  const oppDisconnected = mode === 'online' && oppInfo && !oppInfo.connected && net.room?.status !== 'abandoned';
  const abandoned = mode === 'online' && net.room?.status === 'abandoned';
  const rematchMine = mode === 'online' && net.room?.rematch[mySeat];
  const rematchTheirs = mode === 'online' && net.room?.rematch[oppSeat];
  const showCoach = mode === 'ai' && !prefs.seenTutorial && phase === 'ready' && (match?.shotNo ?? 0) === 0;

  return (
    <div
      className="game"
      onPointerDown={() => {
        sfx.unlock();
        if (prefs.music) music.start(); // covers reloads, where audio can't start without a tap
      }}
    >
      <div className="stage">
        <canvas ref={canvasRef} className="table-canvas" />
      </div>

      {match && (
        <header className="hud">
          <button type="button" className="hud-menu" onClick={() => setPaused(true)} aria-label="Pause">
            <span />
            <span />
            <span />
          </button>
          <PlayerCard
            name={myName}
            avatarName={names[mySeat]}
            skin={skins[mySeat]}
            score={match.scores[mySeat]}
            target={match.target}
            active={match.turn === mySeat && !over}
            side="left"
            bubble={bubbles.filter((b) => b.seat === mySeat).at(-1)?.emote}
          />
          <div className="hud-target">
            <small>first to</small>
            <strong>{match.target}</strong>
          </div>
          <PlayerCard
            name={oppName}
            avatarName={names[oppSeat]}
            skin={skins[oppSeat]}
            score={match.scores[oppSeat]}
            target={match.target}
            active={match.turn === oppSeat && !over}
            side="right"
            status={oppDisconnected ? 'offline' : phase === 'thinking' || phase === 'ai-aiming' ? 'thinking' : undefined}
            bubble={bubbles.filter((b) => b.seat === oppSeat).at(-1)?.emote}
          />
        </header>
      )}

      {secondsLeft !== null && !tossing && !paused && hud && hud.match.winner === null && (
        <TurnTimer seconds={secondsLeft} mine={hud.match.turn === mySeat} />
      )}

      {toast && (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          <strong className="marker">{toast.title}</strong>
          <span>{toast.sub}</span>
          {toast.quip && <em className="quip">{toast.quip}</em>}
        </div>
      )}

      {tossing && startMatch && (
        <CoinToss
          firstTurn={startMatch.firstTurn}
          mySeat={mySeat}
          skins={skins}
          names={[myName, oppName]}
          avatarNames={[names[mySeat], names[oppSeat]]}
          onDone={() => {
            setTossing(false);
            ctrlRef.current?.release();
          }}
        />
      )}

      {mode === 'online' && <ChatFeed lines={chats} who={(seat) => ({ name: names[seat] ?? 'Player', skin: skins[seat] })} />}

      <footer className="hint">
        <span>{hintFor(phase, match, mySeat, oppName)}</span>
        {mode === 'online' && <ReactionDock onEmote={sendEmote} onSend={sendChat} />}
      </footer>

      {prefs.sound && audioState !== 'running' && <div className="sound-pill">🔈 Tap the screen to turn sound on</div>}

      {oppDisconnected && <div className="banner">{oppName} lost connection. Waiting for them to come back…</div>}
      {mode === 'online' && net.connection === 'reconnecting' && <div className="banner warn">You're offline. Reconnecting…</div>}

      {showCoach && (
        <div className="coach" onClick={() => setPrefs({ seenTutorial: true })}>
          <div className="coach-card">
            <p className="marker">How to flick</p>
            <ol>
              <li>Put your finger on your glowing pen.</li>
              <li>Drag <b>back</b>, away from where you want it to go.</li>
              <li>Let go to flick it. Grab near the ends for spin.</li>
            </ol>
            <p className="muted small">Knock their pen off: +1. Fall off yourself and they get +1.</p>
            <Button variant="yellow" size="sm" onClick={() => setPrefs({ seenTutorial: true })}>
              Got it
            </Button>
          </div>
        </div>
      )}

      {paused && !confirmQuit && (
        <Modal onClose={() => setPaused(false)}>
          <h2 className="marker">Paused</h2>
          <div className="modal-body">
            <Toggle label="Sound effects" checked={prefs.sound} onChange={(sound) => setPrefs({ sound })} />
            <Toggle label="Music" checked={prefs.music} onChange={(m) => setPrefs({ music: m })} />
            <Toggle label="Vibration" checked={prefs.haptics} onChange={(haptics) => setPrefs({ haptics })} />
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
          <p className="modal-body">{mode === 'online' ? `This ends the game for ${oppName} too.` : 'This game will be lost.'}</p>
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

      {over && match && !abandoned && (
        <Modal>
          {iWon && <Confetti />}
          <PlayerAvatar name={names[match.winner!]} skin={skins[match.winner!]} size={84} className="result-avatar" />
          <h2 className={`marker result ${iWon ? 'win' : 'lose'}`}>{iWon ? 'You win!' : `${oppName} wins`}</h2>
          <p className="final-score">
            <span>{match.scores[mySeat]}</span>
            <em>–</em>
            <span>{match.scores[oppSeat]}</span>
          </p>
          {unlocked.length > 0 && (
            <div className="unlock-banner">
              🎉 New pen unlocked: <b>{unlocked.map((id) => getSkin(id).name).join(', ')}</b>
            </div>
          )}
          <div className="modal-actions">
            <Button variant="blue" onClick={rematch} disabled={!!rematchMine}>
              {rematchMine ? 'Waiting for opponent…' : rematchTheirs ? 'Accept rematch' : 'Rematch'}
            </Button>
            <Button variant="ghost" onClick={quit}>
              Menu
            </Button>
          </div>
        </Modal>
      )}

      {abandoned && (
        <Modal>
          <h2 className="marker">Game over</h2>
          <p className="modal-body">{net.error ?? `${oppName} left the game.`}</p>
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

function PlayerCard({
  name,
  avatarName,
  skin,
  score,
  target,
  active,
  side,
  status,
  bubble,
}: {
  name: string;
  avatarName: string;
  skin: string;
  score: number;
  target: number;
  active: boolean;
  side: 'left' | 'right';
  status?: 'thinking' | 'offline';
  bubble?: Emote;
}) {
  const s = getSkin(skin);
  return (
    <div className={`player-card ${side} ${active ? 'active' : ''}`} style={{ ['--pen' as string]: s.capColor }}>
      <PlayerAvatar name={avatarName} skin={skin} size={32} />
      <div className="pc-text">
        <span className="pc-name">{name}</span>
        <span className="pips" aria-label={`${score} of ${target}`}>
          {Array.from({ length: target }, (_, i) => (
            <i key={i} className={i < score ? 'on' : ''} />
          ))}
        </span>
      </div>
      <span className={`pc-score ${score < 0 ? 'neg' : ''}`} key={score}>
        {score}
      </span>
      {status === 'thinking' && <span className="pc-status">thinking…</span>}
      {status === 'offline' && <span className="pc-status off">offline</span>}
      {bubble && (
        <span className="bubble" key={bubble + Math.random()}>
          {bubble}
        </span>
      )}
    </div>
  );
}

function describeShot(s: LastShot, mySeat: Seat, oppName: string): Toast | null {
  const mine = s.shooter === mySeat;
  const ctx = { ace: s.outcome === 'knockout' && s.opening, spin: s.spin >= 0.35 };
  switch (s.outcome) {
    case 'knockout':
      return mine
        ? { id: s.id, title: ctx.ace ? 'ACE!' : 'KNOCKOUT!', sub: '+1 to you', quip: pickQuip('ko-win', ctx), tone: 'good' }
        : { id: s.id, title: ctx.ace ? 'ACED!' : 'KNOCKED OFF!', sub: `+1 to ${oppName}`, quip: pickQuip('ko-lose', ctx), tone: 'bad' };
    case 'own-goal':
      return mine
        ? { id: s.id, title: 'OWN GOAL!', sub: `You fell off: +1 to ${oppName}`, quip: pickQuip('own-me'), tone: 'bad' }
        : { id: s.id, title: 'THEY FELL OFF!', sub: 'Their own goal: +1 to you', quip: pickQuip('own-them'), tone: 'good' };
    case 'both-off':
      return { id: s.id, title: 'DOUBLE DROP!', sub: 'Both off: no points', quip: pickQuip('both'), tone: 'neutral' };
    default:
      return null;
  }
}

function hintFor(phase: Phase, match: MatchState | undefined, mySeat: Seat, oppName: string): string {
  switch (phase) {
    case 'ready':
      return (match?.shotNo ?? 0) < 2 ? 'Your turn: drag back from your pen, let go to flick' : 'Your turn';
    case 'aiming':
      return 'Let go to flick · drag back onto the pen to cancel';
    case 'thinking':
      return `${oppName} is thinking…`;
    case 'ai-aiming':
      return `${oppName} is lining up a shot…`;
    case 'waiting':
      return `Waiting for ${oppName}…`;
    case 'settling':
      return 'Checking with the referee…';
    case 'over':
      return match?.winner === mySeat ? 'Well flicked!' : 'Unlucky!';
    default:
      return '';
  }
}

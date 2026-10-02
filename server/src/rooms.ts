import { randomBytes, randomInt } from 'node:crypto';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  DEFAULT_TARGET,
  ROYALE,
  TARGET_SCORES,
  getSkin,
  newMatch,
  newRoyale,
  other,
  randomSeed,
  resolveRoyaleShot,
  resolveShot,
  royaleRemovePlayer,
  royaleSkip,
  skipTurn,
  type Flick,
  type GameMode,
  type MatchState,
  type RoomSnapshot,
  type RoomStatus,
  type RoyaleShotMessage,
  type RoyaleState,
  type Seat,
  type ShotMessage,
  type SkipMessage,
} from '@biro/shared';

interface SeatState {
  token: string;
  name: string;
  skin: string;
  socketId: string | null;
  /** Left the game for good. */
  left: boolean;
  /** Timer that forfeits the seat if the player doesn't reconnect. */
  dropTimer: NodeJS.Timeout | null;
  /** Smoothed round-trip time to this player in ms (0 until measured). */
  rtt: number;
  /** When we last heard anything from this player. */
  lastSeen: number;
}

export interface Room {
  code: string;
  status: RoomStatus;
  mode: GameMode;
  target: number;
  /** 2 seats for a duel, 4 for Battle Royale. */
  seats: (SeatState | null)[];
  match: MatchState | null;
  royale: RoyaleState | null;
  rematch: [boolean, boolean];
  lastActive: number;
  /** When the on-screen turn clock reaches zero (epoch ms). The server skips a little later, see graceFor(). */
  turnDeadline: number | null;
  turnTimer: NodeJS.Timeout | null;
  /** Set while the clock is paused waiting for a player who dropped or stopped responding. */
  turnHold: { seat: number; msLeft: number; since: number } | null;
  /** How much more pausing this turn may use (refilled at the start of every turn). */
  holdLeftMs: number;
}

/** How long a disconnected player has to come back before they are dropped from the game. */
export const RECONNECT_GRACE_MS = 90_000;
/** Idle rooms are garbage-collected after this long. */
export const ROOM_IDLE_MS = 60 * 60_000;


/**
 * In-memory room store. Fine for a single server process; swap for Redis
 * if you ever run more than one instance.
 */
export class RoomStore {
  private rooms = new Map<string, Room>();

  get size() {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Could not allocate a room code');
  }

  create(name: string, skin: string, target: number, socketId: string, mode: GameMode = 'duel'): { room: Room; token: string } {
    const token = randomBytes(16).toString('hex');
    const royale = mode === 'royale';
    const targets: readonly number[] = royale ? ROYALE.targets : TARGET_SCORES;
    const seats: (SeatState | null)[] = Array.from({ length: royale ? ROYALE.maxPlayers : 2 }, () => null);
    seats[0] = { token, name, skin: getSkin(skin).id, socketId, left: false, dropTimer: null, rtt: 0, lastSeen: Date.now() };
    const room: Room = {
      code: this.newCode(),
      status: 'waiting',
      mode,
      target: targets.includes(target) ? target : royale ? ROYALE.defaultTarget : DEFAULT_TARGET,
      seats,
      match: null,
      royale: null,
      rematch: [false, false],
      lastActive: Date.now(),
      turnDeadline: null,
      turnTimer: null,
      turnHold: null,
      holdLeftMs: 0,
    };
    this.rooms.set(room.code, room);
    return { room, token };
  }

  join(room: Room, name: string, skin: string, socketId: string): { token: string; seat: number } | { error: string } {
    if (room.status === 'abandoned') return { error: 'That game has ended.' };
    if (room.mode === 'royale' && room.status !== 'waiting') return { error: 'That game has already started.' };
    const seat = room.seats.findIndex((s) => s === null);
    if (seat < 0) return { error: room.mode === 'royale' ? 'That room is full (4 players).' : 'That room is already full.' };
    const token = randomBytes(16).toString('hex');
    room.seats[seat] = { token, name, skin: getSkin(skin).id, socketId, left: false, dropTimer: null, rtt: 0, lastSeen: Date.now() };
    room.lastActive = Date.now();
    if (room.mode === 'duel') {
      // Coin toss decides who starts the first game, whoever created the room.
      room.match = newMatch(room.target, randomSeed(), randomInt(2) as Seat);
      room.status = 'playing';
    }
    return { token, seat };
  }

  seatOfToken(room: Room, token: string): number | null {
    const i = room.seats.findIndex((s) => s?.token === token);
    return i < 0 ? null : i;
  }

  /** Seats that are in the game (not empty, not left). */
  playingSeats(room: Room): boolean[] {
    return room.seats.map((s) => s !== null && !s.left);
  }

  /** Battle Royale: the host starts a match (or the next one after a finished match). */
  startRoyale(room: Room, seat: number): { ok: true } | { error: string } {
    if (room.mode !== 'royale') return { error: 'Not a Battle Royale room.' };
    if (seat !== 0) return { error: 'Only the host can start the game.' };
    if (room.status !== 'waiting' && room.status !== 'finished') return { error: 'The game is already running.' };
    const active = this.playingSeats(room);
    if (active.filter(Boolean).length < ROYALE.minPlayers) return { error: `You need at least ${ROYALE.minPlayers} players.` };
    // A new game: random opener the first time, then it moves clockwise each game.
    const open = active.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
    let starter = open[randomInt(open.length)];
    if (room.royale) {
      const prev = room.royale.firstStarter;
      starter = open.find((i) => i > prev) ?? open[0];
    }
    room.royale = newRoyale(room.target, randomSeed(), starter, active);
    room.status = 'playing';
    room.lastActive = Date.now();
    return { ok: true };
  }

  /** Referee a 1 v 1 shot. The server's simulation is the source of truth. */
  shoot(room: Room, seat: Seat, shotNo: number, flick: Flick): ShotMessage | { error: string } {
    const match = room.match;
    if (room.mode !== 'duel' || !match || room.status !== 'playing') return { error: 'No game in progress.' };
    if (match.turn !== seat) return { error: "It's not your turn." };
    if (match.shotNo !== shotNo) return { error: 'Out of sync.' };

    const r = resolveShot(match, seat, flick);
    room.match = r.after;
    room.lastActive = Date.now();
    if (r.after.winner !== null) room.status = 'finished';

    return {
      shooter: seat,
      flick,
      shotNo,
      before: r.before,
      after: r.after,
      final: r.result.final,
      out: r.result.out,
      outcome: r.outcome,
      delta: r.delta,
      reset: r.reset,
      steps: r.result.steps,
    };
  }

  /** Referee a Battle Royale shot. */
  shootRoyale(room: Room, seat: number, shotNo: number, flick: Flick): RoyaleShotMessage | { error: string } {
    const state = room.royale;
    if (room.mode !== 'royale' || !state || room.status !== 'playing') return { error: 'No game in progress.' };
    if (state.turn !== seat || !state.alive[seat]) return { error: "It's not your turn." };
    if (state.shotNo !== shotNo) return { error: 'Out of sync.' };

    const r = resolveRoyaleShot(state, seat, flick);
    room.royale = r.after;
    room.lastActive = Date.now();
    if (r.after.winner !== null) room.status = 'finished';

    return {
      shooter: seat,
      flick,
      shotNo,
      before: r.before,
      after: r.after,
      final: r.result.final,
      out: r.result.out,
      eliminated: r.eliminated,
      roundOver: r.roundOver,
      roundWinner: r.roundWinner,
      newRound: r.newRound,
      steps: r.result.steps,
    };
  }

  /** Whose turn it is right now (null when no game is running). */
  turnSeat(room: Room): number | null {
    if (room.status !== 'playing') return null;
    return room.mode === 'duel' ? (room.match?.turn ?? null) : (room.royale?.turn ?? null);
  }

  /** The current player ran out of time: pass the turn on. */
  skip(room: Room): SkipMessage | null {
    if (room.status !== 'playing') return null;
    if (room.mode === 'duel' && room.match) {
      const seat = room.match.turn;
      room.match = skipTurn(room.match);
      return { seat, match: room.match };
    }
    if (room.mode === 'royale' && room.royale) {
      const seat = room.royale.turn;
      room.royale = royaleSkip(room.royale);
      return { seat, royale: room.royale };
    }
    return null;
  }

  /**
   * A Battle Royale player left the game: take their pen off the desk.
   * Returns what changed so the caller can notify everyone.
   */
  removeRoyalePlayer(room: Room, seat: number): SkipMessage | null {
    const state = room.royale;
    const s = room.seats[seat];
    if (s) s.left = true;
    if (!state || room.status !== 'playing') return null;
    const adv = royaleRemovePlayer(state, seat);
    room.royale = adv.state;
    if (adv.state.winner !== null) room.status = 'finished';
    room.lastActive = Date.now();
    return { seat, royale: room.royale };
  }

  /** Returns true when both players agreed and a new 1 v 1 game started. */
  requestRematch(room: Room, seat: Seat): boolean {
    if (room.mode !== 'duel' || room.status !== 'finished' || !room.match) return false;
    room.rematch[seat] = true;
    if (!room.rematch[0] || !room.rematch[1]) return false;
    // Alternate who breaks each game.
    room.match = newMatch(room.target, randomSeed(), other(room.match.firstTurn));
    room.status = 'playing';
    room.rematch = [false, false];
    room.lastActive = Date.now();
    return true;
  }

  delete(code: string) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    for (const s of room.seats) if (s?.dropTimer) clearTimeout(s.dropTimer);
    this.rooms.delete(code);
  }

  sweep(now = Date.now()) {
    for (const [code, room] of this.rooms) {
      if (now - room.lastActive > ROOM_IDLE_MS) this.delete(code);
    }
  }
}

export function snapshot(room: Room): RoomSnapshot {
  const info = (s: SeatState | null) => (s ? { name: s.name, skin: s.skin, connected: s.socketId !== null, left: s.left } : null);
  return {
    code: room.code,
    status: room.status,
    mode: room.mode,
    target: room.target,
    players: room.seats.map(info),
    match: room.match,
    royale: room.royale,
    rematch: room.rematch,
    turnMsLeft: room.turnDeadline === null ? null : Math.max(0, room.turnDeadline - Date.now()),
    turnHeld: room.turnHold !== null,
  };
}


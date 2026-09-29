import { randomBytes, randomInt } from 'node:crypto';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  DEFAULT_TARGET,
  TARGET_SCORES,
  getSkin,
  newMatch,
  other,
  randomSeed,
  resolveShot,
  type Flick,
  type MatchState,
  type RoomSnapshot,
  type RoomStatus,
  type Seat,
  type ShotMessage,
} from '@biro/shared';

interface SeatState {
  token: string;
  name: string;
  skin: string;
  socketId: string | null;
  /** Timer that forfeits the seat if the player doesn't reconnect. */
  dropTimer: NodeJS.Timeout | null;
}

export interface Room {
  code: string;
  status: RoomStatus;
  target: number;
  seats: [SeatState | null, SeatState | null];
  match: MatchState | null;
  rematch: [boolean, boolean];
  lastActive: number;
}

/** How long a disconnected player has to come back before the room is abandoned. */
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

  create(name: string, skin: string, target: number, socketId: string): { room: Room; token: string } {
    const token = randomBytes(16).toString('hex');
    const room: Room = {
      code: this.newCode(),
      status: 'waiting',
      target: (TARGET_SCORES as readonly number[]).includes(target) ? target : DEFAULT_TARGET,
      seats: [{ token, name, skin: getSkin(skin).id, socketId, dropTimer: null }, null],
      match: null,
      rematch: [false, false],
      lastActive: Date.now(),
    };
    this.rooms.set(room.code, room);
    return { room, token };
  }

  join(room: Room, name: string, skin: string, socketId: string): { token: string } | { error: string } {
    if (room.status === 'abandoned') return { error: 'That game has ended.' };
    if (room.seats[1]) return { error: 'That room is already full.' };
    const token = randomBytes(16).toString('hex');
    room.seats[1] = { token, name, skin: getSkin(skin).id, socketId, dropTimer: null };
    // Host breaks first in the first game.
    room.match = newMatch(room.target, randomSeed(), 0);
    room.status = 'playing';
    room.lastActive = Date.now();
    return { token };
  }

  seatOfToken(room: Room, token: string): Seat | null {
    if (room.seats[0]?.token === token) return 0;
    if (room.seats[1]?.token === token) return 1;
    return null;
  }

  /** Referee a shot. The server's simulation is the source of truth. */
  shoot(room: Room, seat: Seat, shotNo: number, flick: Flick): ShotMessage | { error: string } {
    const match = room.match;
    if (!match || room.status !== 'playing') return { error: 'No game in progress.' };
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
    };
  }

  /** Returns true when both players agreed and a new game started. */
  requestRematch(room: Room, seat: Seat): boolean {
    if (room.status !== 'finished' || !room.match) return false;
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
  const info = (s: SeatState | null) => (s ? { name: s.name, skin: s.skin, connected: s.socketId !== null } : null);
  return {
    code: room.code,
    status: room.status,
    target: room.target,
    players: [info(room.seats[0]), info(room.seats[1])],
    match: room.match,
    rematch: room.rematch,
  };
}

import type { RoyaleState } from './royale';
import type { Flick, MatchState, Outcome, Pose, Seat } from './types';

/** Socket.IO event contract between client and server. */

export type RoomStatus = 'waiting' | 'playing' | 'finished' | 'abandoned';

/** 'duel' is the classic 1 v 1; 'royale' is Battle Royale for 2 to 4 players. */
export type GameMode = 'duel' | 'royale';

export interface PlayerInfo {
  name: string;
  skin: string;
  connected: boolean;
  /** Left the game for good (Battle Royale keeps playing without them). */
  left: boolean;
}

export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  mode: GameMode;
  target: number;
  /** One entry per seat: 2 for a duel, 4 for Battle Royale (null = empty seat). */
  players: (PlayerInfo | null)[];
  match: MatchState | null;
  royale: RoyaleState | null;
  rematch: [boolean, boolean];
  /**
   * Milliseconds until the current turn's clock hits zero, measured when this snapshot was sent
   * (it can be longer than the turn limit while the last shot is still playing out).
   * null when no turn is running.
   */
  turnMsLeft: number | null;
}

/** Broadcast after the server referees a 1 v 1 shot. */
export interface ShotMessage {
  shooter: Seat;
  flick: Flick;
  /** shotNo of the state the shot was taken from. */
  shotNo: number;
  before: MatchState;
  after: MatchState;
  final: (Pose | null)[];
  out: boolean[];
  outcome: Outcome;
  delta: number;
  reset: boolean;
  /** Simulation steps the shot took (the server uses this to time the next turn). */
  steps: number;
}

/** Broadcast after the server referees a Battle Royale shot. */
export interface RoyaleShotMessage {
  shooter: number;
  flick: Flick;
  shotNo: number;
  before: RoyaleState;
  after: RoyaleState;
  final: (Pose | null)[];
  out: boolean[];
  eliminated: number[];
  roundOver: boolean;
  /** null with roundOver = nobody scored the round. */
  roundWinner: number | null;
  newRound: boolean;
  steps: number;
}

/** A player ran out of time (or left): their turn was skipped. */
export interface SkipMessage {
  seat: number;
  match?: MatchState;
  royale?: RoyaleState;
}

export type JoinResult =
  | { ok: true; code: string; seat: number; token: string; room: RoomSnapshot }
  | { ok: false; error: string };

export type Ack = { ok: true } | { ok: false; error: string };

export const EMOTES = ['😂', '😤', '🔥', '😱', '👏', 'GG'] as const;
export type Emote = (typeof EMOTES)[number];

export interface ClientToServerEvents {
  'room:create': (p: { name: string; skin: string; target: number; mode?: GameMode }, ack: (r: JoinResult) => void) => void;
  'room:join': (p: { code: string; name: string; skin: string }, ack: (r: JoinResult) => void) => void;
  'room:rejoin': (p: { code: string; token: string }, ack: (r: JoinResult) => void) => void;
  'room:leave': () => void;
  /** Battle Royale: the host starts (or restarts) the match once at least two players are in. */
  'royale:start': (ack: (r: Ack) => void) => void;
  shot: (p: { shotNo: number; flick: Flick }, ack: (r: Ack) => void) => void;
  rematch: () => void;
  emote: (e: Emote) => void;
}

export interface ServerToClientEvents {
  'room:update': (room: RoomSnapshot) => void;
  shot: (msg: ShotMessage) => void;
  'royale:shot': (msg: RoyaleShotMessage) => void;
  'turn:skip': (msg: SkipMessage) => void;
  emote: (p: { seat: number; emote: Emote }) => void;
}

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 16) : '';
  return s || 'Player';
}

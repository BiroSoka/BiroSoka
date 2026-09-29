import type { Flick, MatchState, Outcome, Pose, Seat } from './types';

/** Socket.IO event contract between client and server. */

export type RoomStatus = 'waiting' | 'playing' | 'finished' | 'abandoned';

export interface PlayerInfo {
  name: string;
  skin: string;
  connected: boolean;
}

export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  target: number;
  players: [PlayerInfo | null, PlayerInfo | null];
  match: MatchState | null;
  rematch: [boolean, boolean];
}

/** Broadcast after the server referees a shot. */
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
}

export type JoinResult =
  | { ok: true; code: string; seat: Seat; token: string; room: RoomSnapshot }
  | { ok: false; error: string };

export type Ack = { ok: true } | { ok: false; error: string };

export const EMOTES = ['😂', '😤', '🔥', '😱', '👏', 'GG'] as const;
export type Emote = (typeof EMOTES)[number];

export interface ClientToServerEvents {
  'room:create': (p: { name: string; skin: string; target: number }, ack: (r: JoinResult) => void) => void;
  'room:join': (p: { code: string; name: string; skin: string }, ack: (r: JoinResult) => void) => void;
  'room:rejoin': (p: { code: string; token: string }, ack: (r: JoinResult) => void) => void;
  'room:leave': () => void;
  shot: (p: { shotNo: number; flick: Flick }, ack: (r: Ack) => void) => void;
  rematch: () => void;
  emote: (e: Emote) => void;
}

export interface ServerToClientEvents {
  'room:update': (room: RoomSnapshot) => void;
  shot: (msg: ShotMessage) => void;
  emote: (p: { seat: Seat; emote: Emote }) => void;
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

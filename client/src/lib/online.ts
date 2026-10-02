import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  ClientToServerEvents,
  Emote,
  Flick,
  GameMode,
  JoinResult,
  RoomSnapshot,
  RoyaleShotMessage,
  ServerToClientEvents,
  ShotMessage,
  SkipMessage,
} from '@biro/shared';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type Connection = 'idle' | 'connecting' | 'online' | 'reconnecting';

export interface OnlineState {
  connection: Connection;
  room: RoomSnapshot | null;
  /** performance.now() when `room` was last received; the turn clock counts down from here. */
  roomAt: number;
  seat: number | null;
  error: string | null;
}

interface Session {
  code: string;
  token: string;
  seat: number;
}

const SESSION_KEY = 'biro-soka:session';
/** Set VITE_SERVER_URL when the API is hosted separately from the web app. */
const SERVER_URL: string = import.meta.env.VITE_SERVER_URL || window.location.origin;
const ACK_TIMEOUT = 8000;

/**
 * Thin wrapper around the Socket.IO connection. Keeps the room snapshot in a
 * tiny external store for React, and transparently rejoins after a dropped
 * connection (phone locked, tunnel, Wi-Fi to 4G handover...).
 */
class OnlineClient {
  private socket: GameSocket | null = null;
  private session: Session | null = readSession();
  private state: OnlineState = { connection: 'idle', room: null, roomAt: 0, seat: null, error: null };
  private listeners = new Set<() => void>();
  private shotHandlers = new Set<(m: ShotMessage) => void>();
  private emoteHandlers = new Set<(p: { seat: number; emote: Emote }) => void>();
  private royaleShotHandlers = new Set<(m: RoyaleShotMessage) => void>();
  private skipHandlers = new Set<(m: SkipMessage) => void>();

  getState = () => this.state;

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  private set(patch: Partial<OnlineState>) {
    this.state = { ...this.state, ...patch, ...('room' in patch ? { roomAt: performance.now() } : {}) };
    this.listeners.forEach((l) => l());
  }

  onShot(cb: (m: ShotMessage) => void) {
    this.shotHandlers.add(cb);
    return () => this.shotHandlers.delete(cb);
  }

  onEmote(cb: (p: { seat: number; emote: Emote }) => void) {
    this.emoteHandlers.add(cb);
    return () => this.emoteHandlers.delete(cb);
  }

  onRoyaleShot(cb: (m: RoyaleShotMessage) => void) {
    this.royaleShotHandlers.add(cb);
    return () => this.royaleShotHandlers.delete(cb);
  }

  /** A turn was skipped (time ran out) or a Battle Royale player left. */
  onSkip(cb: (m: SkipMessage) => void) {
    this.skipHandlers.add(cb);
    return () => this.skipHandlers.delete(cb);
  }

  get hasSession() {
    return this.session !== null;
  }

  private ensureSocket(): GameSocket {
    if (this.socket) return this.socket;
    const s: GameSocket = io(SERVER_URL, { autoConnect: false, transports: ['websocket', 'polling'] });
    this.socket = s;
    this.set({ connection: 'connecting' });

    s.on('connect', () => {
      if (this.session) {
        s.timeout(ACK_TIMEOUT).emit('room:rejoin', { code: this.session.code, token: this.session.token }, (err, r) => {
          if (err) return;
          if (r.ok) this.set({ connection: 'online', room: r.room, seat: r.seat, error: null });
          else {
            this.clearSession();
            this.set({ connection: 'online', error: r.error, room: this.state.room ? { ...this.state.room, status: 'abandoned' } : null });
          }
        });
      } else {
        this.set({ connection: 'online' });
      }
    });
    s.on('disconnect', () => this.set({ connection: 'reconnecting' }));
    s.on('connect_error', () => this.set({ connection: this.state.room ? 'reconnecting' : 'connecting' }));
    s.on('room:update', (room) => this.set({ room }));
    s.on('shot', (m) => this.shotHandlers.forEach((h) => h(m)));
    s.on('royale:shot', (m) => this.royaleShotHandlers.forEach((h) => h(m)));
    s.on('turn:skip', (m) => this.skipHandlers.forEach((h) => h(m)));
    s.on('emote', (p) => this.emoteHandlers.forEach((h) => h(p)));
    s.connect();
    return s;
  }

  connect() {
    this.ensureSocket();
  }

  private join(event: 'room:create' | 'room:join', payload: never): Promise<JoinResult> {
    const s = this.ensureSocket();
    return new Promise((resolve) => {
      const done = (r: JoinResult) => {
        if (r.ok) {
          this.session = { code: r.code, token: r.token, seat: r.seat };
          writeSession(this.session);
          this.set({ room: r.room, seat: r.seat, error: null });
        }
        resolve(r);
      };
      (s.timeout(ACK_TIMEOUT).emit as (e: string, p: unknown, cb: (err: Error | null, r: JoinResult) => void) => void)(
        event,
        payload,
        (err, r) => done(err ? { ok: false, error: "Can't reach the game server. Check your connection." } : r),
      );
    });
  }

  create(name: string, skin: string, target: number, mode: GameMode = 'duel') {
    return this.join('room:create', { name, skin, target, mode } as never);
  }

  joinRoom(code: string, name: string, skin: string) {
    return this.join('room:join', { code, name, skin } as never);
  }

  /** Try to resume a game after a page reload. */
  resume(): Promise<boolean> {
    if (!this.session) return Promise.resolve(false);
    const s = this.ensureSocket();
    return new Promise((resolve) => {
      const check = () => {
        const unsub = this.subscribe(() => {
          if (this.state.room && this.state.seat !== null) {
            unsub();
            resolve(true);
          } else if (!this.session) {
            unsub();
            resolve(false);
          }
        });
        window.setTimeout(() => {
          unsub();
          resolve(this.state.room !== null);
        }, ACK_TIMEOUT);
      };
      if (s.connected) {
        // Already connected: trigger the rejoin manually.
        s.timeout(ACK_TIMEOUT).emit('room:rejoin', { code: this.session!.code, token: this.session!.token }, (err, r) => {
          if (!err && r.ok) {
            this.set({ room: r.room, seat: r.seat });
            resolve(true);
          } else {
            this.clearSession();
            resolve(false);
          }
        });
      } else check();
    });
  }

  shot(flick: Flick, shotNo: number): Promise<Ack> {
    const s = this.ensureSocket();
    return new Promise((resolve) => {
      s.timeout(ACK_TIMEOUT).emit('shot', { flick, shotNo }, (err, r) => resolve(err ? { ok: false, error: 'Timed out' } : r));
    });
  }

  rematch() {
    this.socket?.emit('rematch');
  }

  /** Battle Royale host: start (or restart) the match. */
  startRoyale(): Promise<Ack> {
    const s = this.ensureSocket();
    return new Promise((resolve) => {
      s.timeout(ACK_TIMEOUT).emit('royale:start', (err, r) => resolve(err ? { ok: false, error: 'Timed out' } : r));
    });
  }

  emote(e: Emote) {
    this.socket?.emit('emote', e);
  }

  leave() {
    this.socket?.emit('room:leave');
    this.clearSession();
    this.set({ room: null, seat: null, error: null });
  }

  clearError() {
    this.set({ error: null });
  }

  private clearSession() {
    this.session = null;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
}

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeSession(s: Session) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const online = new OnlineClient();

export function useOnline(): OnlineState {
  return useSyncExternalStore(online.subscribe, online.getState);
}

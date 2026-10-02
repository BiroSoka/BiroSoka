import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import {
  EMOTES,
  PACE,
  PHYS,
  TURN,
  cleanChat,
  cleanName,
  normalizeCode,
  sanitizeFlick,
  type ClientToServerEvents,
  type GameMode,
  type JoinResult,
  type Seat,
  type ServerToClientEvents,
} from '@biro/shared';
import { RECONNECT_GRACE_MS, RoomStore, snapshot, type Room } from './rooms';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? '*';
/** Public-server safety valve: refuse new rooms beyond this many at once. */
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 2000);
/** Seconds a player gets for each turn (override with TURN_SECONDS, handy for testing). */
const TURN_MS = Number(process.env.TURN_SECONDS ?? TURN.seconds) * 1000;

interface SocketData {
  code?: string;
  seat?: number;
  /** When this player last sent reactions or messages (for rate limiting). */
  chatTimes?: number[];
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const app = express();
const http = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(http, {
  cors: { origin: CLIENT_ORIGIN },
  maxHttpBufferSize: 10_000, // messages here are tiny; refuse anything bigger
});
const rooms = new RoomStore();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

// In production the server also hosts the built React app.
const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));
}

function broadcast(room: Room) {
  io.to(room.code).emit('room:update', snapshot(room));
}

function attach(socket: GameSocket, room: Room, seat: number) {
  socket.data.code = room.code;
  socket.data.seat = seat;
  socket.join(room.code);
}

function currentRoom(socket: GameSocket): { room: Room; seat: number } | null {
  const { code, seat } = socket.data;
  if (!code || seat === undefined) return null;
  const room = rooms.get(code);
  if (!room || room.seats[seat]?.socketId !== socket.id) return null;
  return { room, seat };
}

// ---- turn clock ----------------------------------------------------------------------------------

function clearTurnTimer(room: Room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnDeadline = null;
}

/**
 * Start the clock for the turn that is about to begin. `leadMs` covers the time the players' screens
 * still need to play out the last shot (and any coin toss) before anyone can act.
 */
function armTurnTimer(room: Room, leadMs = 0) {
  clearTurnTimer(room);
  if (room.status !== 'playing') return;
  const ms = leadMs + TURN_MS + TURN.graceMs;
  room.turnDeadline = Date.now() + ms;
  room.turnTimer = setTimeout(() => onTurnTimeout(room), ms);
}

/** Time the clients spend animating a shot and showing its result before the next turn begins. */
function shotLeadMs(steps: number, hadEvent: boolean, extraMs = 0) {
  return steps * PHYS.dt * 1000 + (hadEvent ? PACE.eventMs : PACE.quietMs) + extraMs + 700;
}

function onTurnTimeout(room: Room) {
  room.turnTimer = null;
  if (room.status !== 'playing') return;
  const skipped = rooms.skip(room);
  if (!skipped) return;
  io.to(room.code).emit('turn:skip', skipped);
  armTurnTimer(room, 800);
  broadcast(room);
}

// ---- leaving -------------------------------------------------------------------------------------

/** Remove a player from their room, either on purpose or after the reconnect grace ran out. */
function vacate(room: Room, seat: number) {
  const s = room.seats[seat];
  if (s?.dropTimer) clearTimeout(s.dropTimer);
  if (s) {
    s.socketId = null;
    s.dropTimer = null;
  }
  const everyoneGone = () => room.seats.every((x) => !x || x.socketId === null);

  if (room.mode === 'duel') {
    if (room.status === 'waiting') {
      rooms.delete(room.code);
      return;
    }
    clearTurnTimer(room);
    room.status = 'abandoned';
    broadcast(room);
    if (everyoneGone()) rooms.delete(room.code);
    return;
  }

  // Battle Royale
  if (seat === 0) {
    // The host owns the room: when they go, the game ends for everyone.
    clearTurnTimer(room);
    room.status = 'abandoned';
    broadcast(room);
    if (everyoneGone()) rooms.delete(room.code);
    return;
  }
  if (room.status === 'waiting') {
    room.seats[seat] = null;
    broadcast(room);
    return;
  }
  // Mid-game (or after it): the player is out, everyone else carries on.
  const wasTurn = rooms.turnSeat(room) === seat;
  const change = rooms.removeRoyalePlayer(room, seat);
  if (change) io.to(room.code).emit('turn:skip', change);
  if (room.status !== 'playing') clearTurnTimer(room);
  else if (wasTurn) armTurnTimer(room, 800);
  broadcast(room);
  if (everyoneGone()) rooms.delete(room.code);
}

/** Reactions and messages share one allowance per player: 6 per 10 seconds. */
const CHAT_WINDOW_MS = 10_000;
const CHAT_MAX_IN_WINDOW = 6;
function chatAllowed(socket: GameSocket): boolean {
  const now = Date.now();
  const recent = (socket.data.chatTimes ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
  socket.data.chatTimes = recent;
  if (recent.length >= CHAT_MAX_IN_WINDOW) return false;
  recent.push(now);
  return true;
}

io.on('connection', (socket: GameSocket) => {
  const fail = (ack: (r: JoinResult) => void, error: string) => ack({ ok: false, error });

  socket.on('room:create', (p, ack) => {
    if (typeof ack !== 'function') return;
    if (rooms.size >= MAX_ROOMS) return fail(ack, 'The server is busy right now. Try again in a minute.');
    const existing = currentRoom(socket);
    if (existing) vacate(existing.room, existing.seat);
    const mode: GameMode = p?.mode === 'royale' ? 'royale' : 'duel';
    const { room, token } = rooms.create(cleanName(p?.name), String(p?.skin ?? ''), Number(p?.target), socket.id, mode);
    attach(socket, room, 0);
    ack({ ok: true, code: room.code, seat: 0, token, room: snapshot(room) });
  });

  socket.on('room:join', (p, ack) => {
    if (typeof ack !== 'function') return;
    const code = normalizeCode(String(p?.code ?? ''));
    const room = rooms.get(code);
    if (!room) return fail(ack, `No room called ${code || '...'}. Check the code?`);
    const result = rooms.join(room, cleanName(p?.name), String(p?.skin ?? ''), socket.id);
    if ('error' in result) return fail(ack, result.error);
    attach(socket, room, result.seat);
    // A duel starts the moment the second player joins (after the coin toss on screen).
    if (room.status === 'playing') armTurnTimer(room, 4800);
    ack({ ok: true, code: room.code, seat: result.seat, token: result.token, room: snapshot(room) });
    broadcast(room);
  });

  socket.on('room:rejoin', (p, ack) => {
    if (typeof ack !== 'function') return;
    const room = rooms.get(normalizeCode(String(p?.code ?? '')));
    if (!room) return fail(ack, 'That game has expired.');
    const seat = rooms.seatOfToken(room, String(p?.token ?? ''));
    if (seat === null || room.status === 'abandoned') return fail(ack, 'That game has ended.');
    const s = room.seats[seat]!;
    if (s.left) return fail(ack, 'You left that game.');
    if (s.dropTimer) clearTimeout(s.dropTimer);
    s.dropTimer = null;
    s.socketId = socket.id;
    attach(socket, room, seat);
    ack({ ok: true, code: room.code, seat, token: s.token, room: snapshot(room) });
    broadcast(room);
  });

  socket.on('royale:start', (ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const ctx = currentRoom(socket);
    if (!ctx) return reply({ ok: false, error: 'Not in a room.' });
    const result = rooms.startRoyale(ctx.room, ctx.seat);
    if ('error' in result) return reply({ ok: false, error: result.error });
    armTurnTimer(ctx.room, 4200);
    reply({ ok: true });
    broadcast(ctx.room);
  });

  socket.on('shot', (p, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const ctx = currentRoom(socket);
    if (!ctx) return reply({ ok: false, error: 'Not in a room.' });
    const flick = sanitizeFlick(p?.flick);
    if (!flick) return reply({ ok: false, error: 'Bad flick.' });
    const { room, seat } = ctx;

    if (room.mode === 'royale') {
      const msg = rooms.shootRoyale(room, seat, Number(p?.shotNo), flick);
      if ('error' in msg) {
        reply({ ok: false, error: msg.error });
        socket.emit('room:update', snapshot(room));
        return;
      }
      reply({ ok: true });
      armTurnTimer(room, shotLeadMs(msg.steps, msg.eliminated.length > 0 || msg.roundOver, msg.newRound ? 500 : 0));
      io.to(room.code).emit('royale:shot', msg);
      broadcast(room);
      return;
    }

    const msg = rooms.shoot(room, seat as Seat, Number(p?.shotNo), flick);
    if ('error' in msg) {
      reply({ ok: false, error: msg.error });
      // Help the client recover from a desync.
      socket.emit('room:update', snapshot(room));
      return;
    }
    reply({ ok: true });
    armTurnTimer(room, shotLeadMs(msg.steps, msg.outcome !== 'none', msg.reset ? 500 : 0));
    io.to(room.code).emit('shot', msg);
    broadcast(room);
  });

  socket.on('rematch', () => {
    const ctx = currentRoom(socket);
    if (!ctx || ctx.room.mode !== 'duel') return;
    if (rooms.requestRematch(ctx.room, ctx.seat as Seat)) armTurnTimer(ctx.room, 1500);
    broadcast(ctx.room);
  });

  socket.on('emote', (emote) => {
    const ctx = currentRoom(socket);
    if (!ctx || !EMOTES.includes(emote) || !chatAllowed(socket)) return;
    socket.to(ctx.room.code).emit('emote', { seat: ctx.seat, emote });
  });

  // Messages are passed straight on to the other players in the room. They are not saved or logged anywhere.
  socket.on('chat', (raw, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const ctx = currentRoom(socket);
    if (!ctx) return reply({ ok: false, error: 'Not in a room.' });
    const text = cleanChat(raw);
    if (!text) return reply({ ok: false, error: 'Type a message first.' });
    if (!chatAllowed(socket)) return reply({ ok: false, error: 'Slow down a little…' });
    socket.to(ctx.room.code).emit('chat', { seat: ctx.seat, text });
    reply({ ok: true });
  });

  socket.on('room:leave', () => {
    const ctx = currentRoom(socket);
    if (!ctx) return;
    socket.leave(ctx.room.code);
    socket.data.code = undefined;
    socket.data.seat = undefined;
    vacate(ctx.room, ctx.seat);
  });

  socket.on('disconnect', () => {
    const ctx = currentRoom(socket);
    if (!ctx) return;
    const { room, seat } = ctx;
    const s = room.seats[seat]!;
    s.socketId = null;
    // Everyone else sees them as offline straight away; the turn clock keeps running for them.
    broadcast(room);
    const grace = room.status === 'waiting' ? RECONNECT_GRACE_MS / 3 : RECONNECT_GRACE_MS;
    s.dropTimer = setTimeout(() => vacate(room, seat), grace);
  });
});

setInterval(() => rooms.sweep(), 5 * 60_000).unref();

http.listen(PORT, () => {
  console.log(`Biro Soka server listening on http://localhost:${PORT} (turn limit ${TURN_MS / 1000}s)`);
});

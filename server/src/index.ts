import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import {
  EMOTES,
  cleanName,
  normalizeCode,
  sanitizeFlick,
  type ClientToServerEvents,
  type JoinResult,
  type Seat,
  type ServerToClientEvents,
} from '@biro/shared';
import { RECONNECT_GRACE_MS, RoomStore, snapshot, type Room } from './rooms';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? '*';
/** Public-server safety valve: refuse new rooms beyond this many at once. */
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 2000);

interface SocketData {
  code?: string;
  seat?: Seat;
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

function attach(socket: GameSocket, room: Room, seat: Seat) {
  socket.data.code = room.code;
  socket.data.seat = seat;
  socket.join(room.code);
}

function currentRoom(socket: GameSocket): { room: Room; seat: Seat } | null {
  const { code, seat } = socket.data;
  if (!code || seat === undefined) return null;
  const room = rooms.get(code);
  if (!room || room.seats[seat]?.socketId !== socket.id) return null;
  return { room, seat };
}

/** Remove a player from their room, either on purpose or after the reconnect grace ran out. */
function vacate(room: Room, seat: Seat) {
  const s = room.seats[seat];
  if (s?.dropTimer) clearTimeout(s.dropTimer);
  if (room.status === 'waiting') {
    rooms.delete(room.code);
    return;
  }
  room.status = 'abandoned';
  if (s) {
    s.socketId = null;
    s.dropTimer = null;
  }
  broadcast(room);
  if (room.seats.every((x) => !x || x.socketId === null)) rooms.delete(room.code);
}

io.on('connection', (socket: GameSocket) => {
  const fail = (ack: (r: JoinResult) => void, error: string) => ack({ ok: false, error });

  socket.on('room:create', (p, ack) => {
    if (typeof ack !== 'function') return;
    if (rooms.size >= MAX_ROOMS) return fail(ack, 'The server is busy right now. Try again in a minute.');
    const existing = currentRoom(socket);
    if (existing) vacate(existing.room, existing.seat);
    const { room, token } = rooms.create(cleanName(p?.name), String(p?.skin ?? ''), Number(p?.target), socket.id);
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
    attach(socket, room, 1);
    ack({ ok: true, code: room.code, seat: 1, token: result.token, room: snapshot(room) });
    broadcast(room);
  });

  socket.on('room:rejoin', (p, ack) => {
    if (typeof ack !== 'function') return;
    const room = rooms.get(normalizeCode(String(p?.code ?? '')));
    if (!room) return fail(ack, 'That game has expired.');
    const seat = rooms.seatOfToken(room, String(p?.token ?? ''));
    if (seat === null || room.status === 'abandoned') return fail(ack, 'That game has ended.');
    const s = room.seats[seat]!;
    if (s.dropTimer) clearTimeout(s.dropTimer);
    s.dropTimer = null;
    s.socketId = socket.id;
    attach(socket, room, seat);
    ack({ ok: true, code: room.code, seat, token: s.token, room: snapshot(room) });
    broadcast(room);
  });

  socket.on('shot', (p, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const ctx = currentRoom(socket);
    if (!ctx) return reply({ ok: false, error: 'Not in a room.' });
    const flick = sanitizeFlick(p?.flick);
    if (!flick) return reply({ ok: false, error: 'Bad flick.' });
    const msg = rooms.shoot(ctx.room, ctx.seat, Number(p?.shotNo), flick);
    if ('error' in msg) {
      reply({ ok: false, error: msg.error });
      // Help the client recover from a desync.
      socket.emit('room:update', snapshot(ctx.room));
      return;
    }
    reply({ ok: true });
    io.to(ctx.room.code).emit('shot', msg);
    broadcast(ctx.room);
  });

  socket.on('rematch', () => {
    const ctx = currentRoom(socket);
    if (!ctx) return;
    rooms.requestRematch(ctx.room, ctx.seat);
    broadcast(ctx.room);
  });

  socket.on('emote', (emote) => {
    const ctx = currentRoom(socket);
    if (!ctx || !EMOTES.includes(emote)) return;
    socket.to(ctx.room.code).emit('emote', { seat: ctx.seat, emote });
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
    if (room.status === 'waiting') {
      // Host closed the tab before anyone joined; give them a moment to come back.
      s.dropTimer = setTimeout(() => vacate(room, seat), RECONNECT_GRACE_MS / 3);
      return;
    }
    broadcast(room);
    s.dropTimer = setTimeout(() => vacate(room, seat), RECONNECT_GRACE_MS);
  });
});

setInterval(() => rooms.sweep(), 5 * 60_000).unref();

http.listen(PORT, () => {
  console.log(`Biro Soka server listening on http://localhost:${PORT}`);
});

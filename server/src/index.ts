import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import {
  EMOTES,
  NETWORK,
  PACE,
  PHYS,
  QUICK_TARGET,
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
import { MatchQueue } from './matchmaking';
import { RECONNECT_GRACE_MS, RoomStore, snapshot, type Room } from './rooms';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? '*';
/** Public-server safety valve: refuse new rooms beyond this many at once. */
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 2000);
/** Seconds a player gets for each turn (override with TURN_SECONDS, handy for testing). */
const TURN_MS = Number(process.env.TURN_SECONDS ?? TURN.seconds) * 1000;
/** How long the clock waits per turn for a player who dropped (seconds; overridable for testing). */
const HOLD_MS = Number(process.env.TURN_HOLD_SECONDS ?? NETWORK.holdMaxMs / 1000) * 1000;

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
const queue = new MatchQueue();
const socketAlive = (id: string) => io.sockets.sockets.get(id)?.connected === true;

/**
 * Keep-awake. Free hosts (Render's free plan) put a service to sleep after ~15 minutes without a web request,
 * and the next visitor waits up to a minute for it to wake. With KEEP_AWAKE=true the server asks for its own
 * public address every few minutes, which counts as a visit. (The very first wake-up still needs an outside
 * pinger such as UptimeRobot, see DEPLOY.md.) Render fills in RENDER_EXTERNAL_URL by itself.
 */
const KEEP_AWAKE = process.env.KEEP_AWAKE === 'true';
const SELF_PING_URL = process.env.SELF_PING_URL ?? process.env.RENDER_EXTERNAL_URL ?? '';
const SELF_PING_MS = Number(process.env.SELF_PING_SECONDS ?? 600) * 1000;
let selfPings = 0;

app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, rooms: rooms.size, uptimeSeconds: Math.round(process.uptime()), ...(KEEP_AWAKE ? { selfPings } : {}) });
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
  room.turnHold = null;
}

/** A player looks offline if they have no connection, or we have heard nothing from them for a while. */
function looksOffline(room: Room, seat: number): boolean {
  const s = room.seats[seat];
  if (!s) return false;
  return s.socketId === null || Date.now() - s.lastSeen > NETWORK.unresponsiveMs;
}

/** How long past zero a flick is still accepted: a little for everyone, more for a slow connection. */
function graceFor(room: Room, seat: number | null): number {
  const rtt = seat === null ? 0 : (room.seats[seat]?.rtt ?? 0);
  return Math.min(NETWORK.graceMaxMs, TURN.graceMs + Math.round(rtt));
}

/**
 * Start the clock for the turn that is about to begin. `leadMs` covers the time the players' screens
 * still need to play out the last shot (and any coin toss) before anyone can act.
 * `sameTurn` is true when carrying on a turn that was paused, so its pause allowance is not refilled.
 */
function armTurnTimer(room: Room, leadMs = 0, turnMs = TURN_MS, sameTurn = false) {
  clearTurnTimer(room);
  if (room.status !== 'playing') return;
  if (!sameTurn) room.holdLeftMs = HOLD_MS;
  const seat = rooms.turnSeat(room);
  // Never run the clock down on someone who cannot see it: wait for them instead, for a limited time.
  if (seat !== null && room.holdLeftMs > 0 && looksOffline(room, seat)) {
    holdTurn(room, seat, turnMs);
    return;
  }
  // The on-screen clock reaches zero here; the server waits a little longer (see onTurnTimeout) before skipping.
  room.turnDeadline = Date.now() + leadMs + turnMs;
  room.turnTimer = setTimeout(() => onTurnTimeout(room), leadMs + turnMs + graceFor(room, seat));
}

/** Pause the clock for a player who dropped or stopped responding, for at most what is left of their allowance. */
function holdTurn(room: Room, seat: number, msLeft: number) {
  clearTurnTimer(room);
  room.turnHold = { seat, msLeft, since: Date.now() };
  room.turnTimer = setTimeout(() => expireHold(room), room.holdLeftMs);
  broadcast(room);
}

/** They did not come back in time: the clock carries on with what was left, then the turn passes. */
function expireHold(room: Room) {
  const held = room.turnHold;
  if (!held || room.status !== 'playing') return;
  room.holdLeftMs = 0;
  armTurnTimer(room, 0, held.msLeft, true);
  broadcast(room);
}

/** The held player is back (or answered): carry on, giving them a fair amount of time. */
function resumeTurn(room: Room, seat: number) {
  const held = room.turnHold;
  if (!held || held.seat !== seat || room.status !== 'playing') return;
  room.holdLeftMs = Math.max(0, room.holdLeftMs - (Date.now() - held.since));
  armTurnTimer(room, 0, Math.min(TURN_MS, Math.max(held.msLeft, NETWORK.resumeMinMs)), true);
  broadcast(room);
}

/** Note that we just heard from this player. If the clock was waiting for them, it carries on. */
function touch(room: Room, seat: number) {
  const s = room.seats[seat];
  if (!s) return;
  s.lastSeen = Date.now();
  if (s.socketId !== null) resumeTurn(room, seat);
}

/** Time the clients spend animating a shot and showing its result before the next turn begins. */
function shotLeadMs(steps: number, hadEvent: boolean, extraMs = 0) {
  return steps * PHYS.dt * 1000 + (hadEvent ? PACE.eventMs : PACE.quietMs) + extraMs + 700;
}

function onTurnTimeout(room: Room) {
  room.turnTimer = null;
  if (room.status !== 'playing' || room.turnDeadline === null) return;
  const seat = rooms.turnSeat(room);
  // A slow connection may have earned a longer allowance since the clock was set: wait for it.
  const wait = room.turnDeadline + graceFor(room, seat) - Date.now();
  if (wait > 25) {
    room.turnTimer = setTimeout(() => onTurnTimeout(room), wait);
    return;
  }
  // Out of time, but they are off the network: give them a bit longer instead of skipping a turn they could not play.
  if (seat !== null && room.holdLeftMs > 0 && looksOffline(room, seat)) {
    holdTurn(room, seat, NETWORK.resumeMinMs);
    return;
  }
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
  // Any message from a player counts as a sign of life for the turn clock.
  socket.onAny(() => {
    const ctx = currentRoom(socket);
    if (ctx) touch(ctx.room, ctx.seat);
  });

  // Check the connection every few seconds. The round trip tells us how slow the line is (a slow line gets
  // a longer late-flick allowance) and an answer tells us the player is still reachable.
  const lagTimer = setInterval(() => {
    const ctx = currentRoom(socket);
    if (!ctx) return;
    const sent = Date.now();
    socket.timeout(NETWORK.pingEveryMs * 3).emit('lag:ping', (err) => {
      if (err) return;
      const s = ctx.room.seats[ctx.seat];
      if (!s || s.socketId !== socket.id) return;
      const rtt = Date.now() - sent;
      s.rtt = s.rtt === 0 ? rtt : Math.round(s.rtt * 0.6 + rtt * 0.4);
      touch(ctx.room, ctx.seat);
    });
  }, NETWORK.pingEveryMs);

  const fail = (ack: (r: JoinResult) => void, error: string) => ack({ ok: false, error });

  socket.on('room:create', (p, ack) => {
    if (typeof ack !== 'function') return;
    queue.cancel(socket.id);
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
    queue.cancel(socket.id);
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
    s.lastSeen = Date.now();
    attach(socket, room, seat);
    resumeTurn(room, seat); // the clock was waiting for them
    ack({ ok: true, code: room.code, seat, token: s.token, room: snapshot(room) });
    broadcast(room);
  });

  // Quick match: pair strangers into a first-to-5 duel. The first player waits; the next one completes the pair.
  socket.on('quick:join', (p, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (rooms.size >= MAX_ROOMS) return reply({ ok: false, error: 'The server is busy right now. Try again in a minute.' });
    const existing = currentRoom(socket);
    if (existing) vacate(existing.room, existing.seat);
    const name = cleanName(p?.name);
    const skin = String(p?.skin ?? '');
    const entry = { socketId: socket.id, name, skin, since: Date.now() };
    const mate = queue.join(entry, socketAlive);
    if (!mate) return reply({ ok: true, status: 'waiting' });
    const mateSocket = io.sockets.sockets.get(mate.socketId);
    if (!mateSocket) {
      queue.join(entry, socketAlive);
      return reply({ ok: true, status: 'waiting' });
    }
    const created = rooms.create(mate.name, mate.skin, QUICK_TARGET, mate.socketId, 'duel', true);
    const joined = rooms.join(created.room, name, skin, socket.id);
    if ('error' in joined) {
      rooms.delete(created.room.code);
      return reply({ ok: false, error: joined.error });
    }
    attach(mateSocket, created.room, 0);
    attach(socket, created.room, joined.seat);
    armTurnTimer(created.room, 4800);
    const room = snapshot(created.room);
    mateSocket.emit('quick:matched', { code: created.room.code, seat: 0, token: created.token, room });
    reply({ ok: true, status: 'matched', code: created.room.code, seat: joined.seat, token: joined.token, room });
  });

  socket.on('quick:cancel', () => {
    queue.cancel(socket.id);
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
    if (ctx.room.quick) return reply({ ok: false, error: 'Messages are off in quick matches. Reactions still work!' });
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
    clearInterval(lagTimer);
    queue.cancel(socket.id);
    const ctx = currentRoom(socket);
    if (!ctx) return;
    const { room, seat } = ctx;
    const s = room.seats[seat]!;
    s.socketId = null;
    // If it is their turn, pause the clock while they reconnect (for a limited time) instead of running it down.
    if (room.status === 'playing' && rooms.turnSeat(room) === seat && !room.turnHold && room.holdLeftMs > 0) {
      const msLeft = room.turnDeadline === null ? TURN_MS : Math.min(TURN_MS, Math.max(0, room.turnDeadline - Date.now()));
      holdTurn(room, seat, msLeft);
    }
    // Everyone else sees them as offline straight away.
    broadcast(room);
    const grace = room.status === 'waiting' ? RECONNECT_GRACE_MS / 3 : RECONNECT_GRACE_MS;
    s.dropTimer = setTimeout(() => vacate(room, seat), grace);
  });
});

setInterval(() => rooms.sweep(), 5 * 60_000).unref();
setInterval(() => queue.sweep(3 * 60_000, socketAlive), 30_000).unref();

http.listen(PORT, () => {
  console.log(`Biro Soka server listening on http://localhost:${PORT} (turn limit ${TURN_MS / 1000}s)`);
  if (KEEP_AWAKE && SELF_PING_URL) {
    const target = `${SELF_PING_URL.replace(/\/$/, '')}/api/health`;
    console.log(`Keep-awake on: asking for ${target} every ${SELF_PING_MS / 1000}s`);
    const ping = async () => {
      try {
        const r = await fetch(target, { signal: AbortSignal.timeout(20_000) });
        if (r.ok) selfPings++;
      } catch (e) {
        console.warn('keep-awake ping failed:', (e as Error).message);
      }
    };
    setInterval(ping, SELF_PING_MS).unref();
  } else if (KEEP_AWAKE) {
    console.warn('KEEP_AWAKE is on but there is no address to ask for (set SELF_PING_URL or deploy on Render).');
  }
});

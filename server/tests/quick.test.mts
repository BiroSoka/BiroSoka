// Quick match: strangers are paired into a first-to-5 duel.
import type { Socket } from 'socket.io-client';
import { check, collect, conn, emit, finish, wait } from './helpers.mts';

const join = (s: Socket, name: string) => emit(s, 'quick:join', { name, skin: 'blue' });

// ---- two players are paired ----------------------------------------------------------------------------------------
{
  const [A, B] = [await conn(), await conn()];
  const gotA = collect(A, 'quick:matched');
  const ra = await join(A, 'Ann');
  check('the first player is told to wait', ra.ok && ra.status === 'waiting');
  const rb = await join(B, 'Bo');
  await wait(200);
  check('the second player is paired at once', rb.ok && rb.status === 'matched' && rb.seat === 1 && typeof rb.token === 'string');
  check('the waiting player is told too (seat 0, same room)', gotA.length === 1 && gotA[0].seat === 0 && gotA[0].code === rb.code);
  const room = rb.room;
  check('it is a first-to-5 duel that has started, marked as a quick match', room.mode === 'duel' && room.target === 5 && room.status === 'playing' && room.quick === true && room.players[0].name === 'Ann' && room.players[1].name === 'Bo');
  check('the clock is running and the coin toss picked who starts', room.turnMsLeft > 0 && (room.match.turn === 0 || room.match.turn === 1));

  const holder = room.match.turn === 0 ? A : B;
  const shot = await emit(holder, 'shot', { shotNo: 0, flick: { gx: 0, dx: 0, dy: room.match.turn === 0 ? -1 : 1, power: 0.3 } });
  check('the paired players can play a shot', shot.ok === true, JSON.stringify(shot));

  const chat = await emit(A, 'chat', 'hello stranger');
  check('typed messages are refused in a quick match', chat.ok === false && /quick/i.test(chat.error), chat.error);
  const seen: unknown[] = [];
  B.on('emote', (e) => seen.push(e));
  A.emit('emote', '👏');
  await wait(200);
  check('reactions still work in a quick match', seen.length === 1);
  [A, B].forEach((s) => s.close());
}

// ---- a player is never paired with themselves ---------------------------------------------------------------------------
{
  const [C, D] = [await conn(), await conn()];
  const gotC = collect(C, 'quick:matched');
  const r1 = await join(C, 'Cy');
  const r2 = await join(C, 'Cy');
  await wait(150);
  check('asking twice does not pair a player with themselves', r1.status === 'waiting' && r2.status === 'waiting' && gotC.length === 0);
  const rd = await join(D, 'Di');
  await wait(150);
  check('and they are paired once with the next player (only one room)', rd.status === 'matched' && gotC.length === 1);
  [C, D].forEach((s) => s.close());
}

// ---- cancelling and leaving take you off the list --------------------------------------------------------------------------
{
  const [E, F] = [await conn(), await conn()];
  await join(E, 'Eve');
  E.emit('quick:cancel');
  await wait(150);
  const rf = await join(F, 'Fay');
  check('someone who cancelled is not paired later', rf.status === 'waiting');
  F.close();
  E.close();

  const [G, H] = [await conn(), await conn()];
  await join(G, 'Gus');
  G.close();
  await wait(300);
  const rh = await join(H, 'Hal');
  check('someone who closed the app is not paired either', rh.status === 'waiting');
  H.close();
}

// ---- first come, first served; pairs do not mix ------------------------------------------------------------------------------
{
  const [I, J, K, L] = [await conn(), await conn(), await conn(), await conn()];
  const gotI = collect(I, 'quick:matched');
  const gotK = collect(K, 'quick:matched');
  await join(I, 'Ida');
  const rj = await join(J, 'Jo');
  const rk = await join(K, 'Kim');
  const rl = await join(L, 'Lee');
  await wait(200);
  check('four players make two separate games, in order', rj.status === 'matched' && rk.status === 'waiting' && rl.status === 'matched' && rj.code !== rl.code && gotI[0].code === rj.code && gotK[0].code === rl.code);
  check('each game has exactly its own two players', rj.room.players[0].name === 'Ida' && rj.room.players[1].name === 'Jo' && rl.room.players[0].name === 'Kim' && rl.room.players[1].name === 'Lee');
  [I, J, K, L].forEach((s) => s.close());
}

// ---- switching to a private game leaves the queue ----------------------------------------------------------------------------
{
  const [M, N] = [await conn(), await conn()];
  await join(M, 'Max');
  const made = await emit(M, 'room:create', { name: 'Max', skin: 'blue', target: 5 });
  const rn = await join(N, 'Nia');
  check('a player who made a private room is no longer in the queue', made.ok && rn.status === 'waiting');
  [M, N].forEach((s) => s.close());
}

finish('QUICK MATCH');

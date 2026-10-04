// Bad connections: the 15 second clock waits for a player who dropped or went quiet,
// is generous with slow lines, and cannot be used to stall forever.
// The runner starts the server with TURN_SECONDS=3 and TURN_HOLD_SECONDS=20 so this takes ~30 seconds.
import type { Socket } from 'socket.io-client';
import { TURN_SECONDS, check, collect, conn, emit, finish, wait } from './helpers.mts';

const TURN_MS = TURN_SECONDS * 1000;

type Pinger = 'fast' | 'silent' | number;
/** How a test client answers the server's connection checks. */
function answerPings(s: Socket, mode: Pinger) {
  s.off('lag:ping');
  if (mode === 'silent') return;
  s.on('lag:ping', (ack: () => void) => (mode === 'fast' ? ack() : void setTimeout(ack, mode)));
}

/** Record what an observer sees: skipped turns and the latest room snapshot. */
function watch(s: Socket, t0: number, initial: any) {
  const w = { skips: [] as { at: number; seat: number }[], last: initial };
  s.on('turn:skip', (m: any) => w.skips.push({ at: Date.now() - t0, seat: m.seat }));
  s.on('room:update', (r: any) => (w.last = r));
  return w;
}

async function duelRoom() {
  const A = await conn();
  const B = await conn();
  const created = await emit(A, 'room:create', { name: 'Ann', skin: 'blue', target: 5 });
  const t0 = Date.now();
  const joined = await emit(B, 'room:join', { code: created.code, name: 'Bo', skin: 'red' });
  const sockets = [A, B];
  const tokens = [created.token, joined.token];
  const holder = joined.room.match.turn as 0 | 1;
  const other = (1 - holder) as 0 | 1;
  const w = watch(sockets[other], t0, joined.room);
  return { code: created.code as string, sockets, tokens, holder, other, t0, w, join: joined.room };
}

// ---- 1: a dropped player is waited for ------------------------------------------------------------------------------
async function dropAndReturn() {
  const S = 'drop+return';
  const r = await duelRoom();
  await wait(300);
  r.sockets[r.holder].close();
  await wait(1200);
  const during = r.w.last;
  check(`[${S}] while they are gone the clock is paused and everyone is told`, during.turnHeld === true && during.turnMsLeft === null && during.players[r.holder].connected === false);
  // Without the pause the clock would have skipped them at about 9 s. Stay away past that.
  await wait(r.t0 + 11000 - Date.now());
  check(`[${S}] no turn was skipped while they were away`, r.w.skips.length === 0, `skips=${r.w.skips.length}`);
  const back = await conn();
  const rejoinAt = Date.now() - r.t0;
  const rj = await emit(back, 'room:rejoin', { code: r.code, token: r.tokens[r.holder] });
  check(`[${S}] they get back in and the clock runs again with a usable amount of time`, rj.ok && rj.room.turnHeld === false && rj.room.turnMsLeft > 0 && rj.room.turnMsLeft <= TURN_MS, `left=${rj.room.turnMsLeft}`);
  await wait(500);
  check(`[${S}] the other player sees the clock is running again`, r.w.last.turnHeld === false && r.w.last.players[r.holder].connected === true);
  await wait(6000);
  const skip = r.w.skips[0];
  check(`[${S}] if they still do not flick, the turn is skipped about one clock after they returned`, !!skip && skip.at - rejoinAt >= TURN_MS - 300 && skip.at - rejoinAt <= TURN_MS + 3500);
  back.close();
  r.sockets[r.other].close();
}

// ---- 2: but it cannot be used to stall forever -------------------------------------------------------------------------------
async function neverReturns() {
  const S = 'never returns';
  const r = await duelRoom();
  await wait(300);
  r.sockets[r.holder].close();
  await wait(r.t0 + 19000 - Date.now());
  const early = r.w.skips.length;
  await wait(r.t0 + 27500 - Date.now());
  const skip = r.w.skips[0];
  check(`[${S}] the clock waited up to the pause limit...`, early === 0);
  check(`[${S}] ...then skipped the turn, so staying away cannot stall the game`, !!skip && skip.at >= 19000 && skip.at <= 27000, skip ? `skipped at ${(skip.at / 1000).toFixed(1)}s` : 'never skipped');
  r.sockets[r.other].close();
}

// ---- 3: connected but not answering ---------------------------------------------------------------------------------------------
async function connectedButSilent() {
  const S = 'connected but silent';
  const r = await duelRoom();
  answerPings(r.sockets[r.holder], 'silent');
  await wait(r.t0 + 12500 - Date.now());
  const l = r.w.last;
  check(`[${S}] a player who stops responding gets the clock paused`, r.w.skips.length === 0 && l.turnHeld === true && l.players[r.holder].connected === true);
  answerPings(r.sockets[r.holder], 'fast');
  const answered = Date.now();
  let resumed: number | null = null;
  while (Date.now() - answered < 6000) {
    if (r.w.last.turnHeld === false) {
      resumed = Date.now() - answered;
      break;
    }
    await wait(100);
  }
  check(`[${S}] as soon as they answer again the clock resumes`, resumed !== null, resumed !== null ? `${resumed}ms later` : 'never');
  check(`[${S}] ...with time left to use`, r.w.last.turnMsLeft > 0 && r.w.last.turnMsLeft <= TURN_MS);
  r.sockets.forEach((s) => s.close());
}

// ---- 4: a slow line gets longer for a late flick ----------------------------------------------------------------------------------
async function lateFlick(slow: boolean) {
  const S = slow ? 'slow line' : 'fast line';
  const r = await duelRoom();
  if (slow) answerPings(r.sockets[r.holder], 1500);
  const zeroAt = Date.now() + r.join.turnMsLeft; // when the on-screen clock reaches zero
  await wait(zeroAt + 2000 - Date.now()); // 2 s late: past the normal 1.2 s allowance
  const ack = await emit(r.sockets[r.holder], 'shot', { shotNo: 0, flick: { gx: 0, dx: 0, dy: r.holder === 0 ? -1 : 1, power: 0.3 } });
  if (slow) check(`[${S}] a flick that lands 2s after zero is still accepted`, ack.ok === true, JSON.stringify(ack));
  else check(`[${S}] the same late flick is too late (the turn was already skipped)`, ack.ok === false && r.w.skips.length >= 1, JSON.stringify(ack));
  r.sockets.forEach((s) => s.close());
}

// ---- 5: Battle Royale --------------------------------------------------------------------------------------------------------------
async function royale() {
  const S = 'battle royale';
  const A = await conn();
  const B = await conn();
  const created = await emit(A, 'room:create', { name: 'Ann', skin: 'blue', target: 5, mode: 'royale' });
  const joined = await emit(B, 'room:join', { code: created.code, name: 'Bo', skin: 'red' });
  const sockets = [A, B];
  const tokens = [created.token, joined.token];
  let latest: any = null;
  A.on('room:update', (r: any) => (latest = r));
  B.on('room:update', (r: any) => (latest = r));
  const started = await emit(A, 'royale:start');
  const t0 = Date.now();
  await wait(400);
  const holder = latest.royale.turn as number;
  const other = 1 - holder;
  const skips: number[] = [];
  sockets[other].on('turn:skip', () => skips.push(Date.now() - t0));
  sockets[holder].close();
  await wait(t0 + 11000 - Date.now());
  check(`[${S}] a dropped player is waited for too`, started.ok && skips.length === 0 && latest.turnHeld === true);
  const back = await conn();
  const rj = await emit(back, 'room:rejoin', { code: created.code, token: tokens[holder] });
  check(`[${S}] when they return the clock resumes for them`, rj.ok && rj.room.turnHeld === false && rj.room.turnMsLeft > 0 && rj.room.turnMsLeft <= TURN_MS);
  back.close();
  sockets[other].close();
}

await Promise.all([dropAndReturn(), neverReturns(), connectedButSilent(), lateFlick(true), lateFlick(false), royale()]);
void collect;
finish('NETWORK');

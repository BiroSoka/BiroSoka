// Typed messages between friends: relayed live, tidied, rate limited, never stored.
import { check, collect, conn, emit, finish, wait } from './helpers.mts';

const [A, B, C] = await Promise.all([conn(), conn(), conn()]);
const created = await emit(A, 'room:create', { name: 'Ann', skin: 'blue', target: 5 });
await emit(B, 'room:join', { code: created.code, name: 'Bo', skin: 'red' });
const gotB = collect(B, 'chat');
const gotA = collect(A, 'chat');
const updates = collect(A, 'room:update');

let ack = await emit(A, 'chat', 'good luck!');
await wait(150);
check('a message reaches the other player with the sender seat', ack.ok && gotB.length === 1 && gotB[0].text === 'good luck!' && gotB[0].seat === 0);
check('the sender is not sent their own message back (the app shows it locally)', gotA.length === 0);

ack = await emit(B, 'chat', 'nice try 😄');
await wait(150);
check('it works both ways, emoji included', ack.ok && gotA.length === 1 && gotA[0].text === 'nice try 😄' && gotA[0].seat === 1);

ack = await emit(A, 'chat', '   spaced     out\u0000\u0007   ');
await wait(150);
check('control characters are stripped and spaces collapsed', ack.ok && gotB.at(-1).text === 'spaced out');

ack = await emit(A, 'chat', 'y'.repeat(300));
await wait(150);
check('long messages are cut to 40 characters', ack.ok && Array.from(gotB.at(-1).text).length === 40);

const before = gotB.length;
for (const bad of ['', '    ', 42, null, { text: 'x' }, ['a']] as unknown[]) {
  const r = await emit(A, 'chat', bad);
  if (r.ok) check(`bad payload ${JSON.stringify(bad)} must be refused`, false);
}
await wait(150);
check('empty and non-text payloads are refused and nothing is relayed', gotB.length === before);

const outsider = await emit(C, 'chat', 'hello?');
await wait(150);
check('someone who is not in the room cannot send, and nobody hears it', !outsider.ok && gotA.length === 1 && gotB.length === before);

const results: boolean[] = [];
for (let i = 0; i < 10; i++) results.push((await emit(A, 'chat', `spam ${i}`)).ok);
check('spamming is rate limited (6 per 10 seconds, shared with reactions)', results.filter((x) => !x).length > 0 && results.filter(Boolean).length <= 6);
const slow = await emit(A, 'chat', 'one more');
check('the refusal says why', !slow.ok && /slow down/i.test(slow.error), slow.error);

await emit(B, 'chat', 'secret-marker-123');
await wait(200);
const snap = JSON.stringify(updates.at(-1) ?? {});
check('the room state never contains chat text (nothing is kept on the server)', !snap.includes('secret-marker-123') && !snap.includes('good luck'));

[A, B, C].forEach((s) => s.close());

// a fresh player's reactions are capped too (a separate allowance from the one used up above)
const [X, Y] = await Promise.all([conn(), conn()]);
const made = await emit(X, 'room:create', { name: 'X', skin: 'blue', target: 5 });
await emit(Y, 'room:join', { code: made.code, name: 'Y', skin: 'red' });
const emotes = collect(Y, 'emote');
for (let i = 0; i < 12; i++) X.emit('emote', '🔥');
await wait(400);
check('reaction spam is capped at 6 per 10 seconds', emotes.length > 0 && emotes.length <= 6, `${emotes.length} delivered of 12`);
[X, Y].forEach((s) => s.close());

finish('CHAT');

import { io, type Socket } from 'socket.io-client';

/** Where the server under test is listening (the runner starts one and sets this). */
export const URL = process.env.TEST_URL ?? 'http://localhost:4999';
/** The runner starts the server with this turn length (seconds). */
export const TURN_SECONDS = Number(process.env.TURN_SECONDS ?? 3);

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

let failures = 0;
export function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/** Print the verdict and exit with a status the runner (and CI) can read. */
export function finish(title: string): never {
  console.log(failures === 0 ? `\nALL ${title} CHECKS PASSED` : `\n${failures} ${title} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Send an event and wait for the server's answer. */
export const emit = (s: Socket, ev: string, ...args: unknown[]): Promise<any> => new Promise((r) => s.emit(ev, ...args, r));

/** Open a connection. By default it answers the server's connection checks, like the real app does. */
export async function conn(answerPings = true): Promise<Socket> {
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  await new Promise((r) => s.on('connect', () => r(null)));
  if (answerPings) s.on('lag:ping', (ack: () => void) => ack());
  return s;
}

/** Collect every event of one kind a socket receives. */
export function collect<T = any>(s: Socket, ev: string): T[] {
  const items: T[] = [];
  s.on(ev, (m: T) => items.push(m));
  return items;
}

import { useEffect, useState } from 'react';
import { TURN } from '@biro/shared';
import { online } from './online';

/** Whole seconds left on the current turn, polled a few times a second. null = no turn is being timed. */
export function useTurnClock(getSeconds: () => number | null): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const s = getSeconds();
      const next = s === null ? null : Math.ceil(s);
      setValue((cur) => (cur === next ? cur : next));
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

/**
 * Online games: the server owns the clock and tells us how long is left when each snapshot is sent.
 * Counts down from the moment that snapshot arrived. Hidden while the last shot is still playing out.
 */
export function onlineSecondsLeft(): number | null {
  const { room, roomAt } = online.getState();
  if (!room || room.status !== 'playing' || room.turnMsLeft === null) return null;
  const left = room.turnMsLeft - (performance.now() - roomAt);
  if (left > TURN.seconds * 1000) return null;
  return Math.max(0, left / 1000);
}

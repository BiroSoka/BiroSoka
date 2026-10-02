import { useEffect } from 'react';
import { sfx } from '../lib/audio';

/**
 * The 15-second turn clock. Goes red and ticks for the player whose turn it is during the last 5 seconds.
 */
export function TurnTimer({ seconds, mine, name }: { seconds: number; mine: boolean; name?: string }) {
  const low = seconds <= 5;
  useEffect(() => {
    if (mine && low && seconds > 0) sfx.tick();
  }, [seconds, mine, low]);
  return (
    <div className={`turn-timer ${low ? 'low' : ''} ${mine ? 'mine' : ''}`} role="timer" aria-label={`${seconds} seconds left`}>
      <span className="turn-timer-icon" aria-hidden="true">
        ⏱
      </span>
      <strong>{seconds}</strong>
      {name && <small>{name}</small>}
    </div>
  );
}

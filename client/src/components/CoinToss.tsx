import { useEffect, useState } from 'react';
import { getSkin, type Seat } from '@biro/shared';
import { sfx } from '../lib/audio';
import { PlayerAvatar } from './PlayerAvatar';

interface Props {
  /** The seat that won the toss. Decided by the server (online) or randomly on this device (vs Computer). */
  firstTurn: Seat;
  mySeat: Seat;
  skins: [string, string];
  /** [my name, opponent's name] */
  names: [string, string];
  /** [my name, opponent's name] used to seed each avatar, so both devices draw the same faces. */
  avatarNames: [string, string];
  onDone: () => void;
}

/**
 * The opening coin toss. The coin's two faces are the two players' pen colours; it lands on the
 * winner's face. Everything is driven by `firstTurn`, so both devices show the same result.
 */
export function CoinToss({ firstTurn, mySeat, skins, names, avatarNames, onDone }: Props) {
  const [stage, setStage] = useState<'ready' | 'flip' | 'result'>('ready');
  const iStart = firstTurn === mySeat;
  const theirSkin = skins[mySeat === 0 ? 1 : 0];

  useEffect(() => {
    const timers = [
      window.setTimeout(() => {
        setStage('flip');
        sfx.coin(false);
      }, 400),
      window.setTimeout(() => {
        setStage('result');
        sfx.coin(true);
      }, 2600),
      window.setTimeout(onDone, 4100),
    ];
    return () => timers.forEach(window.clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const face = (avatarName: string, skinId: string, name: string, extra = '') => (
    <div className={`coin-face ${extra}`} style={{ ['--face' as string]: getSkin(skinId).capColor }}>
      <PlayerAvatar name={avatarName} skin={skinId} size={70} />
      <small>{name}</small>
    </div>
  );

  return (
    <div className="toss" onClick={onDone} role="dialog" aria-label="Coin toss">
      <p className="toss-title marker">{stage === 'result' ? (iStart ? 'You go first!' : `${names[1]} goes first!`) : 'Coin toss…'}</p>
      <div className={`coin-hop ${stage !== 'ready' ? 'go' : ''}`}>
        <div className={`coin ${stage !== 'ready' ? 'spin' : ''}`} style={{ ['--end' as string]: iStart ? '1800deg' : '1980deg' }}>
          {face(avatarNames[0], skins[mySeat], names[0])}
          {face(avatarNames[1], theirSkin, names[1], 'back')}
        </div>
      </div>
      <p className="toss-sub">{stage === 'result' ? 'Starting…' : 'Tap to skip'}</p>
    </div>
  );
}

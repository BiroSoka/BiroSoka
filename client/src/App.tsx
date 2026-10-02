import { useEffect, useState } from 'react';
import { normalizeCode, type Difficulty } from '@biro/shared';
import { sfx } from './lib/audio';
import { online, useOnline } from './lib/online';
import { usePrefs } from './lib/prefs';
import { Home } from './screens/Home';
import { AiSetup } from './screens/AiSetup';
import { OnlineMenu } from './screens/OnlineMenu';
import { Lobby } from './screens/Lobby';
import { GameScreen } from './screens/GameScreen';
import { RoyaleScreen } from './screens/RoyaleScreen';
import { PensScreen } from './screens/PensScreen';
import { HowTo } from './screens/HowTo';
import { HowToOnline } from './screens/HowToOnline';
import { Settings } from './screens/Settings';

export type Route =
  | { name: 'home' }
  | { name: 'ai-setup' }
  | { name: 'online'; code?: string }
  | { name: 'lobby' }
  | { name: 'game-ai'; difficulty: Difficulty; target: number }
  | { name: 'game-online' }
  | { name: 'game-royale' }
  | { name: 'pens' }
  | { name: 'howto' }
  | { name: 'howto-online' }
  | { name: 'settings' };

export type Navigate = (r: Route) => void;

function initialRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  const code = normalizeCode(params.get('room') ?? '');
  if (code) {
    window.history.replaceState(null, '', window.location.pathname);
    return { name: 'online', code };
  }
  return { name: 'home' };
}

/** The table screen for a running online game. */
function gameRoute(mode: 'duel' | 'royale'): Route {
  return mode === 'royale' ? { name: 'game-royale' } : { name: 'game-online' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(initialRoute);
  const prefs = usePrefs();
  const net = useOnline();

  useEffect(() => {
    sfx.enabled = prefs.sound;
  }, [prefs.sound]);

  // Resume an online game after a page reload.
  useEffect(() => {
    if (!online.hasSession) return;
    void online.resume().then((ok) => {
      const room = online.getState().room;
      if (!ok || !room) return;
      setRoute(room.status === 'waiting' ? { name: 'lobby' } : gameRoute(room.mode));
    });
  }, []);

  // Host is in the lobby and a friend joined: go to the table.
  useEffect(() => {
    if (route.name === 'lobby' && net.room?.status === 'playing') setRoute(gameRoute(net.room.mode));
  }, [route.name, net.room?.status, net.room?.mode]);

  switch (route.name) {
    case 'home':
      return <Home navigate={setRoute} />;
    case 'ai-setup':
      return <AiSetup navigate={setRoute} />;
    case 'online':
      return <OnlineMenu navigate={setRoute} initialCode={route.code} />;
    case 'lobby':
      return <Lobby navigate={setRoute} />;
    case 'game-ai':
      return <GameScreen key={`ai-${route.difficulty}-${route.target}`} mode="ai" difficulty={route.difficulty} target={route.target} navigate={setRoute} />;
    case 'game-online':
      return <GameScreen key="online" mode="online" difficulty="medium" target={net.room?.target ?? 5} navigate={setRoute} />;
    case 'game-royale':
      return <RoyaleScreen key="royale" navigate={setRoute} />;
    case 'pens':
      return <PensScreen navigate={setRoute} />;
    case 'howto-online':
      return <HowToOnline navigate={setRoute} />;
    case 'howto':
      return <HowTo navigate={setRoute} />;
    case 'settings':
      return <Settings navigate={setRoute} />;
  }
}

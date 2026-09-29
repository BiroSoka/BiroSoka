import type { Navigate } from '../App';
import { Button, PaperScreen, PenPreview } from '../components/ui';
import { displayName, usePrefs } from '../lib/prefs';

export function Home({ navigate }: { navigate: Navigate }) {
  const prefs = usePrefs();
  const { stats } = prefs;
  const played = stats.aiWins + stats.aiLosses + stats.onlineWins + stats.onlineLosses;

  return (
    <PaperScreen className="home">
      <div className="logo">
        <div className="logo-pens">
          <PenPreview skin={prefs.skin} width={210} height={90} angle={-0.35} className="logo-pen a" />
          <PenPreview skin={prefs.skin === 'red' ? 'blue' : 'red'} width={210} height={90} angle={0.35} className="logo-pen b" />
        </div>
        <h1 className="marker title">
          Biro <span>Soka</span>
        </h1>
        <p className="hand tagline">flick it. knock it off. don't fall off.</p>
      </div>

      <div className="menu-stack">
        <Button variant="blue" size="lg" onClick={() => navigate({ name: 'ai-setup' })}>
          <span className="btn-icon">🤖</span> Play vs Computer
        </Button>
        <Button variant="red" size="lg" onClick={() => navigate({ name: 'online' })}>
          <span className="btn-icon">🌍</span> Play a Friend Online
        </Button>
        <div className="menu-row">
          <Button variant="yellow" onClick={() => navigate({ name: 'pens' })}>
            🖊️ Pens
          </Button>
          <Button variant="ghost" onClick={() => navigate({ name: 'howto' })}>
            ❓ How to
          </Button>
          <Button variant="ghost" onClick={() => navigate({ name: 'settings' })} aria-label="Settings">
            ⚙️
          </Button>
        </div>
      </div>

      <footer className="home-foot hand">
        {played > 0 ? (
          <>
            {displayName(prefs)}: {stats.aiWins + stats.onlineWins} wins · {stats.aiLosses + stats.onlineLosses} losses
          </>
        ) : (
          <>Playable in class. Not recommended during exams.</>
        )}
      </footer>
    </PaperScreen>
  );
}

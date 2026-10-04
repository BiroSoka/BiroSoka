import { BOSSES, bossStates, getSkin } from '@biro/shared';
import type { Navigate } from '../App';
import { Button, PaperScreen, PenPreview } from '../components/ui';
import { usePrefs } from '../lib/prefs';

/** The Career ladder: beat each opponent in order, win a pen from each. */
export function Career({ navigate }: { navigate: Navigate }) {
  const prefs = usePrefs();
  const states = bossStates(prefs.stats.careerCleared);
  const cleared = states.filter((s) => s.state === 'cleared').length;

  return (
    <PaperScreen title="Career" onBack={() => navigate({ name: 'home' })}>
      <p className="muted">
        Beat every opponent in order. Each has a quirk, and each win earns a new pen. <b>{cleared}/{BOSSES.length}</b> beaten.
      </p>
      <ol className="boss-list">
        {states.map(({ boss, state }, i) => {
          const prize = getSkin(boss.reward);
          return (
            <li key={boss.id} className={`boss-card ${state}`}>
              <span className="boss-emoji" aria-hidden="true">
                {state === 'locked' ? '🔒' : boss.emoji}
              </span>
              <div className="boss-text">
                <strong>
                  {i + 1}. {boss.name}
                </strong>
                <small className="boss-target">First to {boss.target}</small>
                <span className="boss-quirk">{state === 'locked' ? `Beat ${BOSSES[i - 1].name} first.` : boss.quirk}</span>
                <span className="boss-prize">
                  <PenPreview skin={prize.id} width={74} height={26} angle={-0.2} />
                  {state === 'cleared' ? 'Won' : 'Prize'}: {prize.name}
                </span>
              </div>
              {state !== 'locked' && (
                <Button
                  variant={state === 'current' ? 'blue' : 'ghost'}
                  size="sm"
                  onClick={() => navigate({ name: 'game-ai', difficulty: boss.level, target: boss.target, career: boss.id })}
                >
                  {state === 'current' ? 'Challenge' : '✔ Again'}
                </Button>
              )}
            </li>
          );
        })}
      </ol>
      {cleared === BOSSES.length && <p className="boss-beaten">🏆 You cleared the whole Career! Nobody can touch you.</p>}
    </PaperScreen>
  );
}

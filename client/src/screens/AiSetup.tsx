import { TARGET_SCORES, type Difficulty } from '@biro/shared';
import type { Navigate } from '../App';
import { Button, PaperScreen, Segmented } from '../components/ui';
import { setPrefs, usePrefs } from '../lib/prefs';

export const AI_OPPONENTS: Record<Difficulty, { name: string; blurb: string; emoji: string }> = {
  easy: { name: 'New Kid', blurb: 'Still learning which end is the tip.', emoji: '🐣' },
  medium: { name: 'Class Rep', blurb: 'Decent aim. Plays it safe.', emoji: '😎' },
  hard: { name: 'Desk Champ', blurb: 'Undefeated since Year 7. Beat them for the Gold Nib.', emoji: '👑' },
};

export function AiSetup({ navigate }: { navigate: Navigate }) {
  const prefs = usePrefs();

  return (
    <PaperScreen title="vs Computer" onBack={() => navigate({ name: 'home' })}>
      <section className="card-list">
        {(Object.keys(AI_OPPONENTS) as Difficulty[]).map((d) => {
          const o = AI_OPPONENTS[d];
          const on = prefs.difficulty === d;
          return (
            <button type="button" key={d} className={`opponent-card ${on ? 'on' : ''}`} onClick={() => setPrefs({ difficulty: d })} aria-pressed={on}>
              <span className="opp-emoji">{o.emoji}</span>
              <span className="opp-text">
                <strong>{o.name}</strong>
                <small className={`diff diff-${d}`}>{d}</small>
                <span>{o.blurb}</span>
              </span>
            </button>
          );
        })}
      </section>

      <section className="field">
        <h2 className="hand">First to…</h2>
        <Segmented
          label="Target score"
          value={prefs.target}
          onChange={(target) => setPrefs({ target })}
          options={TARGET_SCORES.map((t) => ({ value: t as number, label: t }))}
        />
      </section>

      <div className="grow" />
      <Button variant="blue" size="lg" onClick={() => navigate({ name: 'game-ai', difficulty: prefs.difficulty, target: prefs.target })}>
        Start game
      </Button>
    </PaperScreen>
  );
}

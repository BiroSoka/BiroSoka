import { STREAK_REWARDS, currentStreak, dateKey, ensureToday, getSkin } from '@biro/shared';
import { usePrefs } from '../lib/prefs';

/** Today's three goals and the day streak, shown on the home screen. */
export function DailyCard() {
  const prefs = usePrefs();
  const today = dateKey();
  const daily = ensureToday(prefs.daily, today);
  const streak = currentStreak(prefs.daily, today);
  const done = daily.goals.filter((g) => g.progress >= g.target).length;
  const nextReward = STREAK_REWARDS.find((r) => prefs.stats.bestStreak < r.days);
  const playedToday = prefs.daily.lastPlayed === today;

  return (
    <section className="daily-card" aria-label="Daily goals">
      <header>
        <strong className="streak">🔥 {streak > 0 ? `${streak}-day streak` : 'Start a streak today'}</strong>
        <span className="daily-count">
          {done}/{daily.goals.length} goals
        </span>
      </header>
      <ul>
        {daily.goals.map((g) => {
          const finished = g.progress >= g.target;
          return (
            <li key={g.id} className={finished ? 'done' : ''}>
              <span className="goal-text">
                {finished ? '✅' : '🎯'} {g.text}
              </span>
              <span className="goal-bar" aria-hidden="true">
                <i style={{ width: `${(g.progress / g.target) * 100}%` }} />
              </span>
              <small>
                {g.progress}/{g.target}
              </small>
            </li>
          );
        })}
      </ul>
      <footer>
        {nextReward
          ? `Play ${nextReward.days} days in a row to win the ${getSkin(nextReward.skin).name} pen${streak > 0 && !playedToday ? ' · play today to keep your streak!' : ''}`
          : 'All streak pens won. Keep the streak alive!'}
      </footer>
    </section>
  );
}

import { SKINS, TABLE_THEMES } from '@biro/shared';
import type { Navigate } from '../App';
import { PaperScreen, PenPreview, Segmented } from '../components/ui';
import { sfx } from '../lib/audio';
import { isUnlocked, setPrefs, unlockText, usePrefs } from '../lib/prefs';

export function PensScreen({ navigate }: { navigate: Navigate }) {
  const prefs = usePrefs();

  return (
    <PaperScreen title="Pens & Desks" onBack={() => navigate({ name: 'home' })}>
      <p className="muted">Cosmetic only. Every pen flicks exactly the same.</p>
      <section className="skin-grid">
        {SKINS.map((s) => {
          const open = isUnlocked(s, prefs.stats);
          const on = prefs.skin === s.id;
          return (
            <button
              type="button"
              key={s.id}
              className={`skin-card ${on ? 'on' : ''} ${open ? '' : 'locked'}`}
              disabled={!open}
              aria-pressed={on}
              onClick={() => {
                sfx.tap();
                setPrefs({ skin: s.id });
              }}
            >
              <PenPreview skin={s.id} width={130} height={56} angle={-0.3} />
              <strong>{s.name}</strong>
              <small>{open ? (on ? 'Equipped' : 'Tap to use') : `🔒 ${unlockText(s)}`}</small>
            </button>
          );
        })}
      </section>

      <section className="field">
        <h2 className="hand">Desk</h2>
        <Segmented
          label="Desk theme"
          value={prefs.table}
          onChange={(table) => setPrefs({ table })}
          options={TABLE_THEMES.map((t) => ({ value: t.id, label: t.name }))}
        />
      </section>
    </PaperScreen>
  );
}

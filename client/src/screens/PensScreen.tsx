import { useState } from 'react';
import { SKINS, TABLE_THEMES } from '@biro/shared';
import type { Navigate } from '../App';
import { PaperScreen, PenPreview, Segmented } from '../components/ui';
import { sfx } from '../lib/audio';
import { isUnlocked, setPrefs, unlockText, usePrefs } from '../lib/prefs';
import { buyProduct, insideLagosLife } from '../lib/vatar';

export function PensScreen({ navigate }: { navigate: Navigate }) {
  const prefs = usePrefs();
  const [buying, setBuying] = useState('');
  const [note, setNote] = useState('');

  async function buy(product: string) {
    if (buying) return;
    sfx.tap();
    setBuying(product);
    setNote('');
    try {
      if (!(await buyProduct(product))) setNote('We could not confirm that purchase yet. Reopen the game and it will finish by itself.');
    } catch {
      /* the player closed the pay sheet or it failed: nothing was bought */
    }
    setBuying('');
  }

  return (
    <PaperScreen title="Pens & Desks" onBack={() => navigate({ name: 'home' })}>
      <p className="muted">Cosmetic only. Every pen flicks exactly the same.</p>
      {note && <p className="muted">{note}</p>}
      <section className="skin-grid">
        {SKINS.map((s) => {
          const open = isUnlocked(s, prefs.stats);
          const on = prefs.skin === s.id;
          if (!open && s.unlock.type === 'purchase') {
            // Sold only inside Lagos Life.
            if (!insideLagosLife()) return null;
            const product = s.unlock.product;
            return (
              <button type="button" key={s.id} className="skin-card" disabled={!!buying} onClick={() => void buy(product)}>
                <PenPreview skin={s.id} width={130} height={56} angle={-0.3} />
                <strong>{s.name}</strong>
                <small>{buying === product ? 'Opening…' : `Buy · ₦${s.unlock.price}`}</small>
              </button>
            );
          }
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

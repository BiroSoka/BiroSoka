import type { Navigate } from '../App';
import { Button, PaperScreen, Segmented, Toggle } from '../components/ui';
import { sfx } from '../lib/audio';
import { setPrefs, usePrefs } from '../lib/prefs';

export function Settings({ navigate }: { navigate: Navigate }) {
  const prefs = usePrefs();
  return (
    <PaperScreen title="Settings" onBack={() => navigate({ name: 'home' })}>
      <section className="field">
        <label className="hand" htmlFor="sname">Your name</label>
        <input id="sname" className="text-input" maxLength={16} value={prefs.name} placeholder="e.g. Tunde" onChange={(e) => setPrefs({ name: e.target.value })} />
      </section>
      <Toggle label="Sound effects" checked={prefs.sound} onChange={(sound) => setPrefs({ sound })} />
      <Toggle label="Music" checked={prefs.music} onChange={(music) => setPrefs({ music })} />
      <Toggle label="Vibration" checked={prefs.haptics} onChange={(haptics) => setPrefs({ haptics })} />
      <section className="field">
        <h2 className="hand">Aim guide</h2>
        <Segmented
          label="Aim guide length"
          value={prefs.guide}
          onChange={(guide) => setPrefs({ guide })}
          options={[
            { value: 'short', label: 'Short' },
            { value: 'long', label: 'Long' },
          ]}
        />
      </section>
      <Button variant="ghost" onClick={() => sfx.test()}>
        🔊 Test sound
      </Button>
      <p className="muted small">No sound on an iPhone? Switch off silent mode (the switch on the side) and turn up the media volume.</p>
      <Button variant="ghost" onClick={() => setPrefs({ seenTutorial: false })}>
        Show flick tutorial again
      </Button>
    </PaperScreen>
  );
}

import type { ReactNode } from 'react';
import type { Navigate } from '../App';
import { Button, PaperScreen } from '../components/ui';

interface Step {
  who: 'both' | 'host' | 'guest';
  title: string;
  body: ReactNode;
}

const WHO: Record<Step['who'], string> = {
  both: 'Both of you',
  host: 'Player 1 (host)',
  guest: 'Player 2 (friend)',
};

const STEPS: Step[] = [
  {
    who: 'both',
    title: 'Open the game',
    body: (
      <>
        Both of you open the game link in your phone or computer browser. You need internet, but you don't need to be on the same Wi-Fi or in the same country.
        <span className="tip">Tip: in your browser menu choose “Add to Home Screen” to launch it like an app.</span>
      </>
    ),
  },
  {
    who: 'host',
    title: 'Create a room',
    body: (
      <>
        Tap <b>Play a Friend Online</b>, type your name, pick a target score (first to 3, 5, 7 or 10), then tap <b>Create room</b>.
      </>
    ),
  },
  {
    who: 'host',
    title: 'Send the code',
    body: (
      <>
        You get a 5-character code like <b className="mini-code">TG482</b>. Tap <b>Share invite</b> to send it on WhatsApp, iMessage or anywhere else, or tap the code to copy it. The invite link fills the code in for your friend.
      </>
    ),
  },
  {
    who: 'guest',
    title: 'Join with the code',
    body: (
      <>
        Open the invite link and the code is already typed in. Otherwise tap <b>Play a Friend Online</b>, enter your name and the code, then tap <b>Join</b>.
      </>
    ),
  },
  {
    who: 'both',
    title: 'Flick!',
    body: (
      <>
        The match starts by itself with a coin toss to decide who flicks first, then you take turns. Your pen is always the one nearest you, and the other player sees the same shot play out live. Send reactions with the smiley button.
      </>
    ),
  },
  {
    who: 'both',
    title: 'Play again',
    body: (
      <>
        When someone wins, both tap <b>Rematch</b> for another game (the other player starts). If your connection drops, the game waits about 90 seconds for you to come back.
      </>
    ),
  },
];

const TROUBLE: [string, string][] = [
  ['“No room called …”', 'Check the code for typos. Codes are 5 characters and never contain 0, O, 1, I or L. A code stops working once the host leaves the waiting room.'],
  ['“That room is already full”', 'A room is for exactly two players. The host can create a fresh room.'],
  ['Stuck on “Connecting to server…”', 'The server may be waking up after being idle. Wait about a minute, then try again.'],
];

export function HowToOnline({ navigate }: { navigate: Navigate }) {
  return (
    <PaperScreen title="Play a friend" onBack={() => navigate({ name: 'online' })}>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className={`step step-${s.who}`}>
            <span className="step-num marker" aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <span className="step-who">{WHO[s.who]}</span>
              <h2 className="marker">{s.title}</h2>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="trouble">
        <h2 className="hand">Something not working?</h2>
        {TROUBLE.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>

      <div className="grow" />
      <Button variant="blue" size="lg" onClick={() => navigate({ name: 'online' })}>
        Let's play
      </Button>
    </PaperScreen>
  );
}

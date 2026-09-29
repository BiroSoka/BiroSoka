import type { Navigate } from '../App';
import { Button, PaperScreen } from '../components/ui';

export function HowTo({ navigate }: { navigate: Navigate }) {
  return (
    <PaperScreen title="How to play" onBack={() => navigate({ name: 'home' })}>
      <ol className="howto">
        <li>
          <b>Flick.</b> Press your glowing pen, drag <em>backwards</em> like a slingshot, then let go. The further you pull, the harder it goes.
        </li>
        <li>
          <b>Aim.</b> The dotted line shows where your pen will travel. A ring marks where it hits the other pen and the arrow shows where theirs will go.
        </li>
        <li>
          <b>Spin.</b> Grab near an end of the pen and flick sideways to make it spin and swerve.
        </li>
        <li>
          <b>Score.</b> Knock their pen off the desk and stay on it: <b>+1</b>. Fall off yourself: <b>−1</b>. Both fall: nothing.
        </li>
        <li>
          <b>Win.</b> First to the target score wins. Pens go back to the middle after every knock-off.
        </li>
      </ol>
      <Button variant="ghost" onClick={() => navigate({ name: 'howto-online' })}>
        🌍 Playing a friend online? Read this
      </Button>
      <div className="grow" />
      <Button variant="blue" onClick={() => navigate({ name: 'home' })}>
        Got it
      </Button>
    </PaperScreen>
  );
}

# Contributing to Biro Soka

Thank you for wanting to help! This game is small enough that one person can understand all of it, and every
improvement, from a typo fix to a whole new game mode, makes it better for the people who play it.

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

You do **not** have to be a game developer.

- 🐛 **Report a bug.** Tell us what you did, what you expected and what happened, plus your phone or browser.
- 💡 **Suggest something.** Open an issue and tell us the problem you want solved.
- 🖊️ **Add a pen or a desk.** They are a few lines of code each (see "Common jobs" below).
- 😄 **Write funny lines.** The commentary after a knock-off lives in one file and is easy to extend.
- 🏆 **Design a Career opponent**, or **a daily goal**.
- 🧪 **Add a test** for something that is not covered yet.
- ♿ **Improve accessibility**: contrast, screen-reader labels, reduced-motion, bigger touch targets.
- 📝 **Improve the docs.**

Look for issues labelled **good first issue** and **help wanted**.

## Before you start

- **Small fix?** Just open a pull request.
- **Bigger change** (a new mode, a change to the rules or the physics, a new dependency)? Please **open an issue first** so
  we can agree on the idea before you spend your time.
- Check the issue list so you do not duplicate someone else's work. If you want an issue, say so in a comment.

## Set up

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/<your-username>/BiroSoka.git     # your fork
cd BiroSoka
npm install
npm run dev
```

Open <http://localhost:5173>. For multiplayer, open a second **private/incognito** window (it has its own saved data).
To try it on a phone on the same Wi-Fi, use the "Network" address Vite prints.

Before you open a pull request, run:

```bash
npm run typecheck
npm test
npm run build
```

`npm test` runs the rules, physics, AI and replay checks and then starts a real server to test pairing, chat and
bad connections. It takes a few minutes. Continuous integration runs the same commands on every pull request.

## The rules of the road

These keep the game fair and fun. They matter more than style.

1. **The way the game feels is protected.** The physics numbers (`PHYS`, `ACCURACY`, `INPUT` in
   [`shared/src/config.ts`](shared/src/config.ts)) are tuned by feel, and players love them. Do not change them in a
   drive-by pull request. If you think they should change, open an issue first and show evidence: the measurements from
   `npx tsx shared/scripts/tune.ts` and `ace.ts`, and what playtesting told you.
2. **Keep the shared code deterministic.** `shared/src/sim.ts`, `rules.ts`, `royale.ts` and `replay.ts` must give the
   same result on every device and on the server, every time. No `Math.random()`, `Date.now()` or timing-dependent
   behaviour in there. Use the seeded random numbers from `rng.ts`.
3. **The server never trusts a client.** If a client could cheat by sending something odd, the server must check it.
   Add a test when you add a message.
4. **No pay-to-win.** Pens and desks are cosmetic only. Nothing unlockable may change how a game plays.
5. **No personal data.** There are no accounts and no database, and typed messages are never stored or logged. Please keep
   it that way. Do not add trackers or analytics without discussing it first.
6. **Mobile first.** Most players are on phones with a finger. Check your change at a phone-sized screen, in portrait
   and landscape, and make sure touch targets are big enough.
7. **Friendly for all ages.** It is a schoolyard game and some players are young. Keep names, jokes and art kind.
8. **Be careful with new dependencies.** Every package is a cost. Ask first, and prefer a few lines of code over a library.

## Code style

- TypeScript in strict mode. Match the code around you: names, comment density and idioms.
- Comments explain **why**, not what.
- Keep functions small and readable. Prefer plain code to clever code.
- Use the `.editorconfig` settings (your editor will pick them up).

## Making a change

1. **Fork** the repository and create a branch from `main`: `git checkout -b fix/short-description`.
2. Make your change, **in small commits** with clear messages that say what and why, in the present tense
   ("Fix the replay skipping on tap"), not "fixed stuff".
3. Add or update tests when you change behaviour.
4. Run `npm run typecheck`, `npm test` and `npm run build`.
5. Push your branch and open a **pull request** against `main`. Fill in the template: what changed, why, and how you tested it.
   Screenshots or a short screen recording help a lot for anything visual.
6. A maintainer will review it. Please be patient (this is a hobby project), and expect questions or small requests
   for changes. When it is approved and CI is green it will be **squash-merged**.

Pull requests that only change a whole lot of formatting, or that bundle several unrelated things, are hard to review
and will be sent back to be split up.

## Common jobs

| I want to... | Edit | Also |
|---|---|---|
| Add a **pen** | `SKINS` in [`shared/src/skins.ts`](shared/src/skins.ts) | Check it on a dark and a light desk. Choose how it unlocks (`free`, `wins`, `career`, `streak`). |
| Add a **desk** | `TABLE_THEMES` in `shared/src/skins.ts` and the palette in [`client/src/game/tableArt.ts`](client/src/game/tableArt.ts) | |
| Add **commentary lines** | [`client/src/lib/quips.ts`](client/src/lib/quips.ts) | Keep them short, kind and funny. |
| Add a **Career opponent** | `BOSSES` in [`shared/src/career.ts`](shared/src/career.ts), plus their pen and prize pen in `skins.ts` | Run `npx tsx shared/scripts/career-duel.ts <id> 20 <the one below>` to check they are harder than the previous opponent, and extend `shared/scripts/progress-check.ts`. |
| Add a **daily goal** | `GOAL_ROWS` in [`shared/src/progress.ts`](shared/src/progress.ts) | Add a case to `shared/scripts/progress-check.ts`. |
| Change the **AI** | [`shared/src/ai.ts`](shared/src/ai.ts) | Use `npx tsx shared/scripts/duel.ts` to prove it is not weaker, and keep thinking time short on phones. |
| Add a **server message** | `shared/src/protocol.ts`, `server/src/index.ts`, `client/src/lib/online.ts` | Validate input on the server and add a test in `server/tests/`. |

## Testing

- **Logic and physics:** scripts in `shared/scripts/` (`rules-check`, `royale-check`, `progress-check`, `replay-check`).
- **The real server:** `server/tests/*.test.mts`, run against a live server by `server/tests/run.mts`.
- **Tuning tools** (not tests): `tune.ts`, `ace.ts`, `duel.ts`, `career-duel.ts` in `shared/scripts/`. Run them with `npx tsx`.
- **In a real browser (optional):** `client/e2e/` has scripts that drive the game with a headless Chrome. They need Chrome
  and the dev server running, use a small development-only hook (`window.__biro`, which is removed from production
  builds), and are not run in CI. See the comments at the top of each file.

## Reporting a security problem

Please do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## A note on the original plan

[`claude.md`](claude.md) is the original product brief. The game idea and rules are still the guide, but its
technology sections (Godot, Firebase) are out of date: the game is now a web app, as described above.

## Licence

By contributing you agree that your contribution is released under the project's [MIT License](LICENSE).

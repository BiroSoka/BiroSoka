# Maintaining Biro Soka (a guide for the project owner)

This is for **you**, the person who runs the project. It explains whether open source makes sense, how to open the
project up safely, and what to do week to week.

---

## 1. Does open source make sense for this game?

**Yes, with eyes open.** For a small, friendly, free game it is a good fit.

**What you gain**
- People can fix bugs, add pens, desks, jokes and opponents, so the game grows faster than one person could manage.
- It is a public portfolio of real, working, tested code.
- Contributors and players become a community, and a community recommends the game to others.
- Other people reading your code will spot problems earlier.

**What you should expect**
- **Clones.** Anyone can copy the code and run their own version. With the MIT licence this is allowed. What a clone
  cannot copy is your name, your live site, your players or your updates. Being first, friendly and active is your protection.
- **A bit of work.** Issues, questions and pull requests need replies. Plan on 1 to 2 hours a week, and it is fine to say
  "I will look at this next weekend" or "no thanks".
- **A bigger target.** Public code is easier for attackers to study. The design is already careful (no accounts, no
  secrets, the server never trusts a client), and `SECURITY.md` gives people a private way to report problems.
- **Strangers on your server.** Quick match puts unknown players together. Typed messages are switched off there for
  that reason, but **names are free text and not filtered**. See "Keeping players safe" below.
- **Making money later is still possible.** Open source does not stop you selling cosmetics from the official site;
  other people would have to build and run their own server. Decide on that early (see "Decisions that are yours").

If you would rather not take any of that on yet, you can keep the repository private and open it later. Nothing here
is urgent.

---

## 2. Decisions that are yours

I set sensible defaults. Please review each one **before the repository goes public**.

| Decision | Default I used | Alternatives |
|---|---|---|
| **Licence** | **MIT** (`LICENSE`, copyright "ma_azi"). Simple, friendly, lets people use the code freely as long as they keep your copyright notice. | **AGPL-3.0**: anyone who runs a modified copy as a website must publish their changes. Better if you want to discourage closed-source clones; a few contributors dislike it. **PolyForm Noncommercial** or similar: not truly "open source", blocks commercial use. Change the `LICENSE` file and the `license` fields in the `package.json` files to switch. |
| **Name on the licence** | `ma_azi` (the handle already shown in the game's footer) | Your real name, or a company name. |
| **The name "Biro Soka"** | Not protected beyond the copyright notice | If you want forks to rename themselves, add a sentence to the README saying the name and logo are yours. |
| **Contact for conduct and security reports** | `<your contact email>` placeholders in `SECURITY.md` | Use GitHub's private vulnerability reporting (below) and avoid publishing an email. |
| **Who is allowed to merge** | Only you | Add trusted contributors as collaborators later. |

---

## 3. Before you make the repository public (checklist)

- [ ] **Check the repository's visibility.** A remote already exists (`github.com/Zuka-Dev/BiroSoka`). On GitHub:
      *Settings > General > Danger Zone > Change repository visibility*. Do not switch it to public until the rest is done.
- [ ] **Your email address.** Every commit so far was made with your personal Gmail address, and **commit emails are
      public in a public repo**. Choose one:
      - *Accept it* if you are happy for it to be visible.
      - *Hide it for new commits (recommended)*: on GitHub open *Settings > Emails*, tick **Keep my email addresses private**
        and **Block command line pushes that expose my email**, then run
        `git config user.email "<id>+<username>@users.noreply.github.com"` (the exact address is shown on that page).
      - *Remove it from old commits* only if you must: this means rewriting history with
        [`git filter-repo`](https://github.com/newren/git-filter-repo) and force-pushing, which breaks anyone who already
        cloned. Since the project is young and solo, it is much easier to do now than later.
- [ ] **Secrets.** I scanned the tracked files: there are none (no keys, tokens or passwords; the game has no accounts).
      Keep it that way. `.env` files are already git-ignored.
- [ ] **Leftovers.** The Godot logo and import file were removed. (`claude.md` is the original product brief and is kept.)
- [ ] **Fill in the placeholders**: search the repository for `<your` and `YOUR-APP` and `<your live URL here>`
      (README, `SECURITY.md`, `DEPLOY.md`) and replace them.
- [ ] **Licence and name** reviewed (section 2).
- [ ] **Run the checks**: `npm run typecheck && npm test && npm run build`.
- [ ] **Take a look as a stranger** would: open the README on GitHub in a private window.

---

## 4. Publishing, step by step

The code is already connected to GitHub. Commit your work and push:

```bash
git status                      # review what changed
git add -A
git commit -m "Add quick match, career, daily goals, replay and open-source files"
git push origin main
```

Then, **on GitHub** (repository > Settings):

1. **General**
   - Add a short *Description* and *Topics* (`game`, `physics`, `multiplayer`, `react`, `canvas`, `typescript`, `socket-io`).
   - Add your live URL as the *Website*.
   - Turn on *Issues*. *Discussions* is optional but nice for questions and ideas.
   - Under *Pull Requests*, allow **squash merging** only and tick *Automatically delete head branches*.
2. **Branches > Add branch ruleset** (or *branch protection rule*) for `main`:
   - Require a pull request before merging.
   - Require status checks to pass, and pick **CI / check**.
   - Block force pushes and deletions.
   - (As a solo maintainer you can leave "require approvals" at 0 and still merge your own pull requests once CI is green.
     Raise it to 1 when you have other maintainers.)
3. **Code security** (*Settings > Code security*)
   - Turn on **Private vulnerability reporting** (this is what `SECURITY.md` points to).
   - Turn on **Dependabot alerts** and **Dependabot security updates**. (`.github/dependabot.yml` already asks for weekly updates.)
   - Turn on **Secret scanning** and **Push protection**.
4. **Actions > General**
   - Under *Fork pull request workflows*, choose **Require approval for first-time contributors**.
   - Keep *Workflow permissions* at **Read repository contents**. Our workflows need nothing more.
5. **Labels** (*Issues > Labels*). Create these once (or paste the command below, if you use the GitHub CLI `gh`):
   `good first issue`, `help wanted`, `bug`, `enhancement`, `question`, `physics`, `ai`, `ui`, `server`, `docs`, `needs-repro`, `wontfix`.
   ```bash
   gh label create "good first issue" --color 7057ff --description "Good for newcomers"
   gh label create "help wanted"      --color 008672 --description "Extra attention is needed"
   gh label create physics --color d93f0b ; gh label create ai --color 5319e7 ; gh label create ui --color 0e8a16
   gh label create server  --color 1d76db ; gh label create docs --color 0075ca ; gh label create needs-repro --color fbca04
   ```
6. **Tell people**: pin a couple of **good first issue** tickets (ideas below), and share the game link.

Your **live site is separate**: Render deploys whatever is on `main` (see [DEPLOY.md](../DEPLOY.md)). That is another
reason to protect `main` so that only reviewed, passing code goes live.

---

## 5. Day to day

**A weekly 30-60 minute routine**
1. Open the **Issues** and **Pull requests** tabs. Say hello to anything new, even if only "thanks, I will look soon".
2. **Triage** new issues: add labels; ask for steps or a phone model if a bug is vague (`needs-repro`); close duplicates
   politely with a link; mark small, clear tasks `good first issue`.
3. **Review pull requests** (checklist below).
4. Check **Dependabot** pull requests: merge patch and minor updates when CI is green; read the notes for major ones.
5. Glance at the live site (`/api/health`) and your uptime monitor.

**Reviewing a pull request: a checklist**
- Does it solve a real problem, and is it the smallest reasonable change?
- Do CI checks pass? Did they add or update tests for behaviour changes?
- **Physics and rules:** are `PHYS`, `ACCURACY` or `INPUT` untouched? If not, is there evidence from `tune.ts` / `ace.ts`?
- Is the shared code still deterministic (no `Math.random`, `Date.now`)?
- Does the server validate anything new a client can send?
- Does it work on a phone-sized screen with a finger?
- Is the content (names, jokes, art) friendly for all ages?
- Any new dependency? Is it really needed, and is its licence compatible with MIT?
- Anything that stores or sends personal data? (It should not.)
- Pull and try it for anything visual: `gh pr checkout <number>` then `npm run dev`.

**Merging and releasing**
- Merge with **Squash and merge**, with a clear title. Merging to `main` deploys the live game, so merge when you are
  happy for players to see it, and ideally not while people are mid-game (a deploy restarts the server and ends games in progress).
- Because the client and server ship together, there is nothing to version separately. Tag milestones if you like
  (`git tag v1.0.0 && git push --tags`) and write a short note in a GitHub *Release*.

**Saying no**
It is fine, and healthy, to decline. A friendly template: *"Thanks for the idea and the work! This does not fit where the
game is going (reason), so I am going to close it. You are welcome to keep it in your fork."*

---

## 6. Keeping players safe

- **No accounts and no stored messages** limit what can go wrong. Typed chat is **off in Quick match** (strangers).
- **Names are free text.** In Quick match and in rooms, anyone can choose any name. A good next step is a small
  word filter in `cleanName()` in `shared/src/protocol.ts`, applied on the server, plus a "report" button. It is a
  nice **help wanted** issue.
- **Moderation rights.** On GitHub you can edit or delete comments, lock threads, and block users
  (*Settings > Moderation options* and the "..." menu on a comment).
- **Enforcing the Code of Conduct:** gentle reminder first, then a warning, then a temporary block, then a permanent
  ban for serious or repeated problems. Keep notes of what happened.
- If you ever collect data (analytics, accounts), you will need a privacy policy and may have extra legal duties,
  especially because children play. Please discuss it with the community before adding anything.

---

## 7. Costs and limits to keep an eye on

- **Render's free plan**: about 750 free instance hours a month, which fits one service running all month, and the
  service sleeps without traffic. The built-in keep-awake and an uptime monitor handle that (see DEPLOY.md).
- **One server, in memory.** Rooms and the Quick match queue live in one process. That is fine for a few hundred players.
  If the game grows past that, the next step is moving rooms to Redis and running more than one server (a good
  contributor project).
- **`MAX_ROOMS`** (default 2000) stops the server from being overwhelmed.

---

## 8. Ideas to seed "good first issue" / "help wanted"

- Add 20 more commentary lines to `client/src/lib/quips.ts`.
- Add a new pen or desk theme.
- Add a name filter on the server, and a report button.
- Tests for the share card or the daily-goals card in `client/`.
- Screen-reader labels and a high-contrast mode.
- A "left-handed" layout and landscape polish.
- A leaderboard (needs a small database; discuss design first).
- Tournaments and daily challenges (discuss design first).
- Translations (the text is in the screens; it would need a small i18n layer).
- A smarter AI: for example, learning from the player's habits.
- A sound-pack option and volume sliders.
- Move rooms to Redis so more than one server can run.

---

## 9. Quick reference

| Task | Where |
|---|---|
| How to set up and what the rules are | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| How to deploy and keep the server awake | [DEPLOY.md](../DEPLOY.md) |
| Report a vulnerability | [SECURITY.md](../SECURITY.md) |
| Behaviour expectations | [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) |
| Run all checks | `npm run typecheck && npm test && npm run build` |
| Is the live game up? | `https://YOUR-APP.onrender.com/api/health` |

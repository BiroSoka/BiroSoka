## What does this change?

<!-- A short description, and the issue it closes (for example "Closes #12"). -->

## Why?

<!-- What problem does it solve, or what does it make better? -->

## How did you test it?

<!-- Commands you ran, devices or browsers you tried. Screenshots or a short recording help a lot for anything visual. -->

## Checklist

- [ ] `npm run typecheck`, `npm test` and `npm run build` pass
- [ ] I added or updated tests for any behaviour I changed
- [ ] I did **not** change the physics numbers (`PHYS`, `ACCURACY`, `INPUT`), or I opened an issue first and included evidence
- [ ] Shared game code is still deterministic (no `Math.random()` or `Date.now()` in `sim`, `rules`, `royale`, `replay`)
- [ ] The server checks anything new that a client can send
- [ ] It works on a phone-sized screen
- [ ] No new dependency (or I discussed it first)
- [ ] Names, jokes and art are friendly for all ages

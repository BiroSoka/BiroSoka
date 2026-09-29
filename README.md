# Biro Soka (web)

Top-down pen-flicking game in the style of iMessage 8 Ball. React + Canvas client,
Node (Express + Socket.IO) server, shared TypeScript physics (planck.js / Box2D).

    npm install
    npm run dev        # client http://localhost:5173 (LAN-accessible), server :3001

Open the Vite URL on your phone (same Wi-Fi) to test touch. Production: `npm run build && npm start`
serves the app and the multiplayer server together on :3001 (set PORT to change).

## Layout
- `shared/` physics (`sim.ts`), scoring (`rules.ts`), AI (`ai.ts`), tuning (`config.ts`), socket protocol
- `client/`  React UI, canvas renderer (`game/renderer.ts`), game state machine (`game/controller.ts`)
- `server/`  room codes + authoritative shot referee (re-simulates every shot, so no cheating)

Tune the feel in `shared/src/config.ts`. Helper scripts (run with `npx tsx`): `shared/scripts/tune.ts` (shot distances, AI timing), `shared/scripts/duel.ts` (AI vs AI), `shared/scripts/ace.ts` (how often a straight full-power shot knocks the opponent off; controlled by `ACCURACY` and `START` in config).

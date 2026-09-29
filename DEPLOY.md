# Deploying Biro Soka

## Option A (recommended): everything on Render

One service hosts the game and the multiplayer server, so there is no CORS or extra config.

1. Push this repo to GitHub.
2. On https://render.com choose **New > Blueprint**, pick the repo. It reads `render.yaml`.
   (Or **New > Web Service** with build `npm install --include=dev && npm run build`, start `npm start`,
   health check `/api/health`, env `NODE_VERSION=22`.)
3. Open the `https://biro-soka.onrender.com` URL Render gives you. Send that link to friends.

Notes
- **Free plan sleeps** after ~15 minutes idle; the next visit takes ~30-60s to wake. Use the Starter plan to avoid it.
- **Rooms live in memory.** A restart or redeploy ends games in progress. Fine for a single instance; do not scale to 2+ instances without moving rooms to Redis.
- Optional env vars: `MAX_ROOMS` (default 2000).

## Option B: front-end on Vercel, server on Render

Only worth it if you specifically want Vercel's CDN for the static files. Vercel cannot run the
Socket.IO server (no persistent connections), so the server must still go on Render.

1. Deploy the server on Render as in Option A. Set env `CLIENT_ORIGIN` to your Vercel URL (e.g. `https://biro-soka.vercel.app`).
2. On Vercel, import the repo with **Root Directory = the repo root** (`vercel.json` sets build and output).
3. In Vercel > Settings > Environment Variables add `VITE_SERVER_URL` = your Render URL, then redeploy
   (it is baked in at build time).

## Local production check

    npm run build
    npm start          # http://localhost:3001

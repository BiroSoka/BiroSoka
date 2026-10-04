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

## Keep the server awake (free pinger)

Render's free plan puts the service to sleep after ~15 minutes without a visit, and the next visitor waits
30-60 seconds. Three layers fix that, all free:

1. **The server pings itself** (already built in). `render.yaml` sets `KEEP_AWAKE=true`, so once the service is awake it
   asks for its own address every 10 minutes and never sleeps again. If you created the service by hand instead of
   with the Blueprint, add the environment variable `KEEP_AWAKE` = `true` in Render > Environment.
2. **UptimeRobot** (do this once; it also covers the very first wake-up after a deploy or a Render restart):
   1. Sign up free at https://uptimerobot.com.
   2. **+ New monitor** > Monitor type **HTTP(s)** > Friendly name **Biro Soka**.
   3. URL: `https://YOUR-APP.onrender.com/api/health` (use your real Render address).
   4. Monitoring interval: **5 minutes** (the free plan's minimum). Create the monitor.
   5. Optional: add your email as an alert contact, so you hear if the game is ever down.
3. **GitHub Actions backup** (once the repo is on GitHub): add a repository *variable* named `PING_URL` with your Render address
   (Settings > Secrets and variables > Actions > Variables). `.github/workflows/keep-awake.yml` then pings every 10 minutes.

Good to know
- Render's free plan gives about 750 free instance-hours per month, and one service awake all month uses about 744, so this
  fits for a single service. Check Render's current limits if you run more than one free service.
- Staying awake does not stop restarts (a deploy, or Render's own maintenance). Games in progress are lost when that happens,
  because rooms are kept in memory.
- Check it works: open `https://YOUR-APP.onrender.com/api/health`. After the first ten minutes it shows `"selfPings"` counting up.

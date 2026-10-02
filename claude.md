> **Update:** the build target changed to a mobile-responsive **web app** (React + Canvas, Node/Socket.IO), 2D top-down like iMessage 8 Ball. Sections 4.4 and 5 below (3D / Godot / Firebase) are superseded; see README.md.

# Product Requirements Document: "Biro Soka"

## 1. Overview

**Concept:** A physics-based mobile game inspired by the classic schoolyard "biro flicking" game, reimagined with the drag-to-aim, power-gauge, and trajectory-preview interaction popularized by mobile pool games (e.g., 8 Ball Pool), and presented with the same kind of glossy, lit, pseudo-3D visual style — pens and table rendered with real depth, lighting, and shadows, while gameplay itself stays confined to a flat table surface.

**Core loop:** Two (or more) players take turns flicking a pen across a table. Flicking your pen into an opponent's and knocking it off the table scores a point. Accidentally flicking your own pen off the table loses you a point. If a collision sends both pens off, no points are awarded.

**Target platforms:** iOS + Android (single codebase)

**Target audience:** Casual mobile gamers, fans of skill-based 1v1 games (8 Ball Pool, Golf Clash, Stick War-style pick-up-and-play titles), nostalgia-driven players who grew up playing similar physical games.

---

## 2. Goals & Success Criteria

| Goal | Metric |
|---|---|
| Ship a fun, addictive core loop | Playtesters voluntarily replay 5+ matches in first session |
| Validate physics feel before heavy investment | Prototype "feels good" test passes before full build begins |
| Launch cross-platform MVP solo, low/no budget | MVP built using free-tier tools only |
| Build repeat engagement | D1 retention benchmark ~25-30% (typical casual mobile game range) |
| Monetize without pay-to-win backlash | Cosmetic/skin revenue with no competitive stat advantage in ranked mode |

---

## 3. Game Modes (MVP Scope)

### MVP (v1) includes:
1. **1 vs AI** — practice/solo mode, adjustable AI difficulty (also doubles as your tutorial and offline mode with zero backend dependency).
2. **Online Multiplayer (code-share)** — one player creates a room and gets a short code (e.g., "TG482"); the other player enters the code to join. Works over the internet (not local Wi-Fi), so both players can be anywhere.

### Post-MVP (Phase 2+):
3. **Full multiplayer / matchmaking** — random opponent matchmaking, ranked ladder, leaderboards.
4. **More than 2 players (free-for-all/battle royale style)** — multiple pens on the table, last-pen-standing or point-based.
5. **Tournaments / daily challenges.**

*Reasoning for phasing:* 1v AI ships without any backend and lets you validate the physics/fun factor immediately. Code-share online multiplayer is the next smallest step (turn-based, low technical complexity vs. real-time matchmaking). Full matchmaking and multiplayer-FFA modes are significantly more complex (server-side matchmaking, more physics edge cases with 3+ pens) and are best tackled once the core game is proven fun.

---

## 4. Core Mechanics

### 4.1 Input — Flick Mechanic
- Player touches and drags from any point on their pen (not just the tip).
- While dragging, display:
  - A **trajectory preview line** showing predicted direction.
  - A **power gauge** showing flick strength based on drag distance/speed.
- Releasing the drag executes the flick; pen accelerates in the indicated direction/power, decelerating via simulated table friction.
- Directly modeled on the drag-release-launch feel of iMessage's 8 Ball Pool mini-game.

### 4.2 Physics & Scoring Rules
- Standard 2D rigid-body physics: mass, friction, restitution (bounciness) tuned per pen/skin.
- **Score +1:** Your flick causes your pen to hit an opponent's pen, and the opponent's pen goes off the table (yours stays on).
- **Own goal:** Your flicked pen goes off the table without knocking an opponent off (self-inflicted "own goal"): your opponent gets +1 and you are simply knocked out (no negative scores, which keeps games short).
- **Score 0 (no change):** A collision sends both pens off the table simultaneously — cancels out.
- **Win condition:** First to a target score (configurable: first to 5 / 7 / 10) wins the match.
- Turn order alternates between players after each flick.

### 4.3 Table & Environment
- Table has defined boundary; pens leaving the boundary are "out."
- Table surface/skin can affect friction (a monetization/cosmetic opportunity — e.g., "ice table" = low friction, purely cosmetic or a distinct casual mode variant).

### 4.4 Visual Style — "3D look on a 2D plane"
This mirrors exactly how 8 Ball Pool and similar mobile games achieve their look:
- **Gameplay logic stays flat/2D:** pens only ever move along the table's horizontal plane (no bouncing upward, no real 3D flight). Physics is effectively 2D math (X/Z axis movement, collision, friction), which keeps the simulation simple, predictable, and easy for a first-time game dev to build and debug.
- **Rendering is 3D:** the table and pens are built as 3D models, viewed through a **fixed, angled camera** (looking down and slightly across the table, like a real over-the-shoulder view of a table). This single camera setup gives:
  - Real lighting and shadows (pens cast shadows on the table; a light source can create highlights on skins/materials).
  - Glossy/reflective pen skins possible (a natural fit for premium cosmetic skins — "chrome pen," "wood-grain pen," etc.).
  - Subtle depth cues (perspective, parallax on table edges) without any added gameplay complexity.
- **Practical implication:** build using a 3D-capable engine (see Tech Stack below) with movement mathematically restricted to a single plane. This gets the visual quality of a "3D game" while keeping the actual game logic as simple as a 2D game.

---

## 5. Recommended Tech Stack

Given: no prior game development experience, solo developer, near-zero budget, need for both iOS and Android, and a need for online multiplayer.

### 5.1 Game Engine: **Godot 4**
- **Free and open-source with no royalties or revenue thresholds ever** (unlike Unity's Runtime Fee model) — important for a solo dev with uncertain future revenue.
- Godot handles **both 2D and 3D in a single engine**, which matters here: with the "3D look on a 2D plane" style (Section 4.4), you'll build the actual game using Godot's **3D scene tree and 3D physics** (models, lighting, fixed camera), while constraining all pen movement mathematically to one flat plane (locking vertical/Y-axis movement). This gets you 8 Ball Pool-style visuals without needing a second engine or a separate 2D/3D pipeline.
- Built-in 3D physics (Godot Physics / Jolt) handles rigid-body collision, friction, and restitution for the flick mechanic; constraining motion to a plane is a simple, well-documented technique (freeze one axis) rather than a separate system.
- **GDScript** is Python-like and considered one of the most beginner-friendly languages for game logic — a reasonable starting point with no prior game dev background.
- Native export templates for iOS and Android from a single project.
- Strong free tutorial ecosystem (official docs + large YouTube/community base) covering both Godot 3D basics and simplified "2.5D" (3D-rendered, 2D-gameplay) projects — this exact pattern (3D visuals, flattened gameplay) is a well-known, well-documented approach, not something you'd be improvising from scratch.
- **Art asset note:** you'll need a small number of simple 3D models (a pen, a table) rather than 2D sprite art. These can be modeled simply (a cylinder + basic details for the pen) or sourced cheaply/free from asset marketplaces (e.g., Sketchfab, itch.io, Godot Asset Library) to avoid needing 3D modeling skills yourself early on.

### 5.2 Multiplayer Backend: **Firebase (free Spark tier)**
- Your game is **turn-based**, not real-time-simultaneous — this is the single biggest simplification available to you. You do NOT need a dedicated real-time game server or complex netcode. You only need to relay a small "flick input" (angle + power values) from one player to the other; each device simulates the resulting physics locally.
- **Firebase Realtime Database or Firestore** can:
  - Generate and store short room codes.
  - Relay each player's flick input turn-by-turn.
  - Sync score state.
- **Firebase Authentication** (anonymous auth) lets you identify players without building your own login system.
- No server infrastructure to manage or pay for at small scale — ideal for a solo, no-budget project.
- *Caveat:* Because physics is simulated independently on each device, minor floating-point differences between devices could theoretically cause disagreement on outcomes. Mitigate by having the "host" device be the authority — it simulates the result and sends the final outcome (score change + final pen positions) to the other player, who just plays back the animation. This also prevents cheating.

### 5.3 Monetization Tooling
- **Native platform IAP** (Apple StoreKit / Google Play Billing) for skin purchases — no fee beyond the standard 15-30% platform cut.
- **RevenueCat** (free tier up to a revenue threshold) to manage cross-platform IAP without building your own receipt-validation backend — recommended once you're ready to ship monetization, not needed for MVP prototyping.
- **AdMob** (optional, later) for rewarded ads (e.g., "watch an ad for an extra skin trial").

### 5.4 Why not Unity or Flutter/Flame?
- **Unity:** More third-party tutorials exist for *3D* games; also introduced a controversial Runtime Fee model in recent years that creates long-term revenue-share uncertainty. Its 2D physics is capable but Godot's is lighter-weight and simpler for a first project.
- **Flutter + Flame:** Flame (Flutter's game engine) is solid but has a smaller physics-specific tutorial base and less mature 2D rigid-body physics tooling out of the box compared to Godot.

**Bottom line stack:** Godot 4 (GDScript) + Firebase (Realtime DB + Anonymous Auth) + native IAP later.

---

## 6. Monetization Strategy

**Principle:** Avoid pay-to-win. Skill-based PvP games lose trust fast if purchasable items affect competitive outcomes.

| Approach | Description |
|---|---|
| **Cosmetic skins (primary)** | Pen designs, trail effects, table themes, victory animations — visual only, no stat impact in ranked/competitive modes. |
| **"Fun" stat skins — casual mode only** | If you still want power/accuracy-boosting pens (per your original idea), restrict them to a separate **Casual/AI mode** where competitive integrity doesn't matter, keeping **Ranked/Online 1v1 stat-neutral.** |
| **Battle pass / season pass (Phase 2+)** | Cosmetic and currency rewards for playing regularly — proven mobile retention + monetization driver. |
| **Rewarded ads (optional)** | E.g., watch an ad to unlock a temporary skin trial or extra daily match. |

---

## 7. MVP Build Plan (Suggested Milestones)

1. **Prototype the flick mechanic only** (no art, no modes) — validate that dragging, power gauge, trajectory line, and physics collisions feel satisfying. This is the highest-risk, most important step to get right before building anything else.
2. **Add scoring rules + win condition + basic AI opponent** (AI can start simple: random power/angle within a reasonable range, then improve with basic aiming logic).
3. **Polish 1 vs AI into a complete, presentable mode** (menus, sound, basic art/table skin).
4. **Add Firebase room-code online multiplayer** on top of the working core loop.
5. **Playtest with real people** (friends, family, online communities) before investing in monetization/art polish.
6. **Add monetization (skins, IAP) once the core loop is validated as fun.**
7. **Submit to TestFlight (iOS) / Internal Testing track (Android)** for a soft launch with a small group.

---

## 8. Key Risks

| Risk | Mitigation |
|---|---|
| Physics doesn't feel satisfying (too floaty, too stiff, unpredictable) | Build the flick-mechanic prototype first, before any other feature — iterate on friction/mass/restitution values with real playtesting. |
| Learning a full game engine solo from scratch takes longer than expected | Godot's GDScript is deliberately beginner-friendly; lean on official Godot 2D physics tutorials early. |
| Cross-device physics mismatch in multiplayer | Use host-authoritative simulation (host device computes the outcome, other device just plays it back) rather than trying to keep two physics simulations perfectly in sync. |
| Pay-to-win perception damages reviews | Keep stat-affecting skins out of ranked/competitive modes entirely. |
| Scope creep (wanting all modes at once) | Stick to the phased plan — 1v AI and code-share multiplayer only for MVP. |
| 3D asset/lighting work feels unfamiliar with no game dev or 3D art background | Start with placeholder primitive shapes (cylinders for pens, a flat box for the table) and basic lighting to validate physics/camera feel first — swap in polished models/materials later once the core loop works. Free/cheap 3D asset packs can cover the small model count needed (just a pen + a table). |

---

## 9. Open Questions for Later Phases
- Should ranked mode have a rating/ELO system, or simple win/loss record?
- Should multiplayer support spectating?
- What's the visual art style — minimalist/flat, or more textured/realistic pens and tables?
- Will there be a social layer (friends list, rematch requests, chat)?


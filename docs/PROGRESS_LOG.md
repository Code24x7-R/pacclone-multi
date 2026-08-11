# PROGRESS_LOG.md — Change Log

<!-- Prefix each entry with [FEATURE], [BUGFIX], [REFACTOR], [INFRA], or [DOCS] -->

## 2026-08-12

### [FEATURE] Mobile support & performance pass (iOS / Android)
- Goal: improve mobile UX and render performance without a mobile-first rewrite.
- M1 Responsive lobby: `@media` queries collapse the two-column lobby to a single scrollable column below 720px and tighten name row / buttons below 480px.
- M2 Game-over overlay cache: the expensive gradient/glow/panel (`createLinearGradient`, `measureText`, `shadowBlur`, `roundRect`) is painted once to an offscreen canvas and blitted each frame.
- M3 Viewport/safe-area polish: viewport meta gains `maximum-scale=1, user-scalable=no, viewport-fit=cover`; `body` and the Leave button + joystick + fire button respect `env(safe-area-inset-*)`; `touch-action` set to prevent zoom/scroll during play.
- M4 Fire button: on-screen FIRE button (touch) shown only when armed during play; sends `input {fire:true}` in the last joystick direction, filling the gap where touch players could never fire a weapon.
- M5 Joystick refactor: adaptive sizing (`min(22vw, 140px)` clamped 90–150px) and extracted pure `joystickDirection`/`clampJoystick`/`adaptiveJoystickSize` into `src/touchControls.js` (UMD) — 25 unit tests. Inline styles moved to CSS.
- M6 Static-layer caching: maze walls (per level) and pellets (per signature) render to offscreen canvases in `src/renderCache.js`, rebuilt only when their input changes — 18 unit tests.
- M7 HUD font scaling: `hudFont()` scales in-game score/level/dash/weapon text by the canvas display-width ratio so it stays legible when CSS-shrunk.
- New files: `src/touchControls.js`, `src/renderCache.js`, `tests/client/touchControls.test.js`, `tests/client/renderCache.test.js`. Existing client test fixtures updated to inject `TouchControls`/`RenderCache` globals.
- Result: 472 tests passing, 0 new lint errors (5 pre-existing warnings unchanged), new modules at 96.6% line / 87.5% branch coverage.
- Files changed: `index.html`, `docs/PLAN.md`, `src/touchControls.js`, `src/renderCache.js`, `tests/client/*.test.js`.

## 2026-08-10

### [FEATURE] Lobby chat — persistent messaging for joined players
- Symptom: no way for players waiting in the lobby to communicate.
- Fix: a chat panel under the high scores in the right lobby column. Players who have joined the lobby can send messages (Send button or Enter); messages are validated server-side (membership via stable token, trimmed, max 200 chars), appended to a rolling in-memory history (capped at 100), and broadcast as `chatMessage` to all connected clients. On join, the client requests `getChatHistory` and receives the full `chatHistory` log so late joiners see prior messages. Name/text are textContent-set on the client to prevent markup injection. Chat input is disabled until the player joins the lobby.
- New server messages: `chat` (C→S, `{text}`), `getChatHistory` (C→S, `{}`). New client→server on join: `getChatHistory`. New server→client: `chatMessage` (`{message:{name,id,text,ts}}`), `chatHistory` (`{messages:[...]}`).
- 4 integration tests in `tests/integration/chat.test.js` (real-time delivery, late-joiner history, non-member blocked, empty ignored) + 2 client tests added to `tests/client/lobbyProtocol.test.js` (history request + render, input enable/disable + send).
- Files changed: `server.js` (chat state, `handleChat`, `chat`/`getChatHistory` cases), `index.html` (chat panel HTML + CSS, `appendChatMessage`, send handling, `chatMessage`/`chatHistory` cases, history request on join, disabled-until-joined).

### [FEATURE] Pac-Man icon branding on lobby heading
- Symptom: the lobby heading was plain text — no retro branding to set the tone.
- Fix: added an inline-SVG Pac-Man character (yellow wedge with a white eye dot, mouth cut via SVG mask) to the left of the title. Wrapped title + subtitle in a flex row with the icon; added a subtle pulsing glow animation (`pacpulse`) for a lively retro feel. Title/subtitle margins reworked to flow inside the new header container.
- Files changed: `index.html` (lobby header HTML + CSS).

### [FEATURE] About dialog shows git commit id
- Symptom: the About dialog showed a static version + date but no way to identify which build was running.
- Fix: the server resolves the current git commit hash at startup (`git rev-parse --short HEAD`, fallback `'unknown'`) and includes it as `commit` in the `welcome` message sent to every client. The client stores it and `getAboutBuildInfo()` appends it to the version string shown in the About footer (e.g. `v0.0.1 · Jan 15, 2026 · 67cc9a6`). Missing commit falls back gracefully (no `· unknown` segment).
- Protocol: `welcome` S→C now carries `{ clientId, commit }`.
- Tests: 2 client tests added to `tests/client/aboutModal.test.js` (commit shown, missing-commit fallback) + 2 integration tests in `tests/integration/serverCommit.test.js` (welcome includes commit, matches git HEAD). 418 total pass.
- Files changed: `server.js` (`GIT_COMMIT` resolution, `commit` in welcome), `index.html` (`serverCommit` state, capture in `welcome` handler, `getAboutBuildInfo` appends commit), `docs/Architecture.md` (protocol table).

### [FEATURE] IRC-style kick notices in chat
- Symptom: when a player was AFK-kicked, only they saw the reason (via the in-game banner); other lobby players had no idea someone left.
- Fix: the server now broadcasts a `kickNotice` message (`{ text }`) to ALL open connections after an AFK sweep, with naturally-joined names — e.g. "Bob was kicked for inactivity." or "Alice and Bob were kicked for inactivity." The client renders it as an IRC-style system message (italic, accent-colored `*` name) in the lobby chat log via a new `appendSystemMessage()` helper. The kicked player sees it too (their `kicked` UI reset + the broadcast message).
- Protocol: new S→C `kickNotice` (`{ text }`). No new C→S messages.
- 1 new integration test (`tests/integration/afk.test.js`): remaining players receive the notice naming the kicked player. Updated existing `kicked` client test to also dispatch `kickNotice`. 421 total pass.
- Files changed: `server.js` (`broadcastKickNotice`, `checkAfkPlayers` collects names before splice), `index.html` (`kickNotice` handler, `appendSystemMessage`, `.chat-msg.system` CSS, removed local banner kick display), `docs/Architecture.md` (protocol table).

### [FEATURE] Weapon lifetime rules — infinite pistol, per-life explosive
- Symptom: pistol rounds depleted and were lost on death; explosive behavior was inconsistent with other per-life abilities.
- Fix: pistol now has infinite rounds (never depletes, persists across respawns). Explosive is single-use per life — like phase-dash, it resets on every respawn. A new pure helper `assignWeaponOnRespawn(player)` in `src/gameLogic.js` keeps a player's pistol if they have one, otherwise grants a fresh explosive. All four respawn points in `server.js` now call this helper instead of clearing `weapon`/`weaponRounds`. The client HUD no longer shows a round count for the pistol.
- 4 new tests in `tests/server/weapons.test.js` for `assignWeaponOnRespawn` + 2 updated pistol tests (infinite ammo). Removed 2 obsolete tests (round consumption, weapon-gone-at-zero). 424 total pass.
- Files changed: `src/gameLogic.js` (`firePistol` no longer consumes rounds, new `assignWeaponOnRespawn`), `server.js` (4 respawn points call helper), `index.html` (HUD text simplified), `tests/server/weapons.test.js`.

### [BUGFIX] Weapons no longer spawn outside the maze (ghost house / gates)
- Symptom: weapons could spawn on EMPTY (4) tiles — ghost house interior and tunnel areas — appearing outside the playable maze corridors.
- Fix: `spawnWeapon()` now only considers pellet paths (0) and power pellets (2, 3) as valid spawn tiles. All other tile types (walls, ghost house interior, gates) are skipped.
- 2 new tests: weapons avoid non-path tiles across 50 iterations; returns null when only non-path tiles exist. 426 total pass.
- Files changed: `src/gameLogic.js` (`spawnWeapon` tile filter), `tests/server/weapons.test.js`.

### [BUGFIX] Ghost wall-snap oscillation — ghosts no longer stick to walls
- Symptom: ghosts repeatedly got stuck at tile centers next to walls (e.g. "Ghost Blinky is stuck at (17.46, 1.50)"). When a ghost chose a direction leading to a wall, it moved into the wall, snapped back to center, but kept the same direction — so it chose the same wall-bound direction again, oscillating until the stuck-timeout rescue fired after ~3 seconds.
- Fix: Added a `lastBlockedDirection` field to each ghost, set in `server.js` when a wall collision occurs. `chooseDirection()` in `src/ghostAI.js` now excludes this direction from candidates, forcing the pick of a new direction that actually makes progress. The field is cleared after every successful direction choice.
- 3 new tests: `lastBlockedDirection` excluded from choice (chase + frightened), `createGhost` initializes it to null. 429 total pass.
- Files changed: `src/ghostAI.js` (`chooseDirection` excludes blocked dir, `lastBlockedDirection` field), `server.js` (set blocked dir on wall collision), `tests/server/ghostAI.test.js`.

### [FEATURE] AFK auto-removal — server resets idle players autonomously
- Symptom: the server required hand-holding. An AFK host blocked the lobby (nobody else could start), and an AFK player in a match prevented the game from ever ending. No mechanism existed to evict idle users.
- Fix: every lobby player and in-game player now carries a `lastActivity` timestamp, refreshed on meaningful client messages (`input`, `chat`, `toggleReady`) via a shared `touchActivity(ws)` helper. A periodic sweep (`setInterval`, every `AFK_CHECK_INTERVAL_MS` ≈ 30 s) calls a pure `findAfkPlayerIndices()` helper to locate players idle longer than `AFK_TIMEOUT_MS` (≈ 2 min) and splices them out. In the lobby, removal auto-migrates the host role to `lobbyPlayers[0]` (the client already derives host from the first slot) and cancels any running countdown; a `kicked` (S→C) message tells the evicted client to reset to the fresh join screen. In a match, removal thins the roster and ends the game if fewer than 2 players remain. A client-side `handleKicked()` resets identity/participation flags, shows the lobby-join form, surfaces the kick reason on the in-game banner, and disables chat until the player rejoins. Both timeouts are configurable via `AFK_TIMEOUT_MS` / `AFK_CHECK_INTERVAL_MS` env vars so tests can run on a fast cycle. The sweep interval is unref'd so it doesn't block process exit in tests.
- New server message: `kicked` (S→C, `{message}`). No new C→S messages — activity is inferred from existing traffic.
- Tests: 7 unit tests in `tests/server/afk.test.js` (`findAfkPlayerIndices` — fresh players untouched, within/at/ past timeout boundary, custom now/timeout, all-AFK, all-active) + 4 integration tests in `tests/integration/afk.test.js` (silent lobby player kicked, AFK host removal promotes next player, active player not removed, AFK single-player removed → match ends) + 1 client test added to `tests/client/lobbyProtocol.test.js` (`kicked` resets join state). 414 total pass.
- Files changed: `src/gameLogic.js` (`AFK_TIMEOUT_MS`, `AFK_CHECK_INTERVAL_MS`, `findAfkPlayerIndices`), `server.js` (`afkCheckInterval`, `touchActivity`, `checkAfkPlayers`, `notifyAfkKick`, `lastActivity` stamping on join/reconnect/game-start/rebuild, `kicked` integration in single-player path), `index.html` (`handleKicked`, `kicked` case, banner reason display).

### [FEATURE] Lobby spectate — see in-progress matches and watch
- Symptom: Players in the lobby had no visibility into a running match. `lobbyState` reported `currentGameState: IN_PROGRESS` but carried no detail about the match (single-player vs multiplayer, who was playing), and there was no way to watch — only dead players were promoted to spectators.
- Fix: `broadcastLobbyState()` now includes an `inProgressMatch` payload (`isSinglePlayer`, `playerCount`, `players: [{id, name}]`) whenever a match is running, and `null` in the LOBBY state. A new `spectateGame` (C→S) message lets any lobby player opt in: the server removes them from the waiting lobby, adds them to `spectators[]`, sends a voluntary `spectatorMode` ack plus an immediate `gameState` snapshot, and the 60 FPS broadcast keeps them in sync. The lobby banner shows match type + participants and a Spectate button; leaving spectating returns the player to the lobby via the existing `leaveGame` path.
- New server message: `spectateGame` (C→S, `{}`). `spectatorMode` (S→C) now carries a `voluntary` flag so the client skips the "eaten" sound for a chosen spectate.
- 5 new integration tests in `tests/integration/spectate.test.js`: in-progress single-player report, spectate receives snapshot, null in LOBBY, ongoing stream + leave, rejection when idle.
- Files changed: `server.js` (`broadcastLobbyState` enrichment, `handleSpectateGame`, `spectateGame` case), `index.html` (banner markup + CSS, banner logic in `lobbyState` handler, `voluntary` flag handling, spectate button handler).

### [BUGFIX] isGhostStuck catchall — movement-timeout for frozen ghosts
- Symptom: When a player eats a power pellet, some frightened ghosts occasionally freeze in place despite having valid exits. They stay frozen until consumed and never revert from frightened state.
- Root cause: `isGhostStuck` only checked if all 4 neighbors were walls. A ghost that stopped moving (e.g. due to an AI edge case while frightened) but had open corridors was never detected as stuck.
- Fix: Added a movement-timeout detection mode to `isGhostStuck`. A new `stuckTicks` counter on each ghost is maintained by the server: incremented when the ghost's position doesn't change between ticks, reset when it does. When `stuckTicks >= STUCK_TICK_THRESHOLD` (180 ticks ≈ 3 seconds at 60 FPS), `isGhostStuck` returns true and the ghost is sent back to the house as if eaten. This is a catchall safety net — the wall-surround check remains the primary detection.
- New constant: `STUCK_TICK_THRESHOLD = 180` exported from `src/ghostAI.js`.
- 5 new unit tests in `tests/server/ghostAI.test.js`: timeout triggers despite open neighbors, below-threshold returns false, exact-threshold boundary, missing `stuckTicks` defaults to 0, threshold value verification.
- Files changed: `src/ghostAI.js` (constant, `stuckTicks` init, `isGhostStuck` timeout check), `server.js` (position-change tracking + reset on rescue).

### [BUGFIX] Player stuck after level 2 start — isWall used wrong maze (B-010)
- Symptom: After clearing level 1 and starting level 2, player could only move on tiles where pellets were eaten. Could not move on tiles that still had pellets. Player appeared stuck with pellets on both sides.
- Root cause: `isWall(nextX, player.y)` was called without the `maze` argument on lines 436-437 of `server.js`. The `isWall` function has a default parameter `maze = MAZE` (the static maze), so on level 2+ (where `currentMaze` is procedurally generated), wall checks used the wrong grid.
- Fix: Added `currentMaze` as the third argument to both `isWall` calls in the player movement block.
- 5 new regression tests in `tests/server/level2Stuck.test.js`.

### [FEATURE] Weapon powerups — pistol + explosive (PvP resolution)
- Symptom: PvP deadlock when powerups exhausted — players can't eliminate each other.
- Solution: New weapon powerups that spawn when all power pellets are eaten.
- Pistol: Single-shot projectile (speed 0.25 tiles/tick, range 8 tiles). Hits first player/ghost in path. Consumed on fire.
- Explosive: Detonates at player position. Blast radius 2.5 tiles damages players/ghosts. Pellet clearing radius 3.5 tiles.
- Spawning: When `pellets.length === 0 && powerPellets.length === 0`, spawns up to 2 weapons on board. 3-second cooldown between spawns. 50/50 pistol/explosive split.
- Controls: Spacebar to fire (keyboard), or can be mapped to gamepad/touch.
- Audio: New sounds — weapon pickup (metallic clang), pistol fire (pop + noise), explosion (low boom + noise decay).
- Works in single-player (vs ghosts) and multiplayer (vs players + ghosts).
- 41 new unit tests in `tests/server/weapons.test.js`.
- Files changed: `src/gameLogic.js` (weapon constants + 7 functions), `src/audio.js` (3 new sounds), `server.js` (integration), `index.html` (rendering + input).

### [FEATURE] Weapon rendering — clearer pistol + explosive icons
- Symptom: pistol icon was too small to read; explosive was just a red circle with a stripe — neither looked like a recognizable weapon.
- Fix: Redrew both pickup icons in Canvas 2D. Pistol now a larger gun shape (barrel + tip + handle with grip lines + trigger guard + highlight). Explosive now a red dynamite stick with gold warning band, curved fuse, and glowing spark. Both cast a grounding shadow on their tile so they read as placed objects.
- Updated `docs/Architecture.md` with a Weapons subsection (spawning, behavior, rendering) and corrected the `gameState` protocol payload to include `weapons`, `projectiles`, and `level`.
- Files changed: `index.html` (rendering), `docs/Architecture.md`.

### [BUGFIX] Player gets stuck at level 2 start — dead-end starting position (B-009)
- Symptom: Player clears level 1, level 2 starts, eats about 5 pellets, then gets stuck.
- Root cause: The procedurally generated maze (`mazeGenerator.js`) ensures starting tiles are walkable but does NOT ensure they have ≥2 open neighbors. Tile (1,1) is often a dead end (only 1 open neighbor: down). The player starts at (1.5, 1.5), eats the power pellet, then moves down eating 4 more pellets at (1,2), (1,3), (1,4), (1,5) before hitting a wall at tile (1,6) with no alternative exit.
- Fix: Added dead-end detection in step 8 of maze generation. If a start tile has <2 open neighbors, carve a path to a wall neighbor to create an exit. Verified 600/600 start positions across 100 seeds now have ≥2 open neighbors.

### [BUGFIX] Ghosts freeze when hitting a wall (B-008)
- Symptom: When a power-up is active, some active ghosts are frozen (not moving). They should be avoiding (frightened/scared). Also affects non-frightened ghosts that hit walls.
- Root cause: Server's wall collision logic snapped ghosts to the tile **edge** (`Math.floor(x) + 0.99` / `+ 0.01`) instead of the tile **center**. A ghost at `x ≈ 4.99` is not within `isAtTileCenter`'s epsilon (0.04) of any center, so it never picks a new direction — infinite loop of hitting the wall every tick. Frightened ghosts are more likely to trigger this because they run toward walls while fleeing the player.
- Fix: Snap to tile center (`snapToTileCenter`) on wall collision instead of tile edge. This allows the ghost to pick a new direction on the next tick.
- Added 3 simulation tests in `tests/server/ghostAI.test.js`:
  - `BUG DEMO: old code snaps ghost to tile edge, freezing it` — documents the buggy behavior (ghost stuck at `x ≈ 4.99` for 10+ ticks)
  - `FIX VERIFIED: new code snaps ghost to tile center, allowing recovery` — verifies the fix (ghost continues moving)
  - `frightened ghost with fix can recover from wall collision` — verifies frightened ghosts recover
- Verification: 326 tests pass, lint clean (0 errors/warnings), coverage thresholds met.

### [BUGFIX] Dash mechanic — changed from speed boost to phase dash (teleport)
- Symptom: The dash function was not working as expected. The reference implementation (`pacclone/index.html`) uses a **phase dash** (teleport forward 3 tiles, once per life), but our implementation used a **speed boost** (1.8x speed on cooldown). These are fundamentally different mechanics.
- Root cause: The original implementation was based on a different game design than the reference. The reference uses:
  - `DASH_TILES = 3` — teleport distance
  - `DASH_DURATION = 200ms` — visual effect duration (invulnerability window)
  - `phaseDashAvailable` — boolean, once per life (reset on respawn)
  - Instant teleport, not gradual speed increase
  - Invulnerable during the effect (can't eat pellets or be caught by ghosts)
- Fix:
  - Replaced `DASH_SPEED_MULTIPLIER`, `DASH_DURATION_TICKS`, `DASH_COOLDOWN_TICKS` constants with `DASH_TILES = 3` and `DASH_DURATION_TICKS = 12` (~200ms at 60 FPS).
  - Rewrote `updateDashState()` to only tick down the visual-effect timer (no more speed/cooldown cycle).
  - Added `executePhaseDash(player, maze, mazeWidth, mazeHeight)` — pure function that validates and executes the teleport.
  - Added `checkPlayerPellets()` helper — shared pellet-collision logic for both normal movement and post-dash arrival.
  - Updated player creation to use `dashAvailable: true` and `lastDirection: null` instead of `dashActiveTicks`/`dashCooldownTicks`.
  - Updated respawn logic to reset `dashAvailable = true` (once per life).
  - Added invulnerability during dash: ghost and player collisions skip dashing players.
  - Client: updated dash UI to show "Dash: Ready" / "Dash: Used" / "PHASE DASH!" instead of cooldown timer.
  - Client: added semi-transparent (globalAlpha 0.5) + cyan glow effect during dash visual effect.
  - Rewrote `tests/server/dash.test.js` with 13 new tests covering teleport distances, direction handling, wall blocking, tunnel wrapping, and state transitions.
- Verification: 323 tests pass, lint clean (0 errors/warnings), coverage thresholds met.

### [REFACTOR] Remove unnecessary duplication, redundant & orphan code
- Symptom: The codebase had accumulated duplicate functions/constants across modules, orphan exports never used outside tests, and dead code superseded by newer implementations.
- Root cause: Incremental feature additions without consolidation; test-only exports left in place after their production callers were removed.
- Fix:
  - **Duplicate `isWall`**: Removed the local definition in `server.js` (identical to `src/gameLogic.js`); now imports the canonical version.
  - **Duplicate `GHOST_EAT_SCORE`**: Defined in both `gameLogic.js` and `ghostAI.js`. Removed from `gameLogic.js`; `ghostAI.js` is the canonical source (already imported by `server.js`).
  - **Duplicate pellet extraction**: Replaced the inline maze-scan loop in `server.js#initializeGameState()` with a call to the existing pure `extractPellets(currentMaze)` from `gameLogic.js`.
  - **Duplicate `startingPositions` arrays**: Extracted a `getStartingPositions()` helper in `server.js` and replaced two identical 4-element hardcoded arrays (in `startGame` and `startNextLevel`).
  - **Hardcoded score values**: Replaced magic numbers (`10`, `50`, `100`) in `server.js` with the canonical `PELLET_SCORE`, `POWER_PELLET_SCORE`, `PLAYER_EAT_SCORE` constants from `gameLogic.js`.
  - **Dead code removed**: `checkGameOver` (superseded by `getLevelTransition`), `createInitialState` (unused state builder), `randomDirection` (no production caller), `moveEntity` (no production caller), `distance`/`isColliding` (only used by removed code), `isValidDirection` (no caller), `playMove` (audio function never called), `GHOST_SPAWN`/`POWER_UP_DURATION_MS`/`DIRECTIONS` constants (unused after cleanup).
  - **Orphan exports removed**: From `gameLogic.js` — `GHOST_EAT_SCORE`, `GHOST_SPAWN`, `POWER_UP_DURATION_MS`, `DIRECTIONS`, `getRespawnCorners`, `moveEntity`, `distance`, `isColliding`, `isValidDirection`, `createInitialState`, `checkGameOver`, `randomDirection`. From `ghostAI.js` — `GHOST_PERSONALITIES`, `GHOST_NAMES`, `SCATTER_CORNERS`, `MODE_CYCLE`, `RELEASE_THRESHOLDS`, `FRIGHTENED_DURATION_MS`, `GHOST_RETURN_DELAY_MS`, `DIRECTION_NAMES`. From `audio.js` — `playMove`.
  - Updated test files to remove tests for deleted functions and define any still-needed constants locally (e.g. `MODE_CYCLE` in `ghostAI.test.js`).
- Verification: 317 tests pass, lint clean (0 errors, 0 warnings), coverage thresholds met (≥80% lines, ≥70% branches).
- Test count change: 349 → 317 (32 tests removed along with their deleted functions).

## 2026-08-09

### [BUGFIX] B-007 — power pellet doesn't scare all ghosts
- Symptom: Eating a power pellet turns most ghosts blue, but ghosts still in the house (and those mid-exit) never show the scared state. A secondary issue: exitingHouse ghosts that did get frightened were never reverted when the timer expired.
- Root cause: The power-pellet code in server.js skipped `inHouse` ghosts (`if (ghost.state !== 'eaten' && ghost.state !== 'inHouse')`). The timer reversion only checked `ghost.state === 'frightened'`, so `exitingHouse` ghosts with `frightened=true` were never cleaned up.
- Fix: Extracted two pure helpers in `src/gameLogic.js` — `frightenGhosts` (frightens ALL non-eaten ghosts; house ghosts keep their state but turn blue) and `revertFrightenedGhosts` (reverts based on the `frightened` flag, preserving house-ghost state). Wired both into server.js, replacing the inline logic.
- Added 12 unit tests in `tests/server/frightenGhosts.test.js` covering active, inHouse, exitingHouse, eaten, mixed groups, and round-trip.
- Verification: 349 tests pass, lint clean.

### [BUGFIX] B-006 — tunnel teleport blocked for players (works for ghosts)
- Symptom: The horizontal tunnel teleport doesn't work for players — they get blocked at the tunnel edge and can't wrap around the maze. Ghosts traverse the tunnel fine. Reported while testing single-player but affects multiplayer too (shared player movement code).
- Root cause: `clampSpriteToWall` in `src/gameLogic.js` treats out-of-bounds tiles as walls. On a tunnel row, when the player's left edge goes below x=0, the clamp pins the player at x≈0.45 (clamp formula: `leftTile + 1 + radius` where leftTile=-1), preventing them from ever reaching x=0 to trigger `wrapTunnelX`. Ghosts don't use the clamp, so their tunnel works.
- Fix: Added tunnel-row detection in `clampSpriteToWall` — on tunnel rows (leftmost tile is type 4), skip the horizontal clamp when the edge tile is out of bounds. The player can now reach x=0 and wrap to the other side.
- Added 4 unit tests in `tests/server/clampSpriteToWall.test.js` covering left edge, right edge, wall-clamping still works on tunnel rows, and the x=0 trigger point.
- Verification: 337 tests pass, lint clean.

### [FEATURE] Single-player mode
- Symptom: The game was multiplayer-only. A lone player could not play alone — the win condition (last man standing) ended the match immediately with 1 player remaining, and the lobby required ready-up + host start.
- Fix (server): Added `isSinglePlayerMatch` flag and `singlePlayerInfo` (token + name captured at start). New `startSinglePlayer(ws)` function bypasses ready-up and countdown: removes the requesting player from the lobby, starts a fresh match with just them, links their socket, and broadcasts the updated lobby. Extended the pure `getLevelTransition(players, pellets, powerPellets, isSinglePlayer=false)` function — in single-player the match ends only when the player loses all lives (`players.length === 0`), not when one remains; clearing all pellets still advances the level. Player death in single-player skips spectator mode (nothing to spectate) and just clears `playerId`. `endMatch` rebuilds the lobby from `singlePlayerInfo` so the solo player returns to the lobby after the match. Wired a `startSinglePlayer` message handler.
- Fix (client): Added a "Single Player" button (cyan, full-width) between high scores and Start Game that sets `isSinglePlayer = true` and sends `startSinglePlayer`. Added an `amInGame` flag (set on `playerAssigned`, cleared on return-to-lobby) so that non-participating lobby players stay in the lobby UI while someone else plays single-player — visibility now gates on `amInGame || isSpectating` instead of the global game state. The game-over screen shows "Game Over!" + final score for solo play (no "Winner:"). The `gameState` handler ignores state for non-participants.
- Added 6 unit tests in `tests/server/getLevelTransition.test.js`, 3 integration tests in `tests/integration/singlePlayer.test.js`, and 2 client tests in `tests/client/singlePlayer.test.js`.
- Verification: 333 tests pass, lint clean.

### [FEATURE] About modal for Pacclone Multi
- Symptom: No way for players to see what the app is, how to play, or what tech it uses without reading the source.
- Fix: Added an About modal to `index.html` adapted to vanilla JS (no React/Vite) matching the existing dark/neon arcade aesthetic. Header with app name, version badge, and close button; scrollable body rendering sections (description, features, controls table, tech stack table, license); footer with build info + close button. Opens from a new "About" button in the lobby footer. Closes via X button, footer Close, backdrop click, or Escape key. All event listeners null-guarded so the test environment (minimal DOM) doesn't crash.
- Added 8 client tests in `tests/client/aboutModal.test.js`.
- Verification: 322 tests pass, lint clean.

### [REFACTOR] Lobby UI — two-column layout to eliminate scrollbars
- Symptom: The lobby rendered all sections (title, name row, players, high scores, buttons, footer) in a single vertical column. With up to 10 high scores the total height exceeded the viewport, forcing a scrollbar that pushed the Single Player / Start Game buttons out of view.
- Fix: Reorganized the lobby into a two-column flex layout. Left column (58%) holds the player list + action buttons; right column (42%) holds the high scores. The two lists sit side-by-side so height is shared rather than summed. Capped lobby high-score display at 6 entries (`renderHighScores` slices to `LOBBY_MAX_SCORES`) for a predictable, compact column. Tightened score-entry padding (5px), player-slot padding (7px), subtitle/button spacing, and widened the lobby (`min(720px, 94vw)`, `max-height: 96vh`) to fit comfortably without scrolling.
- Verification: 349 tests pass, lint clean.

### [FEATURE] Lobby overhaul — warm rejoin, ready-up, countdown, reconnection grace (A–E)
- Symptom: The lobby was a cold start every match (group dissolved on game over), there was no ready-up, no start countdown, and a disconnected player lost their slot permanently.
- Fix (server): Introduced a stable `playerToken` (uuid) as player identity — decouples identity from the ephemeral WebSocket connection id so reconnects reclaim the slot. New protocol messages: `lobbyJoined` (echoes token), `toggleReady`, and enriched `lobbyState` (carries `ready` per player + `countdown` tick). New `COUNTDOWN` game state with a 3-2-1-GO before match start. Pure helpers in `src/gameLogic.js`: `rebuildLobbyFromMatch`, `areAllReady`, `togglePlayerReady`, `getCountdownTick`, `isWithinGracePeriod`, plus `COUNTDOWN_DURATION_MS`/`RECONNECT_GRACE_MS` constants.
  - **A. Warm rejoin**: `endMatch()` rebuilds `lobbyPlayers` from the finished match (winner first = new host) instead of resetting to an empty lobby. Tokens preserved so returning clients recognize their slot.
  - **B. Play Again**: natural result of A+C+D — the group stays together, readies up, host starts.
  - **C. Ready-up**: `toggleReady` toggles a player's ready flag; host's Start enables only when all ready (server-authoritative gate). `areAllReady`/`togglePlayerReady` are pure and tested.
  - **D. Countdown**: `beginCountdown()` broadcasts ticks 3→2→1 then calls `startGame()`. `getCountdownTick` maps elapsed ms to the display number.
  - **E. Reconnection grace**: on disconnect mid-match, the player is marked `disconnected` (not removed) and a 15s grace timer starts. Re-presenting the token within the window restores the slot (`isWithinGracePeriod`). Grace expiry removes the player. `cancelPendingLobbyReset()` prevents stale reset timers from disrupting new matches.
- Fix (client): stores the token in localStorage and re-sends it on reconnect; added a Ready toggle button with active state; Start button gated on host + all-ready; countdown overlay (3/2/1/GO with pop animation) shown during COUNTDOWN; lobby identity matched on token (not connection id).
- Added 25 unit tests in `tests/server/lobbyHelpers.test.js`, 6 client protocol tests in `tests/client/lobbyProtocol.test.js`, and 1 grace-period integration test in `tests/integration/rejoin.test.js`. Updated existing integration tests for the new ready-up + countdown flow.
- Verification: 314 tests pass, lint clean.

### [FEATURE] Return to lobby — players can leave a game mid-match
- Symptom: Once in a game, a player had no way to return to the lobby (no manual quit). A player out of lives was forced to spectate until the match ended; a player who wanted to quit had no option.
- Fix: Added a `leaveGame` WebSocket message (client → server) and a `returnToLobby` response (server → client). Server handler `handleLeaveGame(ws)`: removes the player from `players[]` (or `spectators[]` if spectating), clears `ws.playerId`, re-adds the connection to `lobbyPlayers` (preserving their name via `ws.playerName`), and sends `returnToLobby` to the leaving client. If the game is in progress and the leave drops the player count below 2, `endMatch` fires for the last player. Client: added `handleReturnToLobby()` (resets UI/state, re-renders lobby), `leaveGame()` (sends the message), Escape key binding, and a visible "Leave Game" button (top-right overlay, shown during gameplay/spectating, hidden in lobby). New `renderLobbyPlayers()` shared helper used by both `lobbyState` and `returnToLobby` handlers.
- Added 3 integration tests in `tests/integration/leaveGame.test.js`: active player leaves mid-game, spectator/player leaves, leaving player waits for game-over cycle then rejoins and starts a fresh match.
- Verification: 282 tests pass, lint clean.

### [BUGFIX] B-005 — player sprite half-inside wall at corridor ends; ghosts can't collide there
- Symptom: When a player reaches the end of a corridor and stops, the sprite is drawn half inside the wall tile. Ghosts approaching down the corridor can't collide with a player in this position.
- Root cause: The movement wall-check only gates the sprite *center* (`isWall(nextX, player.y)`), but the player radius (`TILE_SIZE/2 - 2` ≈ 0.45 tiles) means the body extends ~0.4 tiles past the center into the wall. The raw center could sit at e.g. x=18.95 with the wall at column 19, so the sprite's right edge reached x=19.40 — deep inside the wall. A ghost at x=18.0 was 0.95 tiles from the player center, well above the 0.5 collision threshold, so the ghost could never reach the pinned player.
- Fix: Added pure `clampSpriteToWall(x, y, radius, maze)` to `src/gameLogic.js` — checks the tile under each sprite edge and pushes the center back until the edge sits flush against the wall boundary. Wired into `server.js` player movement (runs after the axis-separated wall check). Keeping the sprite fully inside the corridor also guarantees a ghost approaching down the hall can get within the 0.5 collision distance.
- Added 11 unit tests in `tests/server/clampSpriteToWall.test.js`: open-space no-op, horizontal/vertical clamping, collision-reachability before/after, idempotency, smaller-radius (ghost) clamping.
- Verification: 282 tests pass, lint clean.

### [BUGFIX] B-004 — no tunnel teleport (player/ghosts can't traverse horizontally)
- Symptom: The maze tunnel doesn't work — neither players nor ghosts can traverse horizontally to the other side.
- Root cause: (1) The tunnel entrance was walled off: row 8/12 col 4 and col 15 were walls (type 1), blocking access from the interior corridor (col 5) into the tunnel (cols 0-3). (2) Players had no tunnel wrapping code — only ghosts did (inline in server.js).
- Fix: (1) Opened tunnel entrances by changing col 4/col 15 on tunnel rows to type 4 (walkable tunnel). (2) Added pure `wrapTunnelX(x, y, maze)` to `src/gameLogic.js` — wraps x to the opposite edge on tunnel rows (identified by leftmost tile being type 4). Wired into `moveEntity` (wrap BEFORE wall check so the out-of-bounds guard doesn't block the entrance) and server.js player movement. Replaced the ghost's inline wrap with the shared function. (3) Client: added `tunnelOffsets()` helper that draws a faded (globalAlpha 0.4) ghost copy of players/ghosts on the opposite edge when within 0.5 tiles of a tunnel edge, so sprites slide through smoothly instead of popping.
- Added 14 unit tests in `tests/server/wrapTunnelX.test.js`: wrap math (left/right, in-bounds, boundary), tunnel reachability in the default maze, and full left-to-right and right-to-left traversal via `moveEntity`.
- Verification: 268 tests pass, lint clean.

### [REFACTOR] Audio module — shared note-sequence helper
- The 5 multi-note sounds (playGameOver, playCelebrate, playExtraLife, playHighScore, playStart) each had a near-identical ~30-line note-scheduling loop (~150 lines of duplication). Extracted a shared `playNoteSequence(notes, options)` helper that handles both simple frequency arrays and `{freq, dur}` melodies with rests (freq 0 = skip). The 5 functions are now one-liners.
- Confirmed mute toggle already covers ALL sounds: every play* function starts with `if (isMuted) return;` and every client sound call routes through AudioFX. No mute gaps.
- All 15 audio tests still pass — exact oscillator counts preserved (game-over: 5, celebrate: 4, extraLife: 4, highScore: 7, start: 13 with 3 rests).

### [BUGFIX] B-002 — player sprite drifts off pellet line after multiple turns
- Symptom: After navigating the maze for ~4 turns, the player sprite visibly drifts off the pellet line — it appears to miss pellets or cross wall boundaries.
- Root cause: The server let players turn at any coordinate, not just tile centers (half-tiles). When turning at e.g. x=1.8 while moving right, the perpendicular axis stayed at 1.8 instead of snapping to the corridor center (x=1.5). The player then travelled up along x=1.8 — 0.3 tiles (12px) off the pellet line. After several turns the offset compounds into visible drift.
- Fix: Added `snapPerpendicular(x, y, direction)` to `src/gameLogic.js` — snaps the perpendicular axis to the nearest half-tile on every direction change. Vertical movement snaps X; horizontal movement snaps Y. Wired into the `server.js` input handler so it fires only when the direction actually changes.
- Client: Added a 'P'-toggle debug overlay. Shows each player's tile position, corridor center, and drift (green <0.05, yellow <0.15, red otherwise). Draws a dashed corridor-center line and a crosshair at the actual sprite center — the gap between them makes any drift immediately visible.
- Added 16 unit tests in `tests/server/snapPerpendicular.test.js` covering snap-up, snap-down, no-op when already centered, boundary coords, and a 4-turn drift-prevention scenario.
- Verification: 254 tests pass, lint clean, 96.62% line / 88% branch coverage.

### [BUGFIX] B-003 — player/ghost alignment, mobile overflow, player speed
- Symptom: Player sprite misaligned with pellets; maze overflows phone screens; player speed feels slow vs the single-player reference.
- Root cause: (1) Player radius was `TILE_SIZE/2.5` (16px) — too small to fill the corridor. (2) Canvas was fixed at 800x520 with no responsive CSS. (3) `PLAYER_SPEED` was 0.075 (4.5 tiles/s) vs the reference's 5 tiles/s.
- Fix: (1) Changed player radius to `TILE_SIZE/2 - 2` (18px) matching the reference proportion. (2) Added responsive canvas CSS (`width: 100%`, `max-width: 800px`, `aspect-ratio: 800/520`, `touch-action: none`). (3) Bumped `PLAYER_SPEED` from 0.075 to 0.1 (6 tiles/s).
- Verification: 238 tests pass, lint clean, coverage thresholds met.

## 2026-08-08

### [INFRA] Development environment setup & game logic extraction
- Rewrote `Agents.md` to accurately reflect the vanilla JS Pac-Man project (previously described a React/TypeScript spreadsheet app).
- Set up Jest testing framework with `jest-environment-jsdom` for client tests.
- Extracted pure game logic from `server.js` into `src/gameLogic.js`: maze definition, `isWall()`, `moveEntity()`, `distance()`, `isColliding()`, `extractPellets()`, `createInitialState()`, `createPlayersFromLobby()`, `randomDirection()`, `checkGameOver()`, `isValidDirection()`.
- Added 47 unit tests in `tests/server/gameLogic.test.js` — all passing, 100% coverage on `src/gameLogic.js`.
- Added ESLint configuration (`eslint.config.js`) — clean lint, 0 errors.
- Added `Dockerfile` and `.dockerignore` for containerized deployment.
- Added `.github/workflows/ci.yml` for CI (lint + test on Node 18/20/22, Docker build on main).
- Updated `.gitignore` with `coverage/`, `.env`, `.eslintcache`.
- Updated `package.json` with scripts: `start`, `dev`, `test`, `test:watch`, `lint`, `lint:fix`, `verify`.
- Added dev dependencies: `jest@30`, `eslint@9`, `nodemon@3`, `jest-environment-jsdom@30`.
- Remote: `github.com/Code24x7-R/pacclone-multi`, branch `main`.

### [BUGFIX] B-001 — blank screen on game start + missing host UI + favicon 404
- Root cause: `server.js` `gameLoop` broadcast payload `{ maze, players, ghosts, pellets, powerPellets }` omitted `currentGameState`. Client read `undefined` → never entered render branch → blank screen. Only the game-over broadcast included the field.
- Extracted `buildGameStatePayload()` into `src/gameLogic.js` as the single source of truth for the wire format; both broadcast sites in `server.js` now use it so `currentGameState` is always present.
- Removed duplicate local `GAME_STATES` const in `server.js` (now imported from `gameLogic.js`) to avoid redeclaration.
- Added lobby host-status UI: host sees "You are the host — press Start Game when ready", others see "Host: \<name> — waiting for them to start". Non-hosts' Start button stays disabled.
- Added inline SVG ghost favicon to `index.html` to prevent `/favicon.ico` 404.
- Added 5 regression tests in `tests/server/buildGameStatePayload.test.js`.
- Verification: 52 tests pass, 100% coverage, lint clean, server starts on :8080.

### [BUGFIX] Circular JSON crash when broadcasting game state with power-up active
- Root cause: `setTimeout` returned a `Timeout` object stored on `player.powerTimeout`; `player` was serialized into the gameState broadcast, and `Timeout` objects have circular `_idlePrev`/`_idleNext` references → `JSON.stringify` threw.
- Replaced `setTimeout` with a tick-based countdown (`player.powerUpTicks`) decremented in the game loop — avoids non-serializable objects and prevents timer drift.
- Added regression tests proving the payload is JSON-safe and documenting the original failure class.
- Committed as af84726.

### [FEATURE] Phase 1 — Ghost AI port from single-player pacclone
- Ported 4 classic ghost personalities: Blinky (chase), Pinky (ambush +4 tiles), Inky (flank via Blinky vector), Clyde (shy: chase if far, scatter if close).
- Ghost state machine: `inHouse` → `exitingHouse` → `scatter`/`chase` → `frightened` → `eaten` → `inHouse` with house bobbing, gate release thresholds (blinky=0, pinky=15, inky=30, clyde=50), and scatter/chase mode cycling.
- New `src/ghostAI.js` (28 pure functions) + `tests/server/ghostAI.test.js` (67 tests).
- New maze in `src/gameLogic.js`: ghost house with gate (type 6), tunnels (type 4), corner power pellets (type 2/3).
- Server: AI-driven ghost movement replaces random walk; power pellet frightens all active ghosts; eaten ghosts return to house and re-release.
- 120 total tests pass, lint clean, 97.97% line / 88.55% branch coverage.

### [FEATURE] Phase 2 — Frightened state visuals (blue body, white flash, eaten eyes)
- Ghost rendering rewritten: proper ghost shape (dome + body + skirt scallops) replaces plain circles.
- Three visual states: normal (personality color), frightened (blue + white flash in last 1/3 of power-up), eaten (eyes only with direction-tracking pupils).
- Server computes per-ghost `flashing` flag via new `shouldGhostFlash()` pure function (8000ms duration → flash below 2667ms, toggle every 100ms).
- Extracted drawing to `src/ghostRenderer.js` (UMD module: `window.GhostRenderer` in browser, `module.exports` for Jest).
- Client rewired to `GhostRenderer.drawGhost()`; ghost-eaten sound now detects `eaten` state transitions (eaten ghosts stay in list).
- 13 new client rendering tests with mock Canvas2D context; 135 total tests pass, lint clean.

### [FEATURE] Phase 3 — Procedural maze generation + level progression
- New `src/mazeGenerator.js`: symmetric recursive-backtracking maze generation with ghost house (gate), tunnels, corner power pellets, guaranteed connectivity, and forced-walkable player spawns. 19 unit tests.
- New `src/difficulty.js`: pure per-level scaling — ghost speed +10%/level (capped 2x), frightened duration -500ms/level (floored 3s). 12 unit tests.
- New `src/gameLogic.js#getLevelTransition`: pure win-condition decision (last man standing → GAME_OVER, all pellets eaten → LEVEL_COMPLETE). 8 unit tests.
- Server: `currentMaze`/`currentLevel` state, `startNextLevel()` generates fresh maze + scales difficulty, `endMatch()` resets to lobby. `LEVEL_COMPLETE` drives a 3s transition.
- Client: displays current level (top-right), shows "Level Complete" overlay between levels.
- `buildGameStatePayload` now includes `level`; ghost flash timing scales with level-adjusted frightened duration.
- 176 total tests pass, lint clean, new modules at 100% coverage.

### [FEATURE] Phase 4 — Polish: extra lives, dash, high scores
- Extra lives: new `extraLivesEarned(score, threshold)` pure function — one life per 10,000 pts. Server tracks `extraLivesAwarded` per player, awards on threshold crossing. 7 tests.
- Dash: new `updateDashState()` and `dashSpeedMultiplier()` pure functions — 15-tick burst at 1.8× speed, 180-tick cooldown. Server applies to movement, resets on respawn. Client triggers via Shift (keyboard), R1 (gamepad), double-tap (touch). 9 tests.
- High scores: new `src/highScores.js` UMD module with load/save/insert/escapeHtml. Persisted in localStorage, displayed in lobby, recorded on game over. 16 tests.
- Fixed: server input handler no longer clears direction on dash-only inputs; player name included in game state for high score attribution.
- 208 total tests pass, lint clean.

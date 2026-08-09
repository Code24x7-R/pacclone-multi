# PROGRESS_LOG.md — Change Log

<!-- Prefix each entry with [FEATURE], [BUGFIX], [REFACTOR], [INFRA], or [DOCS] -->

## 2026-08-09

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

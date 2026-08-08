# PROGRESS_LOG.md — Change Log

<!-- Prefix each entry with [FEATURE], [BUGFIX], [REFACTOR], [INFRA], or [DOCS] -->

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

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

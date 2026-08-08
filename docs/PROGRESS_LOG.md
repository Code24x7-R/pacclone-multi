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

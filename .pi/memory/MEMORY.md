# pacclone-multi — Project Memory

Vanilla HTML/CSS/JS Pac-Man multiplayer clone — Node.js (Express + ws) authoritative server + Canvas client. No build step, no React, no TypeScript.

---

## Phase 1: Dev Environment Setup — COMPLETE ✅

**2026-08-08** — Rewrote AGENTS.md (was describing a different project), set up Jest testing, extracted pure game logic, added CI/CD.

### Key Decisions
- **Extracted pure game logic** from monolithic `server.js` into `src/gameLogic.js` — all functions are deterministic and side-effect free for unit testing
- **Jest 30** with `jest-environment-jsdom` for client tests; `collectCoverageFrom` targets `src/**/*.js`
- **Coverage thresholds**: ≥ 80% lines, ≥ 70% branches (currently 100% on gameLogic.js)
- **ESLint 9** flat config — 0 errors, clean lint
- **Dockerfile** uses `node:18-alpine`, `npm ci --production`
- **CI**: GitHub Actions — lint + test on Node 18/20/22, Docker build on main

### Project State
- 47 unit tests passing in `tests/server/gameLogic.test.js`
- Server starts correctly (`[SERVER] Listening on http://localhost:8080`)
- Remote: `github.com/Code24x7-R/pacclone-multi`, branch `main`
- Node v24.14.1, npm 11.13.0

### Architecture
- `server.js` — Express + WebSocket, 60 FPS game loop, collision, state machine (LOBBY/IN_PROGRESS/GAME_OVER)
- `index.html` — Canvas 2D client, keyboard/gamepad/touch input, Web Audio oscillator SFX
- `src/gameLogic.js` — pure functions: maze, isWall, moveEntity, distance, isColliding, extractPellets, createInitialState, createPlayersFromLobby, randomDirection, checkGameOver, isValidDirection
- Dependencies: express 5.1.0, ws 8.18.3, uuid 9.0.1
- Dev deps: jest 30, eslint 9, nodemon 3, jest-environment-jsdom 30

### Placeholder files (unused, safe to ignore)
- `index.tsx`, `tsconfig.json`, `vite.config.ts` — empty templates from Firebase Studio, not used

---

## Session: 2026-08-08

### Decisions
- Discovered AGENTS.md was entirely wrong — described a React/TypeScript spreadsheet app (simplesheets), but project is a vanilla JS Pac-Man multiplayer clone
- Rewrote AGENTS.md from scratch to match actual project
- Extracted pure game logic from monolithic `server.js` into `src/gameLogic.js` for testability
- Set up Jest 30 + ESLint 9 + GitHub Actions CI + Dockerfile for complete dev/test/deploy pipeline

### Implementation
- Created `src/gameLogic.js` with 18 exported pure functions/constants (100% test coverage)
- Created `tests/server/gameLogic.test.js` — 47 tests, all passing
- Added `eslint.config.js`, `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`
- Updated `package.json` with scripts (start, dev, test, lint, verify) and dev dependencies
- Updated `.gitignore` with coverage/, .env, .eslintcache
- Populated `docs/PLAN.md`, `docs/BUGS.md`, `docs/PROGRESS_LOG.md` with project-appropriate content
- Added Development section to README.md with commands, structure, testing, deployment

### Verification
- `npm run lint` → 0 errors, 0 warnings (clean)
- `npm test` → 47 tests pass, 100% coverage on src/gameLogic.js
- `node server.js` → starts correctly on port 8080
- `node -e "require('./src/gameLogic')"` → module loads OK

### Lessons Learned
- The project had empty placeholder files (tsconfig.json, vite.config.ts, index.tsx) from a Firebase Studio template — these are unused and should be ignored or cleaned up
- The original AGENTS.md was copy-pasted from a completely different project (simplesheets) — always verify project context against actual source code

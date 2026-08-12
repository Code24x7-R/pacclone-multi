# PLAN.md — Feature Roadmap

## Active Tasks

### Mobile Support & Performance (iOS / Android)

| # | Task | Status | Priority | Target File(s) |
| :--- | :--- | :--- | :--- | :--- |
| M1 | Responsive lobby layout (`@media` single-column) | ✅ Done | High | `index.html` |
| M2 | Game-over overlay frame-cache (offscreen canvas) | ✅ Done | Medium | `index.html`, `src/renderCache.js` |
| M3 | Viewport + safe-area + touch-action polish | ✅ Done | Medium | `index.html` |
| M4 | Fire button for touch | ✅ Done | High | `index.html` |
| M5 | Joystick refactor: adaptive size + extract `joystickDirection` | ✅ Done | High | `index.html`, `src/touchControls.js` |
| M6 | Static-layer offscreen caching (maze + pellets) | ✅ Done | Medium | `index.html`, `src/renderCache.js` |
| M7 | HUD font scaling to display width | ✅ Done | Medium | `index.html` |

### Server Leaderboard & Moderator Role

| # | Task | Status | Priority | Target File(s) |
| :--- | :--- | :--- | :--- | :--- |
| L1 | Create `src/leaderboard.js` module (pure: insert/sort/cap/sanitize/reset) + unit tests | ✅ Done | High | `src/leaderboard.js`, `tests/server/leaderboard.test.js` |
| L2 | Server: load/persist leaderboard, record scores at game over, `getLeaderboard`/`resetLeaderboard` messages, broadcast | ✅ Done | High | `server.js`, `tests/integration/leaderboard.test.js` |
| L3 | Moderator role: first-joiner assignment, transfer on leave, persist by token; chat command `/resetleaderboard` | ✅ Done | High | `server.js`, `tests/integration/moderator.test.js` |
| L4 | Client: request/render server leaderboard, drop localStorage recording, moderator reset button + role badge, overlay from server data | ✅ Done | High | `index.html`, `tests/client/lobbyProtocol.test.js` |
| L5 | Persistence dir + `.gitignore` + `docs/Architecture.md` protocol table | ✅ Done | Medium | `.gitignore`, `docs/Architecture.md` |

### Other Active

| # | Task | Status | Priority | Target File(s) |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Add integration tests for WebSocket message handling | ⏳ Pending | Medium | `tests/integration/` |

## Completed (Refactoring)

| # | Task | Status | Notes |
| :--- | :--- | :--- | :--- |
| 2 | Extract remaining game logic from server.js into testable modules | ✅ Done | `extractPellets`, `isWall`, `PELLET_SCORE`, etc. now imported from `gameLogic.js` |
| 3 | Refactor server.js to use gameLogic.js functions | ✅ Done | Removed duplicate `isWall`, pellet loop, starting-positions arrays, hardcoded scores |

## Completed

| # | Phase | Completed | Commit |
| :--- | :--- | :--- | :--- |
| 1 | Ghost AI port (4 personalities, state machine, scatter/chase) | ✅ | `de6a4ed` |
| 2 | Frightened state visuals (blue body, white flash, eaten eyes) | ✅ | `a81d827` |
| 3 | Procedural maze generation + level progression | ✅ | `afd8f3c` |
| 4 | Polish: extra lives, dash, high scores | ✅ | `42b3063` |
| 5 | Lobby overhaul: warm rejoin, ready-up, countdown, reconnection grace | ✅ | — |

# PLAN.md — Feature Roadmap

## Active Tasks

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

## Notes

- Server remains authoritative — all game state mutations happen server-side only.
- Keep pure functions in `src/` (no I/O, no side effects).
- Coverage target: ≥ 80% lines, ≥ 70% branches on `src/`.
- 317 total tests pass, lint clean.
- Duplication removed: `isWall` (server.js → gameLogic.js), `GHOST_EAT_SCORE` (single source in ghostAI.js), `extractPellets` (replaced inline loop), `getStartingPositions()` (replaced 2 hardcoded arrays), score constants (PELLET_SCORE/POWER_PELLET_SCORE/PLAYER_EAT_SCORE).
- Dead code removed: `checkGameOver`, `createInitialState`, `randomDirection`, `moveEntity`, `distance`, `isColliding`, `isValidDirection`, `playMove`, plus 15 orphan exports from gameLogic.js and ghostAI.js.

## Features Implemented (outside plan, from direct requests)

| Feature | Commit |
| :--- | :--- |
| Return-to-lobby (leaveGame / returnToLobby messages, Escape key, leave button) | — |
| Sprite-to-wall clamping (B-005 fix — player no longer clips into walls) | — |
| Tunnel teleport fix (B-006 — player can reach tunnel edge and wrap) | — |
| Power-pellet scared state (B-007 — all non-eaten ghosts turn blue, including house ghosts) | — |
| Single-player mode (solo play, no last-man-standing win, score-based game over) | — |
| About modal (help/about dialog with features, controls, tech stack) | — |
| Weapon powerups (pistol + explosive, spawn when power pellets exhausted) | — |
| Non-dead-end player spawn (B-009 — ≥2 open neighbors guaranteed) | — |

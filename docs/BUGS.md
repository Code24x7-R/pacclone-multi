# BUGS.md — Bug Tracker

## Open Bugs

| # | Symptom | Suspected File | Date | Impact | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| — | *(none — all resolved below)* | | | | |

## Recently Fixed

| # | Symptom | Root Cause | Fix | Date | Commit |
| :--- | :--- | :--- | :--- | :--- | :--- |
| B-002 | Player sprite drifts off pellet line after 4-5 turns; appears to miss pellets or cross wall boundaries | Server let players turn at any coordinate, not just tile centers. Perpendicular axis wasn't snapped to corridor center (half-tile) on turn, so turning at e.g. x=1.8 left the player travelling up along x=1.8 instead of x=1.5 (0.3 tiles / 12px off). Offset compounded over multiple turns. | Added `snapPerpendicular(x, y, direction)` to `src/gameLogic.js` — snaps the perpendicular axis to nearest half-tile on every direction change. Wired into `server.js` input handler. Added 'P' toggle for visual debug overlay showing player pos, corridor center, and drift (dashed line + crosshair). 16 new tests. | 2026-08-09 | — |
| B-003 | Player/ghost/pellet alignment off; maze overflows phone screens; player speed too slow vs single-player reference | (1) Player radius was `TILE_SIZE/2.5` (16px) — too small, visually misaligned. (2) Canvas had no responsive CSS — overflowed on phones. (3) `PLAYER_SPEED` was 0.075 (4.5 tiles/s) vs reference's 5 tiles/s. | (1) Changed player radius to `TILE_SIZE/2 - 2` (18px) matching reference. (2) Added responsive canvas CSS (`width: 100%`, `max-width: 800px`, `aspect-ratio: 800/520`, `touch-action: none`). (3) Bumped `PLAYER_SPEED` from 0.075 to 0.1 (6 tiles/s). | 2026-08-09 | — |
| B-001 | Game starts → blank screen; console shows `Current State: undefined` | `server.js` `gameLoop` broadcast payload `{ maze, players, ghosts, pellets, powerPellets }` omits `currentGameState`. Only the game-over branch included it. Client reads `undefined` → never enters render branch. | Extracted `buildGameStatePayload()` into `src/gameLogic.js` (pure, tested) and used it in `server.js` so `currentGameState` is always included. Added lobby host-status UI. Added inline favicon to prevent 404. | 2026-08-08 | — |

## Notes

- When logging a bug, include: symptom, suspected file, date opened, and impact level (🔴 High / 🟡 Medium / 🟢 Low).
- Always write a failing Jest test that reproduces the bug before fixing.

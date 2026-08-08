# BUGS.md — Bug Tracker

## Open Bugs

| # | Symptom | Suspected File | Date | Impact | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| — | *(none — all resolved below)* | | | | |

## Recently Fixed

| # | Symptom | Root Cause | Fix | Date | Commit |
| :--- | :--- | :--- | :--- | :--- | :--- |
| B-001 | Game starts → blank screen; console shows `Current State: undefined` | `server.js` `gameLoop` broadcast payload `{ maze, players, ghosts, pellets, powerPellets }` omits `currentGameState`. Only the game-over branch included it. Client reads `undefined` → never enters render branch. | Extracted `buildGameStatePayload()` into `src/gameLogic.js` (pure, tested) and used it in `server.js` so `currentGameState` is always included. Added lobby host-status UI. Added inline favicon to prevent 404. | 2026-08-08 | — |

## Notes

- When logging a bug, include: symptom, suspected file, date opened, and impact level (🔴 High / 🟡 Medium / 🟢 Low).
- Always write a failing Jest test that reproduces the bug before fixing.

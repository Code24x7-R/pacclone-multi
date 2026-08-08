# PLAN.md — Feature Roadmap

## Active Tasks

| # | Task | Status | Priority | Target File(s) |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Add integration tests for WebSocket message handling | ⏳ Pending | Medium | `tests/integration/` |
| 2 | Extract remaining game logic from server.js into testable modules | ⏳ Pending | Low | `src/gameLogic.js`, `server.js` |
| 3 | Refactor server.js to use gameLogic.js functions | ⏳ Pending | Low | `server.js` |

## Completed

| # | Phase | Completed | Commit |
| :--- | :--- | :--- | :--- |
| 1 | Ghost AI port (4 personalities, state machine, scatter/chase) | ✅ | `de6a4ed` |
| 2 | Frightened state visuals (blue body, white flash, eaten eyes) | ✅ | `a81d827` |
| 3 | Procedural maze generation + level progression | ✅ | `afd8f3c` |
| 4 | Polish: extra lives, dash, high scores | ✅ | `42b3063` |

## Notes

- Server remains authoritative — all game state mutations happen server-side only.
- Keep pure functions in `src/` (no I/O, no side effects).
- Coverage target: ≥ 80% lines, ≥ 70% branches on `src/`.
- 208 total tests pass, lint clean.

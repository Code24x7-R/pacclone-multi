# PLAN.md — Feature Roadmap

## Active Tasks

| # | Task | Status | Priority | Target File(s) |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Extract remaining game logic from server.js into testable modules | 🔄 In Progress | High | `src/gameLogic.js`, `server.js` |
| 2 | Refactor server.js to use gameLogic.js functions | ⏳ Pending | High | `server.js` |
| 3 | Add integration tests for WebSocket message handling | ⏳ Pending | Medium | `tests/integration/` |
| 4 | Add client-side rendering tests (Canvas mock) | ⏳ Pending | Medium | `tests/client/` |
| 5 | Improve ghost AI (hunt nearest player instead of random) | ⏳ Pending | Low | `src/gameLogic.js` |
| 6 | Add power-up timer management (clear on game reset) | ⏳ Pending | Low | `server.js` |

## Completed

| # | Task | Completed | Commit |
| :--- | :--- | :--- | :--- |
| — | *(none yet — project just initialized)* | | |

## Notes

- Server remains authoritative — all game state mutations happen server-side only.
- Keep pure functions in `src/gameLogic.js` (no I/O, no side effects).
- Coverage target: ≥ 80% lines, ≥ 70% branches on `src/`.

# AGENTS.md — pacclone-multi Development Guide

## 1. Project Summary
- **App:** pacclone-multi — browser-based multiplayer Pac-Man clone (vanilla HTML5 Canvas + Node.js WebSocket server).
- **Stack:** Vanilla JS client (Canvas 2D, Web Audio) + Node.js authoritative server (Express + `ws`).
- **No build step** — static client files served directly by Express.
- **Game loop:** 60 FPS server-side, state broadcast to all clients via WebSocket.
- **Players:** 1–4 players per match; keyboard (arrows/WASD), gamepad (D-pad/analog), or touch (virtual joystick).
- **Testing:** Jest (server: `node` env, client: `jsdom` env).
- **Quality Targets:**
  - Line Coverage: ≥ 80%
  - Branch Coverage: ≥ 70%
  - Zero lint errors on `npm run lint`.

---

## 2. Agent Rules & Constraints

- **Memory:** Use the **project-local** memory at `.pi/memory/MEMORY.md` for all project-specific context, decisions, and session notes. Do NOT write project memory to the global pi-memory system — it stays in the repo so it travels with the code.
- **Server authority:** The server is the single source of truth. Clients send *input only* — never game state. Never trust client-reported positions, scores, or lives.
- **Do NOT add `/* istanbul ignore next */`** to force coverage without explicit user approval.
- **Always** refer to `docs/PLAN.md` (features), `docs/BUGS.md` (bugs), or `docs/PLAYER_MOVEMENT.md` (movement flow) before starting work.
- Always run `npm run lint && npm test` before declaring a task complete.
- Game logic changes must keep the server authoritative.
- All game state mutations happen server-side only.

---

## 3. Quick Commands

| Purpose | Command |
| :--- | :--- |
| Start server (production) | `npm start` |
| Dev mode (auto-reload) | `npm run dev` |
| Run all tests | `npm test` |
| Single test file | `npx jest path/to/file.test.js` |
| Watch mode | `npm run test:watch` |
| Lint | `npm run lint` |
| Lint auto-fix | `npm run lint:fix` |
| Full verification pass | `npm run verify` |

---

## 4. Architecture

The full architecture reference — file structure, server/client internals, lobby/match flow, and the WebSocket message protocol — lives in [`docs/Architecture.md`](docs/Architecture.md). Read it when you need the game-state FSM, entity model, movement/collision details, or the message protocol.

At a glance:
- **Server:** `server.js` — authoritative 60 FPS game loop, FSM (`LOBBY` → `IN_PROGRESS` → `GAME_OVER` → `LOBBY`), Express + `ws`.
- **Client:** `index.html` — Canvas 2D rendering, keyboard/gamepad/touch input, Web Audio SFX.
- **Protocol:** clients send *input only*; the server broadcasts state. See the protocol table in `docs/Architecture.md`.

---

## 5. Development Tracks & Workflows

### 5.1 Feature Work Track (`docs/PLAN.md`)
1. Select active task in `docs/PLAN.md`.
2. Write unit tests *first* targeting uncovered logic/branches.
3. Write implementation code to pass tests.
4. Run `npm run verify`.
5. Update task status in `docs/PLAN.md`.
6. Log completion in `docs/PROGRESS_LOG.md` with header prefix `[FEATURE]`.

### 5.2 Bugfix Work Track (`docs/BUGS.md`)
1. **Log Open Bug:** Add symptom, suspected file, date, and impact (🔴 High / 🟡 Medium / 🟢 Low).
2. **Reproduce:** Write a failing Jest test reproducing the issue.
3. **Fix & Verify:** Apply root-cause fix and run `npm run verify`.
4. **Update Logs:** Move bug to "Recently Fixed" in `docs/BUGS.md` (documenting root cause and fix) and log in `docs/PROGRESS_LOG.md` with header prefix `[BUGFIX]`.

---

## 6. Testing Strategy

### Server Tests (`tests/server/`, `testEnvironment: "node"`)
- Pure functions: `isWall()`, collision detection, movement validation
- Game state: initialization, state transitions, win/loss conditions
- Entity logic: player eating, ghost respawn, power-up timing, spectator transition

### Client Tests (`tests/client/`, `testEnvironment: "jsdom"`)
- Canvas rendering with mocked 2D context
- Input handling: keyboard events, gamepad polling, touch joystick
- WebSocket message parsing and client state updates

### Integration Tests (`tests/integration/`)
- Full message flow: join → start → input → state broadcast
- Multi-client scenarios

### Mocking Notes
- **Canvas:** Mock `CanvasRenderingContext2D` methods (`fillRect`, `beginPath`, `arc`, `fill`, `clearRect`, `fillText`)
- **WebSocket:** Mock `ws` server and client connections
- **AudioContext:** Mock `createOscillator`, `createGain`, `destination`
- **Timers:** Use `jest.useFakeTimers()` for game loop and power-up timeout tests

---

## 7. Deployment

### Requirements
- Node.js 18+ runtime
- WebSocket support (the `ws` library)
- Port 8080 (configurable via `PORT` env var)

### Local / Self-Hosted
```bash
npm install
npm start
# → http://localhost:8080
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
```

### Platform Targets
- **Railway / Render / Fly.io** — Node.js WebSocket-friendly PaaS
- **VPS** — any Ubuntu/Debian box with Node 18+

### CI/CD (GitHub Actions)
- Lint + test on every push to any branch
- On merge to `main`: build Docker image, push to GHCR, deploy

---

## 8. Common Agent Pitfalls to Avoid

1. **Breaking server authority:** Never move game logic to the client. The client renders state and sends input — that's it.
2. **Game loop coupling:** The `gameLoop` is tightly coupled with `setInterval` and `ws`. Extract pure functions (collision, movement, state transitions) into testable units before modifying.
3. **Frame-rate dependence:** Movement speeds are per-tick at 60 FPS. If you change `GAME_LOOP_INTERVAL`, adjust speeds accordingly or switch to delta-time.
4. **Collision tunneling:** At high speeds, entities can pass through walls between ticks. Use continuous collision detection (raycast from current to next position) if this becomes an issue.
5. **WebSocket reconnection:** Clients disconnecting mid-game must be handled — remove from `players[]`, promote to spectator, stop game loop when no clients remain.
6. **AudioContext resume:** Browsers suspend AudioContext until a user gesture. The `loadSounds()` call happens on page load — first sound only plays after the user clicks "Join Lobby".
7. **Canvas render allocations:** Avoid creating objects inside `render()`. Pre-allocate where possible for 60 FPS performance.
8. **Power-up timer drift:** `setTimeout` for power-up expiry is not paused when the game ends. Clear timers on game reset.

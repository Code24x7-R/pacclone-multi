# Architecture — pacclone-multi

Detailed architecture reference for the browser-based multiplayer Pac-Man clone. For the development guide, rules, and workflows see [`AGENTS.md`](../AGENTS.md).

---

## File Structure

```
server.js              # Express + WebSocket server, game loop, state management, collision
index.html             # Canvas client: rendering, input (keyboard/gamepad/touch), audio
index.tsx              # Placeholder (unused — vanilla JS project, no React)
tsconfig.json          # Placeholder (unused)
vite.config.ts         # Placeholder (unused)
package.json           # Dependencies: express, ws, uuid
docs/PLAN.md           # Feature roadmap
docs/BUGS.md           # Bug tracker
docs/PROGRESS_LOG.md   # Change log
docs/PLAYER_MOVEMENT.md # Player movement flow diagram
docs/Architecture.md   # This doc — architecture reference
tests/                 # Jest test suites
  server/              # Server-side game logic tests (node env)
  client/              # Client-side rendering & input tests (jsdom env)
  integration/         # WebSocket message flow tests
```

---

## Server Architecture (`server.js`)

- **Game States (FSM):** `LOBBY` → `IN_PROGRESS` → `GAME_OVER` → (5s delay) → `LOBBY`
- **Game Loop:** `setInterval(gameLoop, 1000/60)` — 60 FPS; only runs when `IN_PROGRESS`
- **Entities:** `players[]`, `ghosts[]`, `pellets[]`, `powerPellets[]`
- **Maze:** 2D array — `0` = pellet path, `1` = wall, `2` = power pellet
- **Collision:** Distance-based via `Math.hypot(dx, dy) < threshold`
- **Movement:** Direction-based with wall checking (`isWall()`); axis-separated (X then Y) for sliding along walls
- **Speeds:** `PLAYER_SPEED = 0.05` tiles/tick, `GHOST_SPEED = 0.04` tiles/tick
- **Power-up:** 10-second duration (`setTimeout`), score +50, enables eating ghosts/players
- **Lives:** 3 per player; on 0 lives → spectator mode
- **Win conditions:** Last man standing OR all pellets eaten

### Lobby & Match Flow
- Players join via `joinLobby`, minting a stable token that persists across reconnects.
- The host (first lobby player) starts the match once everyone has readied up (`toggleReady`), triggering a 3-2-1 countdown.
- Single-player bypasses ready-up and countdown (`startSinglePlayer`).
- On match end, the lobby rebuilds from the finished match (warm rejoin) so the group stays together.
- A disconnected player gets a grace period to reconnect before their slot is released.

### Spectate & Chat
- Lobby players can watch an in-progress match (`spectateGame`); `lobbyState` reports match type + participants via `inProgressMatch`.
- Lobby chat (`chat` / `getChatHistory`) persists in a rolling in-memory history (capped at 100) and is broadcast to all clients.
- Chat commands: a message starting with `/` is interpreted as a moderator action (e.g. `/resetleaderboard`). Unknown commands fall through to normal chat; role checks are enforced server-side.

### Weapons
- When all pellets + power pellets are eaten, weapons spawn on random walkable tiles (50/50 pistol/explosive, 3s cooldown, max 2 on board).
- **Pistol**: shared — picking it up arms all living players; fires yellow projectile (Space) that damages ghosts/players in its path; **infinite rounds** (never depletes). Persists across respawns; lost only when eliminated or level ends.
- **Explosive**: single-user; detonation (Space) damages players/ghosts within `EXPLOSIVE_BLAST_RADIUS` and clears pellets within `EXPLOSIVE_PELLET_RADIUS`. **Single-use per life** — like phase-dash, a fresh one is granted on each respawn (if the player has no pistol).
- **Rendering** (Canvas 2D): pistol = gray gun shape with grip lines and highlight; explosive = red dynamite stick with gold warning band, curved fuse, and spark. Both cast a grounding shadow on their tile.
- HUD indicators show "PISTOL [Space]" or "EXPLOSIVE [Space]" near the bottom of the canvas.

---

## Client Architecture (`index.html`)

- **Rendering:** HTML5 Canvas 2D, `TILE_SIZE = 40px`, canvas 800×520
- **Input:** Keyboard (arrows + WASD), Gamepad (D-pad buttons 12–15 + analog axes 0–1), Touch (virtual joystick)
- **Audio:** Web Audio API oscillator-based SFX (chomp, powerup, ghost-eaten, player-eaten, game-over)
- **State:** `LOBBY` / `IN_PROGRESS` / `GAME_OVER` / `SPECTATING`
- **Player name:** Persisted in `localStorage` as `pacclonePlayerName`
- **Lobby UI:** two-column layout — players + controls (left), high scores + chat (right); in-progress match banner with spectate option.

---

## WebSocket Message Protocol

| Direction | Type | Payload |
| :--- | :--- | :--- |
| S → C | `welcome` | `{ clientId, commit }` |
| S → C | `lobbyState` | `{ lobbyPlayers, currentGameState, countdown, inProgressMatch }` |
| C → S | `joinLobby` | `{ name, token? }` |
| C → S | `input` | `{ direction }` |
| C → S | `startGame` | `{}` |
| S → C | `gameState` | `{ maze, players, ghosts, pellets, powerPellets, level, weapons, projectiles }` |
| S → C | `spectatorMode` | `{ message, voluntary? }` |
| C → S | `startSinglePlayer` | `{}` |
| C → S | `leaveGame` | `{}` |
| C → S | `spectateGame` | `{}` |
| S → C | `returnToLobby` | `{ lobbyPlayers, currentGameState }` |
| C → S | `chat` | `{ text }` |
| C → S | `getChatHistory` | `{}` |
| S → C | `chatMessage` | `{ message: { name, id, text, ts } }` |
| S → C | `chatHistory` | `{ messages: [{ name, id, text, ts }] }` |
| S → C | `kicked` | `{ message }` |
| S → C | `kickNotice` | `{ text }` |
| C → S | `getLeaderboard` | `{}` |
| S → C | `leaderboard` | `{ entries: [{ name, score, date }] }` |
| C → S | `resetLeaderboard` | `{}` (moderator only) |
| S → C | `error` | `{ message }` |

### Roles

- **Moderator:** one lobby player holds the moderator role (reported in `lobbyState.moderatorId`). The first player to join an empty lobby becomes moderator; the role transfers to the next-oldest player on departure and persists across reconnects (by token) and post-match lobby rebuilds. The moderator may reset the persistent leaderboard via the `/resetleaderboard` chat command or the `resetLeaderboard` message — both gated server-side, so a non-moderator cannot trigger a reset by faking either.

### Leaderboard

- The leaderboard lives on the server and persists to `data/leaderboard.json`. The server is the authoritative scorer: it records each eliminated player's score at death and each survivor's score at match end. Clients never submit scores — they only request (`getLeaderboard`) and render (`leaderboard`) the board. The board is sorted descending by score and capped at 10 entries. A moderator reset clears the board and announces the action in chat.

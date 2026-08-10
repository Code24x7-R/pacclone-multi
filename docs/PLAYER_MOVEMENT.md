# PLAYER_MOVEMENT.md — Player Movement Flow Diagram

This document describes the complete player movement flow from maze generation through collision resolution, as implemented in the pacclone-multi authoritative server.

---

## 1. High-Level Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GAME LOOP (60 FPS)                                  │
│  setInterval(gameLoop, 1000/60) — only runs when currentGameState ===       │
│  IN_PROGRESS                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PER-TICK PIPELINE (for each player)                                        │
│                                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   │
│  │ 1. INPUT │ → │ 2. SNAP  │ → │ 3. MOVE  │ → │ 4. CLAMP │ → │ 5. EAT   │   │
│  │ Consume  │   │ Perpend. │   │ + Wrap   │   │ to Wall  │   │ Pellets  │   │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   │
│                                                                     │       │
│                                                                     ▼       │
│                                                              ┌──────────┐   │
│                                                              │ 6. GHOST │   │
│                                                              │ COLLIDE  │   │
│                                                              └──────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Phase 1 — Maze Generation

**File:** `src/mazeGenerator.js` → `generateMaze(options)`

Called by `startNextLevel()` when advancing past level 1.

```
┌─────────────────────────────────────────────────────────────────┐
│                    MAZE GENERATION PIPELINE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Fill grid with walls (1)                                    │
│     ┌─────────────────────────────────────────────────────┐     │
│     │  1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1            │     │
│     │  1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1              │     │
│     │  1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1              │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│  2. Reserve ghost house area (type 5 = reserved)                │
│     ┌─────────────────────────────────────────────────────┐     │
│     │  . . . . . . . . . . . . . . . . . . . . . . .      │     │
│     │  . . . . . . . . . . . . . . . . . . . . . . .      │     │
│     │  . . . . . . 5 5 . . . . . . . . . . . . . . .      │     │
│     │  . . . . . . 5 5 . . . . . . . . . . . . . . .      │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│  3. Recursive backtracking from (1,1): carve left half          │
│     ┌─────────────────────────────────────────────────────┐     │
│     │  # . . # . . . . . . . . . . . . . . . . . #        │     │
│     │  # . # # # . . . . . . . . . . . . . . . . #        │     │
│     │  . . # . . . . . . . . . . . . . . . . . . .        │     │
│     │  # . # . . . . . . . . . . . . . . . . . . #        │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│  4. Mirror left half → right half (symmetry)                    │
│     ┌─────────────────────────────────────────────────────┐     │
│     │  # . . # . . . . . . . . . . . . . . # . . #        │     │
│     │  # . # # # . . . . . . . . . . . . # # # . #        │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│  5. Place ghost house structure (walls + gate)                  │
│     ┌─────────────────────────────────────────────────────┐     │
│     │  . . . . . . . . . . . . . . . . . . . . . . .      │     │
│     │  . . . . . . . . . . . . . . . . . . . . . . .      │     │
│     │  . . . . . . . # # # # . . . . . . . . . . . .      │     │
│     │  . . . . . . . # = = # . . . . . . . . . . . .      │     │
│     │  . . . . . . . # . . # . . . . . . . . . . . .      │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│  6. Add tunnels (type 4) at rows 8 and height-1                 │
│     ┌─────────────────────────────────────────────────────┐     │
│     │  . . . . . . . . . . . . . . . . . . . . . . .      │     │
│     │  4 . . . . . . . . . . . . . . . . . . . . . 4      │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│  7. Place power pellets in dead-end corners (type 2)            │
│     ┌─────────────────────────────────────────────────────┐     │
│     │  # O # . . . . . . . . . . . . . . . # O #          │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│  8. Ensure start tiles walkable + non-dead-end (≥2 neighbors)   │
│     ┌─────────────────────────────────────────────────────┐     │
│     │  # O # . . . . . . . . . . . . . . . # O #          │     │
│     │  . . # . . . . . . . . . . . . . . . # . .          │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│  9. Ensure connectivity: flood fill from (1,1), carve paths     │
│     to any unreachable pellet tiles                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Tile Types:
  0 = pellet path      4 = empty walkable (tunnel/house)
  1 = wall             6 = ghost gate (passable only by ghosts)
  2 = power pellet     5 = reserved (temporary, becomes house)
  3 = power pellet (corner variant)
```

---

## 3. Phase 2 — Player Spawn Position

**File:** `server.js` → `getStartingPositions()` / `startNextLevel()`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PLAYER SPAWN ASSIGNMENT                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Spawn Slots (assigned round-robin by lobby order):                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Index 0: (1.5, 1.5)        — top-left corner                         │  │
│  │  Index 1: (w-1.5, 1.5)      — top-right corner                        │  │
│  │  Index 2: (1.5, 4.5)        — left side, 4 tiles down                 │  │
│  │  Index 3: (w-1.5, 4.5)      — right side, 4 tiles down                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Spawn Requirements (enforced by mazeGenerator.js step 8):                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  ✓ Tile type ≠ 1 (wall)                                               │  │
│  │  ✓ Tile type ≠ 6 (ghost gate)                                         │  │
│  │  ✓ Open neighbors ≥ 2 (NOT a dead end)                                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Spawn Reset (per level):                                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  player.x = startingPositions[i].x                                    │  │
│  │  player.y = startingPositions[i].y                                    │  │
│  │  player.direction = null            // No movement until input        │  │
│  │  player.poweredUp = false                                             │  │
│  │  player.poweredUpTicks = 0                                            │  │
│  │  // KEEP: player.lives, player.score, player.color, player.dashAvail  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Phase 3 — Player Input → Next Move Options

**File:** `server.js` → `ws.on('message')` handler

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     INPUT HANDLING (per client message)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Client sends: { type: 'input', direction: 'up'|'down'|'left'|'right' }     │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  if (data.direction && data.direction !== player.direction) {         │  │
│  │      // Direction change — snap perpendicular axis to corridor        │  │
│  │      const snapped = snapPerpendicular(player.x, player.y, dir);      │  │
│  │      player.x = snapped.x;                                            │  │
│  │      player.y = snapped.y;                                            │  │
│  │  }                                                                    │  │
│  │  player.direction = data.direction;                                   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  snapPerpendicular() logic:                                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Vertical move (up/down):   snap X → nearest half-tile (n + 0.5)      │  │
│  │  Horizontal move (left/right): snap Y → nearest half-tile (n + 0.5)   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Example: Player at (1.7, 2.3) turning to move right:                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  snapPerpendicular(1.7, 2.3, 'right')                                 │  │
│  │  → { x: 1.7, y: Math.round(2.3 - 0.5) + 0.5 }                         |  |
│  │                                                                       |  |
│  │  → { x: 1.7, y: 2.5 }               // Y snapped to corridor center   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Possible Next Moves (4 cardinal directions):                               │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        ┌─────┐                                        │  │
│  │                        │ UP  │  nextY = y - PLAYER_SPEED              │  │
│  │                        └──┬──┘                                        │  │
│  │     ┌─────┐         ┌────┴────┐         ┌─────┐                       │  │
│  │     │LEFT │ ←────── │ PLAYER  │ ──────→ │RIGHT│                       │  │
│  │     └─────┘         └────┬────┘         └─────┘                       │  │
│  │   nextX = x - SPEED      │        nextX = x + SPEED                   │  │
│  │                        ┌──┴──┐                                        │  │
│  │                        │DOWN │  nextY = y + PLAYER_SPEED              │  │
│  │                        └─────┘                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Phase 4 — Movement Execution + Collision Pipeline

**File:** `server.js` → `gameLoop()` player section

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   MOVEMENT EXECUTION (per tick, per player)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  STEP 1: Compute candidate position                                   │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  let nextX = player.x;                                          │  │  │
│  │  │  let nextY = player.y;                                          │  │  │
│  │  │  switch (player.direction) {                                    │  │  │
│  │  │      case 'up':    nextY -= PLAYER_SPEED; break;  // 0.05       │  │  │
│  │  │      case 'down':  nextY += PLAYER_SPEED; break;                │  │  │
│  │  │      case 'left':  nextX -= PLAYER_SPEED; break;                │  │  │
│  │  │      case 'right': nextX += PLAYER_SPEED; break;                │  │  │
│  │  │  }                                                              │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  STEP 2: Tunnel wrapping (BEFORE wall check)                          │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  nextX = wrapTunnelX(nextX, player.y, currentMaze);             │  │  │
│  │  │                                                                 │  │  │
│  │  │  if (maze[tileY][0] === 4) {  // Tunnel row                     │  │  │
│  │  │      if (nextX < 0)      nextX += width;   // Wrap left→right   │  │  │
│  │  │      if (nextX >= width) nextX -= width;   // Wrap right→left   │  │  │
│  │  │  }                                                              │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  STEP 3: Wall collision check (axis-separated for sliding)            │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  if (!isWall(nextX, player.y)) player.x = nextX; // X-axis OK   │  │  │
│  │  │  if (!isWall(player.x, nextY)) player.y = nextY; // Y-axis OK   │  │  │
│  │  │                                                                 │  │  │
│  │  │  isWall(x, y, maze):                                            │  │  │
│  │  │      tileX = Math.floor(x);                                     │  │  │
│  │  │      tileY = Math.floor(y);                                     │  │  │
│  │  │      if (out of bounds) return true;                            │  │  │
│  │  │      return maze[tileY][tileX] === 1 || maze[tileY][tileX] === 6│  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  STEP 4: Sprite-to-wall clamping (prevent visual overlap)             │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  radius = (TILE_SIZE / 2 - 2) / TILE_SIZE  // ≈ 0.45 tiles      │  │  │
│  │  │  var clamped = clampSpriteToWall(player.x, player.y, radius, maze);│  │
│  │  │  player.x = clamped.x;                                          │  │  │
│  │  │  player.y = clamped.y;                                          │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  STEP 5: Pellet / Power-pellet consumption                            │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  checkPlayerPellets(player, pellets, powerPellets);             │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  STEP 6: Ghost collision resolution                                   │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  for (ghost of ghosts) {                                        │  │  │
│  │  │      if (player.dashing) return;  // Invulnerable during dash   │  │  │
│  │  │      dist = Math.hypot(player.x - ghost.x, player.y - ghost.y); │  │  │
│  │  │      if (dist < 0.5) {  // Collision threshold                  │  │  │
│  │  │          if (player.poweredUp || ghost.frightened)              │  │  │
│  │  │              EAT GHOST;                                         │  │  │
│  │  │          else                                                   │  │  │
│  │  │              PLAYER DIES;                                       │  │  │
│  │  │      }                                                          │  │  │
│  │  │  }                                                              │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Phase 4a — Sprite-to-Wall Clamp Detail

**File:** `src/gameLogic.js` → `clampSpriteToWall(x, y, radius, maze)`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     clampSpriteToWall FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Player radius ≈ 0.45 tiles. Wall check in step 3 only gates the            │
│  sprite CENTER, but the body can visually overlap the wall. This            │
│  function pushes the center back so the edge sits flush.                    │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  tileY = Math.floor(y)                                                │  │
│  │  isTunnelRow = (maze[tileY][0] === 4)  // Skip clamp on tunnel edges  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  CHECK RIGHT:                                                         │  │
│  │  rightTile = Math.floor(x + radius)                                   │  │
│  │  if (isWall(rightTile, tileY)) {                                      │  │
│  │      if (!(isTunnelRow && rightTile >= width)) {                      │  │
│  │          x = rightTile - radius;  // Push left                        │  │
│  │      }                                                                │  │
│  │  }                                                                    │  │
│  │                                                                       │  │
│  │  Example: x=8.55, radius=0.45, wall at tile 9                         │  │
│  │  → rightTile = Math.floor(9.0) = 9 (wall)                             │  │
│  │  → x = 9 - 0.45 = 8.55  (stays, edge flush)                           │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  CHECK LEFT:                                                          │  │
│  │  leftTile = Math.floor(x - radius)  // Uses potentially-modified x    │  │
│  │  if (isWall(leftTile, tileY)) {                                       │  │
│  │      if (!(isTunnelRow && leftTile < 0)) {                            │  │
│  │          x = leftTile + 1 + radius;  // Push right                    │  │
│  │      }                                                                │  │
│  │  }                                                                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  tileX = Math.floor(x)  // Recompute after X-axis clamp               │  │
│  │                                                                       │  │
│  │  CHECK BOTTOM:                                                        │  │
│  │  bottomTile = Math.floor(y + radius)                                  │  │
│  │  if (isWall(tileX, bottomTile)) {                                     │  │
│  │      y = bottomTile - radius;  // Push up                             │  │
│  │  }                                                                    │  │
│  │                                                                       │  │
│  │  CHECK TOP:                                                           │  │
│  │  topTile = Math.floor(y - radius)  // Uses potentially-modified y     │  │
│  │  if (isWall(tileX, topTile)) {                                        │  │
│  │      y = topTile + 1 + radius;  // Push down                          │  │
│  │  }                                                                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  return { x, y };                                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Phase 4b — Pellet / Power-Pellet Consumption

**File:** `server.js` → `checkPlayerPellets(player, pellets, powerPellets)`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PELLET CONSUMPTION                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Regular Pellets (tile type 0):                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  for (i = pellets.length - 1; i >= 0; i--) {                          │  │
│  │      p = pellets[i];                                                  │  │
│  │      dist = Math.hypot(player.x - (p.x + 0.5), player.y - (p.y + 0.5));  │
│  │      if (dist < 0.4) {  // Eat threshold                              │  │
│  │          pellets.splice(i, 1);  // Remove from array                  │  │
│  │          player.score += PELLET_SCORE;  // 10 points                  │  │
│  │          playChompSound();                                            │  │
│  │      }                                                                │  │
│  │  }                                                                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Power Pellets (tile type 2):                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  for (i = powerPellets.length - 1; i >= 0; i--) {                     │  │
│  │      pp = powerPellets[i];                                            │  │
│  │      dist = Math.hypot(player.x - (pp.x + 0.5), player.y - (pp.y + 0.5));│
│  │      if (dist < 0.5) {  // Larger threshold (bigger pellet)           │  │
│  │          powerPellets.splice(i, 1);                                   │  │
│  │          player.score += POWER_PELLET_SCORE;  // 50 points            │  │
│  │          player.poweredUp = true;                                     │  │
│  │          player.poweredUpTicks = ceil(frightenedDurationMs / 16.67);  │  │
│  │          ghostFrightenedTimer = frightenedDurationMs;                 │  │
│  │          frightenGhosts(ghosts, GHOST_FRIGHTENED_SPEED, OPPOSITE);    │  │
│  │          playPowerupSound();                                          │  │
│  │      }                                                                │  │
│  │  }                                                                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Effect of Power Pellet:                                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  - All non-eaten ghosts become frightened (state = 'frightened')      │  │
│  │  - Frightened ghosts reverse direction and slow down (speed × 0.5)    │  │
│  │  - Player can now eat ghosts (instead of dying)                       │  │
│  │  - Duration: ~8 seconds at level 1, scales down with level            │  │
│  │  - White flashing in last 1/3 of duration (shouldGhostFlash)          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Phase 4c — Ghost Collision Resolution

**File:** `server.js` → ghost collision section of `gameLoop()`

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     GHOST COLLISION RESOLUTION                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  For each ghost:                                                            │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  if (player.disconnected) return;  // Grace period — skip             │  │
│  │  if (player.dashing)      return;  // Invulnerable during phase dash  │  │
│  │                                                                       │  │
│  │  dist = Math.hypot(player.x - ghost.x, player.y - ghost.y);           │  │
│  │  if (dist >= 0.5) return;  // No collision                            │  │
│  │                                                                       │  │
│  │  if (ghost.eaten) return;  // Already eaten (eyes returning) — skip   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                           │                                                 │
│                           ▼                                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    BRANCH: Who eats whom?                             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│           │                                              │                  │
│           ▼                                              ▼                  │
│  ┌────────────────────────┐              ┌────────────────────────────────┐ │
│  │ player.poweredUp       │              │ player NOT poweredUp           │ │
│  │ OR ghost.frightened    │              │ AND ghost NOT frightened       │ │
│  └──────────┬─────────────┘              └───────────────┬────────────────┘ │
│             │                                            │                  │
│             ▼                                            ▼                  │
│  ┌────────────────────────┐             ┌─────────────────────────────────┐ │
│  │     PLAYER EATS GHOST  │             │       GHOST CATCHES PLAYER      │ │
│  ├────────────────────────┤             ├─────────────────────────────────┤ │
│  │ ghost.eaten = true     │             │ player.lives--                  │ │
│  │ ghost.frightened = false│            │                                 │ │
│  │ ghost.speed = 1.5      │             │ if (player.lives <= 0) {        │ │
│  │ ghost.state = 'eaten'  │             │     // Move to spectator mode   │ │
│  │ player.score += 200    │             │     spectators.push(clientWs);  │ │
│  │ playGhostEatenSound()  │             │     clientWs.playerId = null;   │ │
│  └────────────────────────┘             │     players.splice(i, 1);       │ │
│                                         │ } else {                        | │
│                                         │     // Respawn at random corner │ │
│                                         │     pos = pickRespawnPosition() | │ 
│                                         │     player.x = pos.x;           | │ 
│                                         │     player.y = pos.y;           │ │
│                                         │     player.poweredUp = false;   │ │ 
│                                         │     player.dashAvailable=true;  │ │
│                                         │ }                               │ │
│                                         └─────────────────────────────────┘ |  
│                                                                             |
│                                                                             |
└─────────────────────────────────────────────────────────────────────────────┘
```
---

## 9. Complete Decision Tree (All Paths)
  
```                                                                             |
┌─────────────────────────────────────────────────────────────────────────────┐
│                  COMPLETE MOVEMENT DECISION TREE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  START: Player at (x, y) with direction D, tick T                           │
│    │                                                                        │
│    ▼                                                                        │
│  ┌─────────────────────┐                                                    │
│  │ player.dashing?     │                                                    │
│  │ (dashActiveTicks>0) │                                                    │
│  └──────────┬──────────┘                                                    │
│        YES  │                          NO                                   │
│         │   │                           │                                   │
│         ▼   │                           ▼                                   │
│  ┌──────────┴──┐              ┌─────────────────────┐                       │
│  │ SKIP MOVE   │              │ data.direction      │                       │
│  │ Tick down   │              │ provided by client? │                       │
│  │ dashTimer-- │              └──────────┬──────────┘                       │
│  └─────────────┘                   YES  │                                   │
│                                     │   │                                   │
│                                     ▼   │                                   │
│                          ┌──────────────┴──────────┐                        │
│                          │ direction !== player.dir?│                       │
│                          └──────────────┬──────────┘                        │
│                               YES       │                                   │
│                                │        │                                   │
│                                ▼        │                                   │
│                     ┌──────────────────┐│                                   │
│                     │ snapPerpendicular││                                   │
│                     │ (axis snap)      ││                                   │
│                     └──────────────────┘│                                   │
│                                │        │                                   │
│                                ▼        ▼                                   │
│                          ┌─────────────────────┐                            │
│                          │ Set player.direction│                            │
│                          └──────────┬──────────┘                            │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌─────────────────────┐                            │
│                          │ Compute nextX/nextY │                            │
│                          │ based on direction  │                            │
│                          └──────────┬──────────┘                            │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌─────────────────────┐                            │
│                          │ wrapTunnelX(nextX)  │                            │
│                          │ if on tunnel row    │                            │
│                          └──────────┬──────────┘                            │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌─────────────────────┐                            │
│                          │ isWall(nextX, y)?   │──── YES ──→ Keep old x     │
│                          └──────────┬──────────┘                            │
│                                     │ NO                                    │
│                                     ▼                                       │
│                          ┌─────────────────────┐                            │
│                          │ player.x = nextX    │                            │
│                          └──────────┬──────────┘                            │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌─────────────────────┐                            │
│                          │ isWall(x, nextY)?   │──── YES ──→ Keep old y     │
│                          └──────────┬──────────┘                            │
│                                     │ NO                                    │
│                                     ▼                                       │
│                          ┌─────────────────────┐                            │
│                          │ player.y = nextY    │                            │
│                          └──────────┬──────────┘                            │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌─────────────────────┐                            │
│                          │ clampSpriteToWall() │                            │
│                          │ (4-edge push-back)  │                            │
│                          └──────────┬──────────┘                            │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌─────────────────────┐                            │
│                          │ checkPlayerPellets()│                            │
│                          │ dist < 0.4?         │                            │
│                          └──────────┬──────────┘                            │
│                              YES    │                                       │
│                               │     │                                       │
│                               ▼     │                                       │
│                    ┌─────────────┐  │                                       │
│                    │ Remove      │  │                                       │
│                    │ pellet, +10 │  │                                       │
│                    │ score       │  │                                       │
│                    └─────────────┘  │                                       │
│                               │     │                                       │
│                               ▼     ▼                                       │
│                          ┌─────────────────────┐                            │
│                          │ Power pellet?       │                            │
│                          │ dist < 0.5?         │                            │
│                          └──────────┬──────────┘                            │
│                              YES    │                                       │
│                               │     │                                       │
│                               ▼     │                                       │
│                 ┌─────────────────┐ │                                       │
│                 │ player.poweredUp│ │                                       │
│                 │ Reverse all     │ │                                       │
│                 │ ghost directions│ │                                       │
│                 └─────────────────┘ │                                       │
│                                │    │                                       │
│                                ▼    ▼                                       │
│                          ┌─────────────────────┐                            │
│                          │ Ghost collision:    │                            │
│                          │ dist < 0.5?         │                            │
│                          └──────────┬──────────┘                            │
│                              YES    │                                       │
│                                │    │                                       │
│              ┌─────────────────┴────┴────────────────┐                      │
│              │                                       │                      │
│              ▼                                       ▼                      │
│   ┌─────────────────────┐              ┌──────────────────────────┐         │
│   │ poweredUp/frightened│              │ NOT poweredUp/frightened │         │
│   │ → EAT GHOST         │              │ → PLAYER DIES            │         │
│   │ ghost.eaten=true    │              │ player.lives--           │         │
│   │ score += 200        │              │ respawn or spectate      │         │
│   └─────────────────────┘              └──────────────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Key Constants Reference

| Constant | Value | Description |
| :--- | :--- | :--- |
| `PLAYER_SPEED` | 0.05 tiles/tick | 3 tiles/sec at 60 FPS |
| `TILE_SIZE` | 40 px | Canvas pixel size per tile |
| Pellet eat dist | < 0.4 tiles | Distance threshold for pellet pickup |
| Power eat dist | < 0.5 tiles | Distance threshold for power pellet |
| Ghost collide dist | < 0.5 tiles | Distance threshold for ghost interaction |
| Player radius | ~0.45 tiles | `(TILE_SIZE/2 - 2) / TILE_SIZE` |
| `PELLET_SCORE` | 10 points | Regular pellet value |
| `POWER_PELLET_SCORE` | 50 points | Power pellet value |
| `GHOST_EAT_SCORE` | 200 points | Per ghost eaten while powered |

---

## 11. Architecture Constraints

1. **Server authority:** All movement, collision, and state mutation happen server-side. Clients send input only.
2. **Deterministic:** Pure functions in `src/` have no I/O or side effects — fully testable.
3. **Axis-separated movement:** X and Y wall checks are independent, allowing slides along walls.
4. **Tick-based:** Movement is per-tick at 60 FPS. Speeds are in tiles/tick, not tiles/second.
5. **Broadcast:** After all player/ghost updates, the full game state is broadcast to every client.

---

*Generated from source: `server.js`, `src/gameLogic.js`, `src/mazeGenerator.js`, `src/ghostAI.js`*
*Last updated: 2026-08-10*

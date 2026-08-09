/**
 * gameLogic.js — Pure game logic for pacclone-multi.
 *
 * This module contains no I/O (no WebSocket, no timers, no console).
 * All functions are deterministic and side-effect free so they can be
 * unit-tested in isolation.
 */

// ---------------------------------------------------------------------------
// Maze definition
// ---------------------------------------------------------------------------
// 0 = pellet path, 1 = wall, 2 = power pellet, 3 = power pellet (corner),
// 4 = empty walkable (tunnel / ghost house interior — no pellet),
// 6 = ghost house gate (passable only by ghosts exiting/returning)
//
// Adapted from the single-player pacclone reference. The ghost house sits
// at rows 8-11, cols 7-12 with a gate at row 7, cols 9-10. Tunnels wrap
// at rows 8 and 12.
const MAZE = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1],
  [1, 2, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 2, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 0, 1, 1, 1, 6, 6, 1, 1, 1, 0, 1, 1, 1, 1, 1],
  [4, 4, 4, 4, 1, 0, 1, 4, 4, 4, 4, 4, 4, 1, 0, 1, 4, 4, 4, 4],
  [1, 1, 1, 1, 1, 0, 1, 4, 4, 4, 4, 4, 4, 1, 0, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 4, 1, 4, 4, 1, 4, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 0, 1, 4, 1, 1, 1, 1, 4, 1, 0, 1, 1, 1, 1, 1],
  [4, 4, 4, 4, 1, 0, 1, 4, 4, 4, 4, 4, 4, 1, 0, 1, 4, 4, 4, 4],
];

const TILE_SIZE = 40;
const PLAYER_SPEED = 0.05;
const GHOST_SPEED = 0.04;
const PLAYER_START_LIVES = 3;
const POWER_UP_DURATION_MS = 10000;
const PELLET_SCORE = 10;
const POWER_PELLET_SCORE = 50;
const GHOST_EAT_SCORE = 200;
const PLAYER_EAT_SCORE = 100;

const PLAYER_COLORS = ["yellow", "lime", "cyan", "magenta"];
const DIRECTIONS = ["up", "down", "left", "right"];

// --- Extra lives ---
// Classic arcade style: earn an extra life every N points.
const EXTRA_LIFE_THRESHOLD = 10000;

// --- Dash ---
// A short burst of speed triggered by the player (Shift / gamepad button /
// touch double-tap). Governed by a cooldown so it can't be spammed.
const DASH_SPEED_MULTIPLIER = 1.8; // 80% faster while dashing
const DASH_DURATION_TICKS = 15; // ~0.25s at 60 FPS
const DASH_COOLDOWN_TICKS = 180; // 3s cooldown before next dash

const GAME_STATES = {
  LOBBY: "LOBBY",
  IN_PROGRESS: "IN_PROGRESS",
  LEVEL_COMPLETE: "LEVEL_COMPLETE",
  GAME_OVER: "GAME_OVER",
};

// Starting positions for up to 4 players (corners of the maze)
const STARTING_POSITIONS = [
  { x: 1.5, y: 1.5 },
  { x: MAZE[0].length - 1.5, y: 1.5 },
  { x: 1.5, y: MAZE.length - 1.5 },
  { x: MAZE[0].length - 1.5, y: MAZE.length - 1.5 },
];

// Ghost spawn point
const GHOST_SPAWN = { x: 9.5, y: 5.5 };

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Check whether the given continuous-coordinate position is inside a wall.
 * Tile types: 0=pellet, 1=wall, 2=power, 3=power(corner), 4=empty walkable,
 * 6=ghost gate. Players treat the gate as a wall; ghosts have separate logic.
 * @param {number} x - Continuous X position (in tile units).
 * @param {number} y - Continuous Y position (in tile units).
 * @param {number[][]} [maze=MAZE] - Optional maze override (for testing).
 * @returns {boolean} True if the position is a wall or out of bounds.
 */
function isWall(x, y, maze = MAZE) {
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  if (tileY < 0 || tileY >= maze.length || tileX < 0 || tileX >= maze[0].length) {
    return true;
  }
  const tile = maze[tileY][tileX];
  // 1 = wall, 6 = ghost gate (impassable for players)
  return tile === 1 || tile === 6;
}

/**
 * Calculate the next position for an entity given its current position,
 * direction, and speed. Returns the new {x, y} with wall collision applied
 * on each axis independently (allows sliding along walls).
 * @param {{x: number, y: number}} pos - Current position.
 * @param {string} direction - One of 'up', 'down', 'left', 'right'.
 * @param {number} speed - Movement speed in tiles per tick.
 * @param {number[][]} [maze=MAZE] - Optional maze override.
 * @returns {{x: number, y: number}} The new position after movement.
 */
function moveEntity(pos, direction, speed, maze = MAZE) {
  let { x, y } = pos;

  switch (direction) {
    case "up":
      y -= speed;
      break;
    case "down":
      y += speed;
      break;
    case "left":
      x -= speed;
      break;
    case "right":
      x += speed;
      break;
  }

  // Apply wall collision per-axis so entities slide along walls
  let newX = x;
  let newY = y;
  if (isWall(x, pos.y, maze)) newX = pos.x;
  if (isWall(pos.x, y, maze)) newY = pos.y;

  return { x: newX, y: newY };
}

/**
 * Compute Euclidean distance between two points.
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number}
 */
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Check if two entities are colliding based on a distance threshold.
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {number} threshold - Collision radius.
 * @returns {boolean}
 */
function isColliding(a, b, threshold) {
  return distance(a, b) < threshold;
}

/**
 * Scan the maze and extract pellet and power-pellet positions.
 * Tile types: 0=pellet, 1=wall, 2=power, 3=power(corner), 4=empty, 6=gate.
 * @param {number[][]} [maze=MAZE] - Optional maze override.
 * @returns {{ pellets: Array<{x: number, y: number}>, powerPellets: Array<{x: number, y: number}> }}
 */
function extractPellets(maze = MAZE) {
  const pellets = [];
  const powerPellets = [];
  for (let y = 0; y < maze.length; y++) {
    for (let x = 0; x < maze[y].length; x++) {
      const tile = maze[y][x];
      if (tile === 0) {
        pellets.push({ x, y });
      } else if (tile === 2 || tile === 3) {
        powerPellets.push({ x, y });
      }
      // tile 4 (empty walkable) and tile 6 (gate) produce no pellets
    }
  }
  return { pellets, powerPellets };
}

/**
 * Create the initial game state (used when starting or resetting a match).
 * @returns {{ players: Array, ghosts: Array, pellets: Array, powerPellets: Array }}
 */
function createInitialState() {
  const { pellets, powerPellets } = extractPellets();
  return {
    players: [],
    ghosts: [
      {
        id: 1,
        x: GHOST_SPAWN.x,
        y: GHOST_SPAWN.y,
        color: "red",
        direction: "left",
      },
    ],
    pellets,
    powerPellets,
  };
}

/**
 * Convert lobby players into active game players with starting positions.
 * @param {Array<{id: number, name: string}>} lobbyPlayers
 * @returns {Array<Object>} Active player objects.
 */
function createPlayersFromLobby(lobbyPlayers) {
  return lobbyPlayers.map((lp, index) => ({
    id: lp.id,
    name: lp.name,
    x: STARTING_POSITIONS[index % STARTING_POSITIONS.length].x,
    y: STARTING_POSITIONS[index % STARTING_POSITIONS.length].y,
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    lives: PLAYER_START_LIVES,
    score: 0,
    direction: null,
    poweredUp: false,
    poweredUpTicks: 0,
    extraLivesAwarded: 0,
    dashActiveTicks: 0,
    dashCooldownTicks: 0,
    dashing: false,
  }));
}

/**
 * Pick a random direction for ghost movement.
 * @param {string[]} [dirs=DIRECTIONS]
 * @returns {string}
 */
function randomDirection(dirs = DIRECTIONS) {
  return dirs[Math.floor(Math.random() * dirs.length)];
}

/**
 * The four maze corners, derived from the active maze dimensions.
 * These are the canonical respawn spots. Note: depending on the maze,
 * some corners may be walls (filtered out at pick time).
 * @param {number[][]} maze
 * @returns {{x: number, y: number}[]}
 */
function getRespawnCorners(maze) {
  const w = maze[0].length;
  const h = maze.length;
  return [
    { x: 1.5, y: 1.5 }, // top-left
    { x: w - 1.5, y: 1.5 }, // top-right
    { x: 1.5, y: h - 1.5 }, // bottom-left
    { x: w - 1.5, y: h - 1.5 }, // bottom-right
  ];
}

/**
 * Find the center of the nearest walkable tile to a target point.
 * Searches outward in an expanding ring (up to `maxDist` tiles) so that a
 * geometric corner landing on a wall snaps to the closest valid spawn tile.
 * Ties are broken deterministically (smallest tileX, then smallest tileY).
 * @param {number[][]} maze
 * @param {number} x - Target x (tile units).
 * @param {number} y - Target y (tile units).
 * @param {number} [maxDist=4] - Maximum search radius in tiles.
 * @returns {{x: number, y: number}} Center of the nearest walkable tile.
 */
function snapToWalkable(maze, x, y, maxDist = 4) {
  const baseTX = Math.floor(x);
  const baseTY = Math.floor(y);
  for (let d = 0; d <= maxDist; d++) {
    const candidates = [];
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        // Only the ring at distance d (avoid re-checking inner rings).
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const tx = baseTX + dx;
        const ty = baseTY + dy;
        if (!isWall(tx + 0.5, ty + 0.5, maze)) {
          candidates.push({ tx, ty, dist: Math.hypot(dx, dy) });
        }
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.dist - b.dist || a.tx - b.tx || a.ty - b.ty);
      return { x: candidates[0].tx + 0.5, y: candidates[0].ty + 0.5 };
    }
  }
  // Fallback: return the original point (shouldn't happen in a valid maze).
  return { x, y };
}

/**
 * Pick a random walkable corner that no other player currently occupies.
 *
 * Respawning players used to always reset to (1.5, 1.5), stacking everyone
 * on the top-left corner. This spreads them across the four corners and
 * guarantees no two players spawn on the same tile.
 *
 * @param {Array<{x: number, y: number}>} occupied - Positions to avoid (other players).
 * @param {number[][]} maze - The active maze (for dimensions + wall checks).
 * @param {() => number} [rng=Math.random] - Injectable RNG for deterministic tests.
 * @returns {{x: number, y: number}} The chosen respawn position.
 */
function pickRespawnPosition(occupied, maze, rng = Math.random) {
  // Snap each geometric corner to the nearest walkable tile so respawn
  // always lands on a valid spot, even if the literal corner is a wall.
  const corners = getRespawnCorners(maze).map(c => snapToWalkable(maze, c.x, c.y));
  // De-duplicate corners that snapped to the same tile (small/odd mazes).
  const seen = new Set();
  const walkable = corners.filter(c => {
    const key = `${c.x},${c.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Exclude corners occupied by another player (within 0.5 tiles).
  const free = walkable.filter(
    c => !occupied.some(o => Math.hypot(o.x - c.x, o.y - c.y) < 0.5)
  );
  // If every corner is taken (shouldn't happen with <=4 players), fall back.
  const pool = free.length > 0 ? free : walkable;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Check win/loss conditions.
 * @param {Array} players - Active players.
 * @param {Array} pellets - Remaining pellets.
 * @param {Array} powerPellets - Remaining power pellets.
 * @returns {boolean} True if the game should end.
 */
function checkGameOver(players, pellets, powerPellets) {
  if (players.length <= 1) return true;
  if (pellets.length === 0 && powerPellets.length === 0) return true;
  return false;
}

/**
 * Determine the end-of-level transition based on game state.
 *
 * @param {Array} players - Active players.
 * @param {Array} pellets - Remaining pellets.
 * @param {Array} powerPellets - Remaining power pellets.
 * @returns {null | 'GAME_OVER' | 'LEVEL_COMPLETE'} The transition to
 *   apply, or null if the level should continue.
 */
function getLevelTransition(players, pellets, powerPellets) {
  // Last man standing — the match is over.
  if (players.length <= 1) return "GAME_OVER";
  // All pellets cleared with multiple players alive — advance level.
  if (pellets.length === 0 && powerPellets.length === 0) return "LEVEL_COMPLETE";
  // Otherwise the level continues.
  return null;
}

/**
 * Determine whether a player should earn an extra life based on score.
 * Classic arcade style: one extra life per EXTRA_LIFE_THRESHOLD points.
 *
 * @param {number} score - The player's current score.
 * @param {number} lives - Current life count (for reference).
 * @param {number} [threshold=EXTRA_LIFE_THRESHOLD] - Points per extra life.
 * @returns {number} Number of new extra lives earned at the current score
 *   (0 if no threshold has been crossed since creation).
 */
function extraLivesEarned(score, threshold = EXTRA_LIFE_THRESHOLD) {
  if (score < threshold) return 0;
  return Math.floor(score / threshold);
}

/**
 * Update a player's dash state for one tick.
 *
 * The dash cycle is:
 *   idle → (trigger) → active → (duration expires) → cooldown → idle
 *
 * @param {Object} player - Player object with dash fields.
 * @param {boolean} [triggerDash=false] - Whether the player triggered a dash this tick.
 * @returns {Object} A new player-like object with updated dash fields:
 *   dashActiveTicks, dashCooldownTicks, dashing.
 */
function updateDashState(player, triggerDash = false) {
  let active = player.dashActiveTicks || 0;
  let cooldown = player.dashCooldownTicks || 0;

  // Start a dash if triggered and fully idle (not active, not cooling down).
  if (triggerDash && active <= 0 && cooldown <= 0) {
    active = DASH_DURATION_TICKS;
  }

  // Tick down active duration.
  if (active > 0) {
    active--;
    // When active expires, begin cooldown.
    if (active === 0) {
      cooldown = DASH_COOLDOWN_TICKS;
    }
  } else if (cooldown > 0) {
    cooldown--;
  }

  return {
    dashActiveTicks: active,
    dashCooldownTicks: cooldown,
    dashing: active > 0,
  };
}

/**
 * Get the effective speed multiplier for a player given their dash state.
 * @param {Object} player - Player object with dash fields.
 * @returns {number} 1.0 when idle, DASH_SPEED_MULTIPLIER when dashing.
 */
function dashSpeedMultiplier(player) {
  return player.dashing ? DASH_SPEED_MULTIPLIER : 1.0;
}

/**
 * Validate a direction string.
 * @param {string} dir
 * @returns {boolean}
 */
function isValidDirection(dir) {
  return DIRECTIONS.includes(dir);
}

/**
 * Snap the perpendicular axis to the nearest corridor center (half-tile).
 *
 * Pac-Man corridors are 1 tile wide, centered on half-tile coordinates
 * (x.5 or y.5). Pellets are placed at tile centers (col+0.5, row+0.5).
 * When the player turns, the axis perpendicular to the new direction must
 * be at a half-tile so the sprite stays aligned with the pellet line.
 *
 * Without this snap, turning at e.g. x=1.8 while moving right leaves the
 * player travelling up along x=1.8 — 0.3 tiles (12px) off the pellet line.
 * After several turns the offset compounds into visible drift.
 *
 * @param {number} x - Current x in tile units.
 * @param {number} y - Current y in tile units.
 * @param {string} direction - The new direction ('up'|'down'|'left'|'right').
 * @returns {{x: number, y: number}} Position with the perpendicular axis snapped.
 */
function snapPerpendicular(x, y, direction) {
  // Nearest half-tile: round(x - 0.5) + 0.5 maps any value to n+0.5.
  if (direction === 'up' || direction === 'down') {
    // Vertical movement — snap X to nearest corridor center.
    return { x: Math.round(x - 0.5) + 0.5, y: y };
  }
  if (direction === 'left' || direction === 'right') {
    // Horizontal movement — snap Y to nearest corridor center.
    return { x: x, y: Math.round(y - 0.5) + 0.5 };
  }
  return { x: x, y: y };
}

/**
 * Build the gameState payload sent from server to clients via WebSocket.
 *
 * This is the single source of truth for the wire format. It guarantees
 * `currentGameState` is always present so the client knows whether to
 * render the lobby or the game board.
 *
 * @param {number[][]} maze
 * @param {Array} players
 * @param {Array} ghosts
 * @param {Array} pellets
 * @param {Array} powerPellets
 * @param {string} currentGameState - One of GAME_STATES (LOBBY, IN_PROGRESS, LEVEL_COMPLETE, GAME_OVER).
 * @param {number} [level=1] - Current level number.
 * @returns {{maze: number[][], players: Array, ghosts: Array, pellets: Array, powerPellets: Array, currentGameState: string, level: number}}
 */
function buildGameStatePayload(maze, players, ghosts, pellets, powerPellets, currentGameState, level = 1) {
  return { maze, players, ghosts, pellets, powerPellets, currentGameState, level };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  MAZE,
  TILE_SIZE,
  PLAYER_SPEED,
  GHOST_SPEED,
  PLAYER_START_LIVES,
  POWER_UP_DURATION_MS,
  PELLET_SCORE,
  POWER_PELLET_SCORE,
  GHOST_EAT_SCORE,
  PLAYER_EAT_SCORE,
  PLAYER_COLORS,
  DIRECTIONS,
  GAME_STATES,
  STARTING_POSITIONS,
  GHOST_SPAWN,
  EXTRA_LIFE_THRESHOLD,
  DASH_SPEED_MULTIPLIER,
  DASH_DURATION_TICKS,
  DASH_COOLDOWN_TICKS,
  isWall,
  moveEntity,
  distance,
  isColliding,
  extractPellets,
  createInitialState,
  createPlayersFromLobby,
  randomDirection,
  getRespawnCorners,
  pickRespawnPosition,
  checkGameOver,
  getLevelTransition,
  extraLivesEarned,
  updateDashState,
  dashSpeedMultiplier,
  isValidDirection,
  snapPerpendicular,
  buildGameStatePayload,
};

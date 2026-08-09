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
  [4, 4, 4, 4, 4, 0, 1, 4, 4, 4, 4, 4, 4, 1, 0, 4, 4, 4, 4, 4],
  [1, 1, 1, 1, 1, 0, 1, 4, 4, 4, 4, 4, 4, 1, 0, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 4, 1, 4, 4, 1, 4, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 0, 1, 4, 1, 1, 1, 1, 4, 1, 0, 1, 1, 1, 1, 1],
  [4, 4, 4, 4, 4, 0, 1, 4, 4, 4, 4, 4, 4, 1, 0, 4, 4, 4, 4, 4],
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
  COUNTDOWN: "COUNTDOWN",
  IN_PROGRESS: "IN_PROGRESS",
  LEVEL_COMPLETE: "LEVEL_COMPLETE",
  GAME_OVER: "GAME_OVER",
};

// Countdown duration before a match begins (3-2-1-GO). The server broadcasts
// a tick each second; the client renders the corresponding number.
const COUNTDOWN_DURATION_MS = 3000;

// Grace period after a disconnect during an active match. If the same player
// (identified by their stable token) reconnects within this window, their slot
// is restored instead of removed.
const RECONNECT_GRACE_MS = 15000;

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

  // Tunnel wrapping: on tunnel rows (type 4 at the horizontal edges),
  // walking off one side teleports the entity to the other side. This must
  // happen BEFORE the wall check — otherwise isWall() sees the out-of-bounds
  // coordinate and treats it as a wall, blocking the tunnel entrance.
  x = wrapTunnelX(x, pos.y, maze);

  // Apply wall collision per-axis so entities slide along walls
  let newX = x;
  let newY = y;
  if (isWall(x, pos.y, maze)) newX = pos.x;
  if (isWall(pos.x, y, maze)) newY = pos.y;

  return { x: newX, y: newY };
}

/**
 * Wrap an entity's X coordinate around the maze on tunnel rows.
 *
 * Classic Pac-Man tunnels let the player and ghosts walk off one horizontal
 * edge and reappear on the other. A tunnel row is identified by its leftmost
 * tile being type 4 (empty walkable tunnel). On those rows, when an entity's
 * x goes below 0 it wraps to just inside the right edge, and when it reaches
 * or exceeds the maze width it wraps to just inside the left edge.
 *
 * @param {number} x - The x coordinate to wrap (tile units, may be out of bounds).
 * @param {number} y - The y coordinate (determines whether we are on a tunnel row).
 * @param {number[][]} maze - The active maze.
 * @returns {number} The wrapped x coordinate (unchanged if not on a tunnel row).
 */
function wrapTunnelX(x, y, maze) {
  const tileY = Math.floor(y);
  if (tileY < 0 || tileY >= maze.length) return x;
  // Tunnel row: leftmost tile is type 4 (empty walkable tunnel).
  if (maze[tileY][0] !== 4) return x;
  const width = maze[0].length;
  if (x < 0) return x + width;
  if (x >= width) return x - width;
  return x;
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
 * @param {boolean} [isSinglePlayer=false] - True for a single-player match.
 *   In single-player the match does NOT end with one player remaining; it
 *   only ends when the player has lost all lives (players.length === 0 after
 *   the spectator-mode splice). Clearing all pellets advances the level.
 * @returns {null | 'GAME_OVER' | 'LEVEL_COMPLETE'} The transition to
 *   apply, or null if the level should continue.
 */
function getLevelTransition(players, pellets, powerPellets, isSinglePlayer = false) {
  if (isSinglePlayer) {
    // Single-player: the match ends only when the player has lost all lives
    // (removed from players[] and moved to spectators). One player remaining
    // means the game is still in progress.
    if (players.length === 0) return "GAME_OVER";
  } else {
    // Multiplayer: last man standing — the match is over.
    if (players.length <= 1) return "GAME_OVER";
  }
  // All pellets cleared — advance level (both modes).
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
 * Clamp an entity's center position so its circular body (given radius
 * in tile units) does not overlap any wall tile.
 *
 * The raw movement wall-check only gates the *center* coordinate, which
 * lets a large sprite (player radius ≈ 0.45 tiles) penetrate the wall
 * at the end of a corridor. This function pushes the center back until
 * the sprite edge sits flush against the wall boundary.
 *
 * @param {number} x - Center x in tile units.
 * @param {number} y - Center y in tile units.
 * @param {number} radius - Sprite radius in tile units.
 * @param {number[][]} maze - The maze grid.
 * @returns {{x: number, y: number}} Clamped position.
 */
function clampSpriteToWall(x, y, radius, maze) {
  // For each axis, check the tile under the sprite's leading edge.
  // If it's a wall, pull the center back so the edge sits on the
  // wall boundary.
  var tileY = Math.floor(y);
  var width = maze[0].length;
  // Tunnel rows wrap horizontally: the left edge at x=0 connects to
  // the right edge at x=width. On those rows we must NOT clamp an
  // out-of-bounds edge tile as a wall, or the player gets pinned
  // ~0.45 tiles short of the edge and can never teleport across.
  var isTunnelRow = tileY >= 0 && tileY < maze.length && maze[tileY][0] === 4;
  var rightTile = Math.floor(x + radius);
  if (isWall(rightTile, tileY, maze)) {
    // On a tunnel row, an out-of-bounds right edge wraps to the left
    // side — skip the clamp so the player can reach the edge.
    if (!(isTunnelRow && rightTile >= width)) {
      x = rightTile - radius;
    }
  }
  var leftTile = Math.floor(x - radius);
  if (isWall(leftTile, tileY, maze)) {
    // On a tunnel row, an out-of-bounds left edge wraps to the right
    // side — skip the clamp so the player can reach the edge.
    if (!(isTunnelRow && leftTile < 0)) {
      x = leftTile + 1 + radius;
    }
  }
  var tileX = Math.floor(x);
  var bottomTile = Math.floor(y + radius);
  if (isWall(tileX, bottomTile, maze)) {
    y = bottomTile - radius;
  }
  var topTile = Math.floor(y - radius);
  if (isWall(tileX, topTile, maze)) {
    y = topTile + 1 + radius;
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
// Lobby helpers (pure). Used by server.js to manage the lobby → game → lobby
// lifecycle: warm rejoin, ready-up, countdown, and reconnection grace.
// ---------------------------------------------------------------------------

/**
 * Rebuild a lobby player list from a finished match so the group can stay
 * together for a rematch. The winner is placed first (becomes the new host);
 * all players start with ready = false.
 *
 * Each match player is expected to carry a stable `token` (generated at join
 * time) so the lobby can recognise reconnecting clients later.
 *
 * @param {Array} players - The match's players[] (each with id, name, token).
 * @param {string|null} winnerId - Player id of the winner, or null.
 * @returns {Array<{id: string, name: string, token: string, ready: boolean}>}
 */
function rebuildLobbyFromMatch(players, winnerId) {
  // Stable sort: winner first, otherwise preserve existing order.
  const ordered = [...players].sort((a, b) => {
    if (a.id === winnerId) return -1;
    if (b.id === winnerId) return 1;
    return 0;
  });
  // Match players carry `id` (=== token) but no separate `token` field, so
  // carry the id through as the token for the rebuilt lobby players.
  return ordered.map((p) => ({
    id: p.id,
    name: p.name,
    token: p.id,
    ready: false,
  }));
}

/**
 * Check whether every player in the lobby is marked ready.
 * Returns false for an empty lobby (nobody to start).
 *
 * @param {Array<{ready: boolean}>} lobbyPlayers
 * @returns {boolean}
 */
function areAllReady(lobbyPlayers) {
  return lobbyPlayers.length > 0 && lobbyPlayers.every((p) => p.ready);
}

/**
 * Toggle the ready state of a single lobby player, returning a new array.
 * Players are identified by their stable token.
 *
 * @param {Array<{token: string, ready: boolean}>} lobbyPlayers
 * @param {string} token - The player's stable token.
 * @returns {Array} New lobbyPlayers array with the toggle applied.
 */
function togglePlayerReady(lobbyPlayers, token) {
  // Match by id, since for lobby players the id IS the stable token.
  return lobbyPlayers.map((p) =>
    p.id === token ? { ...p, ready: !p.ready } : p
  );
}

/**
 * Map elapsed countdown time to the number the client should display.
 * 0-999ms → 3, 1000-1999ms → 2, 2000-2999ms → 1, >=3000ms → 0 (GO).
 *
 * @param {number} elapsedMs - Milliseconds since countdown began.
 * @returns {number} 3, 2, 1, or 0.
 */
function getCountdownTick(elapsedMs) {
  if (elapsedMs >= COUNTDOWN_DURATION_MS) return 0;
  return 3 - Math.floor(elapsedMs / 1000);
}

/**
 * Determine whether a disconnected player is still within the reconnection
 * grace period.
 *
 * @param {number} disconnectedAt - Date.now() when the disconnect happened.
 * @param {number} now - Current Date.now().
 * @returns {boolean}
 */
function isWithinGracePeriod(disconnectedAt, now) {
  return now - disconnectedAt < RECONNECT_GRACE_MS;
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
  clampSpriteToWall,
  wrapTunnelX,
  buildGameStatePayload,
  COUNTDOWN_DURATION_MS,
  RECONNECT_GRACE_MS,
  rebuildLobbyFromMatch,
  areAllReady,
  togglePlayerReady,
  getCountdownTick,
  isWithinGracePeriod,
};

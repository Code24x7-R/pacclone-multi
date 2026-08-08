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

const GAME_STATES = {
  LOBBY: "LOBBY",
  IN_PROGRESS: "IN_PROGRESS",
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
 * Validate a direction string.
 * @param {string} dir
 * @returns {boolean}
 */
function isValidDirection(dir) {
  return DIRECTIONS.includes(dir);
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
 * @param {string} currentGameState - One of GAME_STATES (LOBBY, IN_PROGRESS, GAME_OVER).
 * @returns {{maze: number[][], players: Array, ghosts: Array, pellets: Array, powerPellets: Array, currentGameState: string}}
 */
function buildGameStatePayload(maze, players, ghosts, pellets, powerPellets, currentGameState) {
  return { maze, players, ghosts, pellets, powerPellets, currentGameState };
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
  isWall,
  moveEntity,
  distance,
  isColliding,
  extractPellets,
  createInitialState,
  createPlayersFromLobby,
  randomDirection,
  checkGameOver,
  isValidDirection,
  buildGameStatePayload,
};

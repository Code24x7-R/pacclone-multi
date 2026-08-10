/**
 * ghostAI.js — Pure ghost AI logic for pacclone-multi.
 *
 * Ported from the single-player pacclone reference implementation.
 * All functions are deterministic (where possible) and side-effect free
 * so they can be unit-tested in isolation.
 *
 * Ghost personalities (classic Pac-Man):
 * - Blinky (red):   chases nearest player directly
 * - Pinky (pink):   ambushes 4 tiles ahead of nearest player
 * - Inky (cyan):    flanks using vector from Blinky through player
 * - Clyde (orange): chases if far (>8 tiles), scatters to corner if close
 *
 * Ghost state machine: inHouse → exitingHouse → scatter/chase → frightened → eaten → inHouse
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @type {Record<string, {color: string, scatterTarget: {tileX: number, tileY: number}}>} */
const GHOST_PERSONALITIES = {
  blinky: { color: "red" },
  pinky: { color: "pink" },
  inky: { color: "cyan" },
  clyde: { color: "orange" },
};

const GHOST_NAMES = {
  blinky: "Blinky",
  pinky: "Pinky",
  inky: "Inky",
  clyde: "Clyde",
};

// Scatter-mode corner targets (in tile coordinates, will be scaled per maze)
const SCATTER_CORNERS = {
  blinky: { tileX: "right", tileY: "top" }, // top-right
  pinky: { tileX: "left", tileY: "top" }, // top-left
  inky: { tileX: "right", tileY: "bottom" }, // bottom-right
  clyde: { tileX: "left", tileY: "bottom" }, // bottom-left
};

// Mode cycle timings (ms): classic Pac-Man scatter/chase phases
const MODE_CYCLE = [
  { duration: 7000, mode: "scatter" },
  { duration: 20000, mode: "chase" },
  { duration: 7000, mode: "scatter" },
  { duration: 20000, mode: "chase" },
  { duration: 5000, mode: "scatter" },
  { duration: 20000, mode: "chase" },
  { duration: 5000, mode: "scatter" },
  { duration: Infinity, mode: "chase" },
];

// Pellet release thresholds (ghost leaves house after N pellets eaten)
const RELEASE_THRESHOLDS = {
  blinky: 0,
  pinky: 15,
  inky: 30,
  clyde: 50,
};

// Scoring
const GHOST_EAT_SCORE = 200;

// Timing
const FRIGHTENED_DURATION_MS = 8000;
const GHOST_RETURN_DELAY_MS = 5000;

// Speed multipliers (relative to base movement speed)
const GHOST_NORMAL_SPEED = 0.8;
const GHOST_FRIGHTENED_SPEED = 0.5;
const GHOST_EATEN_SPEED = 1.5;

// Direction vectors (tile units)
const DIRECTION_VECTORS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const DIRECTION_NAMES = ["up", "down", "left", "right"];

// Opposite directions (for U-turn prevention)
const OPPOSITE = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

// ---------------------------------------------------------------------------
// Ghost creation
// ---------------------------------------------------------------------------

/**
 * Create a ghost object for a given personality.
 * @param {string} personality - One of 'blinky', 'pinky', 'inky', 'clyde'.
 * @param {{centerX: number, centerY: number}} houseConfig - Ghost house center position.
 * @returns {Object} Ghost object.
 */
function createGhost(personality, houseConfig) {
  const colors = GHOST_PERSONALITIES[personality];
  // Stagger starting positions inside the house
  const offsets = {
    blinky: { x: 0, y: -2 }, // Blinky starts outside (above gate)
    pinky: { x: 0, y: 0 },
    inky: { x: -1, y: 0 },
    clyde: { x: 1, y: 0 },
  };
  const offset = offsets[personality] || { x: 0, y: 0 };
  const isBlinky = personality === "blinky";

  return {
    id: personality,
    name: GHOST_NAMES[personality],
    x: houseConfig.centerX + offset.x,
    y: houseConfig.centerY + offset.y,
    color: colors.color,
    direction: "left",
    state: isBlinky ? "scatter" : "inHouse",
    mode: "scatter",
    frightened: false,
    eaten: false,
    speed: GHOST_NORMAL_SPEED,
    originalX: houseConfig.centerX,
    originalY: houseConfig.centerY,
    idleTimer: Math.random() * 1000,
    reReleaseTimer: 0,
  };
}

/**
 * Create the initial set of 4 ghosts.
 * @param {{centerX: number, centerY: number}} houseConfig
 * @returns {Object[]} Array of 4 ghost objects.
 */
function createInitialGhosts(houseConfig) {
  return ["blinky", "pinky", "inky", "clyde"].map((p) => createGhost(p, houseConfig));
}

// ---------------------------------------------------------------------------
// Ghost house geometry
// ---------------------------------------------------------------------------

/**
 * Compute the default ghost house config from a maze layout.
 * Finds the gate tiles (type 6) and computes house center and exit points.
 * Supports gates on any side of the house (top, bottom, left, right).
 * @param {number[][]} maze
 * @returns {{centerX: number, centerY: number, exitX: number, exitY: number, gateX: number, gateY: number}}
 */
function getDefaultHouseConfig(maze) {
  const height = maze.length;
  const width = maze[0].length;

  // Collect all gate tiles
  const gateTiles = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < maze[y].length; x++) {
      if (maze[y][x] === 6) {
        gateTiles.push({ x, y });
      }
    }
  }

  if (gateTiles.length === 0) {
    // No gate found, return defaults
    return {
      centerX: width / 2,
      centerY: height / 2,
      exitX: width / 2,
      exitY: height / 2,
      gateX: -1,
      gateY: -1,
    };
  }

  // Find the bounding box of the gate tiles
  const minGateX = Math.min(...gateTiles.map(t => t.x));
  const maxGateX = Math.max(...gateTiles.map(t => t.x));
  const minGateY = Math.min(...gateTiles.map(t => t.y));
  const maxGateY = Math.max(...gateTiles.map(t => t.y));

  // Determine gate orientation based on gate tile positions and surrounding tiles.
  // For a single gate tile, check which side has walkable space (the exit side).
  // For multiple gate tiles, use their arrangement to determine orientation.
  const isHorizontalGate = maxGateX > minGateX;
  const isVerticalGate = maxGateY > minGateY;

  let centerX, centerY, exitX, exitY;

  if (isHorizontalGate) {
    // Gate tiles are arranged horizontally (top or bottom of house)
    const gateCenterX = (minGateX + maxGateX) / 2 + 0.5;
    const gateY = minGateY;
    // Check which side has walkable space (that's the exit side)
    const hasSpaceAbove = gateY > 0 && maze[gateY - 1][minGateX] !== 1;
    const hasSpaceBelow = gateY < height - 1 && maze[gateY + 1][minGateX] !== 1;

    if (hasSpaceAbove || !hasSpaceBelow) {
      // Exit is above the gate
      centerX = gateCenterX;
      centerY = gateY + 1.5;
      exitX = gateCenterX;
      exitY = gateY - 0.5;
    } else {
      // Exit is below the gate
      centerX = gateCenterX;
      centerY = gateY - 0.5;
      exitX = gateCenterX;
      exitY = gateY + 1.5;
    }
  } else if (isVerticalGate) {
    // Gate tiles are arranged vertically (left or right of house)
    const gateCenterY = (minGateY + maxGateY) / 2 + 0.5;
    const gateX = minGateX;
    // Check which side has walkable space (that's the exit side)
    const hasSpaceLeft = gateX > 0 && maze[minGateY][gateX - 1] !== 1;
    const hasSpaceRight = gateX < width - 1 && maze[minGateY][gateX + 1] !== 1;

    if (hasSpaceRight || !hasSpaceLeft) {
      // Exit is to the right of the gate
      centerX = gateX - 0.5;
      centerY = gateCenterY;
      exitX = gateX + 1.5;
      exitY = gateCenterY;
    } else {
      // Exit is to the left of the gate
      centerX = gateX + 1.5;
      centerY = gateCenterY;
      exitX = gateX - 0.5;
      exitY = gateCenterY;
    }
  } else {
    // Single gate tile - determine orientation by checking surrounding tiles
    const gx = minGateX;
    const gy = minGateY;
    const hasSpaceAbove = gy > 0 && maze[gy - 1][gx] !== 1;
    const hasSpaceBelow = gy < height - 1 && maze[gy + 1][gx] !== 1;
    const hasSpaceLeft = gx > 0 && maze[gy][gx - 1] !== 1;
    const hasSpaceRight = gx < width - 1 && maze[gy][gx + 1] !== 1;

    // The exit is on the side with walkable space
    if (hasSpaceAbove) {
      centerX = gx + 0.5;
      centerY = gy + 1.5;
      exitX = gx + 0.5;
      exitY = gy - 0.5;
    } else if (hasSpaceBelow) {
      centerX = gx + 0.5;
      centerY = gy - 0.5;
      exitX = gx + 0.5;
      exitY = gy + 1.5;
    } else if (hasSpaceRight) {
      centerX = gx - 0.5;
      centerY = gy + 0.5;
      exitX = gx + 1.5;
      exitY = gy + 0.5;
    } else {
      // hasSpaceLeft or default
      centerX = gx + 1.5;
      centerY = gy + 0.5;
      exitX = gx - 0.5;
      exitY = gy + 0.5;
    }
  }

  return {
    centerX,
    centerY,
    exitX,
    exitY,
    gateX: minGateX,
    gateY: minGateY,
  };
}

// ---------------------------------------------------------------------------
// Release logic
// ---------------------------------------------------------------------------

/**
 * Check if a ghost should be released from the house based on pellets eaten.
 * @param {string} personality
 * @param {number} pelletsEaten
 * @returns {boolean}
 */
function shouldReleaseGhost(personality, pelletsEaten) {
  const threshold = RELEASE_THRESHOLDS[personality];
  if (threshold === undefined) return false;
  return pelletsEaten >= threshold;
}

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

/**
 * Resolve a scatter corner to absolute tile coordinates.
 * @param {string} personality
 * @param {number} mazeWidth
 * @param {number} mazeHeight
 * @returns {{tileX: number, tileY: number}}
 */
function getScatterTarget(personality, mazeWidth, mazeHeight) {
  const corner = SCATTER_CORNERS[personality];
  const tileX = corner.tileX === "right" ? mazeWidth - 1 : 0;
  const tileY = corner.tileY === "bottom" ? mazeHeight - 1 : 0;
  return { tileX, tileY };
}

/**
 * Find the nearest player to a given position.
 * @param {{x: number, y: number}} from
 * @param {Array<{x: number, y: number}>} players
 * @returns {{x: number, y: number, direction?: string} | null}
 */
function findNearestPlayer(from, players) {
  if (!players || players.length === 0) return null;
  let nearest = players[0];
  let minDist = Infinity;
  for (const p of players) {
    const d = Math.hypot(from.x - p.x, from.y - p.y);
    if (d < minDist) {
      minDist = d;
      nearest = p;
    }
  }
  return nearest;
}

/**
 * Get the chase target tile for a ghost based on its personality.
 * Adapted for multiplayer: targets the nearest player.
 *
 * @param {string} personality
 * @param {Object[]} players - Active players with {x, y, direction}.
 * @param {Object} blinky - The Blinky ghost object (for Inky's targeting).
 * @param {number} mazeWidth
 * @param {number} mazeHeight
 * @returns {{tileX: number, tileY: number}}
 */
function getChaseTarget(personality, players, blinky, mazeWidth, mazeHeight) {
  const nearest = findNearestPlayer(
    { x: mazeWidth / 2, y: mazeHeight / 2 },
    players,
  );
  if (!nearest) {
    // No players: fall back to scatter
    return getScatterTarget(personality, mazeWidth, mazeHeight);
  }

  // Convert player tile position (nearest player is the target reference)
  const px = nearest.x;
  const py = nearest.y;
  // Player direction vector (default to left if not moving)
  const pdir = nearest.direction || "left";
  const pvec = DIRECTION_VECTORS[pdir] || { dx: 0, dy: 0 };

  switch (personality) {
    case "blinky":
      // Target nearest player directly
      return { tileX: Math.floor(px), tileY: Math.floor(py) };

    case "pinky": {
      // Target 4 tiles ahead of nearest player
      let targetX = px + pvec.dx * 4;
      let targetY = py + pvec.dy * 4;
      // Classic overflow bug: if moving up, also shift 4 tiles left
      if (pdir === "up") {
        targetX -= 4;
      }
      return { tileX: Math.floor(targetX), tileY: Math.floor(targetY) };
    }

    case "inky": {
      // Vector from Blinky through 2-tiles-ahead of player, doubled
      if (!blinky) {
        return { tileX: Math.floor(px), tileY: Math.floor(py) };
      }
      let aheadX = px + pvec.dx * 2;
      let aheadY = py + pvec.dy * 2;
      // Classic overflow bug for up direction
      if (pdir === "up") {
        aheadX -= 2;
      }
      const vecX = aheadX - blinky.x;
      const vecY = aheadY - blinky.y;
      return { tileX: Math.floor(blinky.x + 2 * vecX), tileY: Math.floor(blinky.y + 2 * vecY) };
    }

    case "clyde": {
      // Chase if far (>8 tiles), scatter if close
      const blinkyRef = blinky || { x: mazeWidth / 2, y: mazeHeight / 2 };
      const dist = Math.hypot(blinkyRef.x - px, blinkyRef.y - py);
      if (dist > 8) {
        return { tileX: Math.floor(px), tileY: Math.floor(py) };
      }
      return getScatterTarget("clyde", mazeWidth, mazeHeight);
    }

    default:
      return { tileX: Math.floor(px), tileY: Math.floor(py) };
  }
}

/**
 * Get the target tile for a ghost based on its current state and the global mode.
 *
 * @param {Object} ghost
 * @param {Object} context - { players, blinky, mode, mazeWidth, mazeHeight, houseConfig }
 * @returns {{tileX: number, tileY: number}}
 */
function getGhostTarget(ghost, context) {
  const { players, blinky, mode, mazeWidth, mazeHeight, houseConfig } = context;

  switch (ghost.state) {
    case "inHouse":
      // No target while in house (bob in place)
      return { tileX: Math.floor(ghost.x), tileY: Math.floor(ghost.y) };

    case "exitingHouse":
      // Target the exit point (just outside the gate)
      return { tileX: Math.floor(houseConfig.exitX), tileY: Math.floor(houseConfig.exitY) };

    case "eaten":
      // Target the house center
      return { tileX: Math.floor(houseConfig.centerX), tileY: Math.floor(houseConfig.centerY) };

    case "frightened":
      // Random target (caller should randomize; here we return a corner as placeholder)
      return getScatterTarget(ghost.id, mazeWidth, mazeHeight);

    case "scatter":
      return getScatterTarget(ghost.id, mazeWidth, mazeHeight);

    case "chase":
      return getChaseTarget(ghost.id, players, blinky, mazeWidth, mazeHeight);

    default:
      return getScatterTarget(ghost.id, mazeWidth, mazeHeight);
  }
}

// ---------------------------------------------------------------------------
// Movement helpers
// ---------------------------------------------------------------------------

/**
 * Check if a tile is walkable for a ghost in a given state.
 * @param {number[][]} maze
 * @param {number} tileX
 * @param {number} tileY
 * @param {string} ghostState
 * @param {number} mazeWidth
 * @param {number} mazeHeight
 * @returns {boolean}
 */
function isGhostWalkable(maze, tileX, tileY, ghostState, mazeWidth, mazeHeight) {
  // Handle tunnel wrapping for horizontal
  let wrappedX = tileX;
  if (tileX < 0) wrappedX = mazeWidth - 1;
  else if (tileX >= mazeWidth) wrappedX = 0;

  // Vertical bounds check
  if (tileY < 0 || tileY >= mazeHeight) {
    // Allow tunnel rows to wrap horizontally even if vertically out of bounds
    const currentTileY = Math.floor(tileY);
    if (currentTileY < 0 || currentTileY >= mazeHeight) {
      return false;
    }
  }

  if (tileY < 0 || tileY >= mazeHeight) return false;

  const tile = maze[tileY]?.[wrappedX];
  if (tile === undefined) return false;
  if (tile === 1) return false; // wall

  // Gate (type 6): passable for all ghost states (it's a corridor for ghosts).
  // Players treat it as a wall (see isWall in gameLogic.js).
  if (tile === 6) {
    return true;
  }

  return true;
}

/**
 * Get all walkable directions for a ghost at its current tile.
 * @param {Object} ghost
 * @param {number[][]} maze
 * @param {number} mazeWidth
 * @param {number} mazeHeight
 * @param {string[]} [directions] - Direction names to consider (default: all 4)
 * @returns {string[]} Walkable direction names.
 */
function getWalkableDirections(ghost, maze, mazeWidth, mazeHeight, directions = DIRECTION_NAMES) {
  const tileX = Math.floor(ghost.x);
  const tileY = Math.floor(ghost.y);
  const result = [];

  for (const dir of directions) {
    const vec = DIRECTION_VECTORS[dir];
    const nextX = tileX + vec.dx;
    const nextY = tileY + vec.dy;

    // Prevent U-turns unless frightened or no other option
    if (ghost.state !== "frightened" && OPPOSITE[dir] === ghost.direction && (ghost.direction)) {
      continue;
    }

    if (isGhostWalkable(maze, nextX, nextY, ghost.state, mazeWidth, mazeHeight)) {
      result.push(dir);
    }
  }

  return result;
}

/**
 * Choose the best direction for a ghost to move toward a target tile.
 * Picks the direction whose next tile center is closest to the target.
 * In frightened mode, picks the direction that maximizes distance (runs away).
 *
 * @param {Object} ghost
 * @param {{tileX: number, tileY: number}} target
 * @param {number[][]} maze
 * @param {number} mazeWidth
 * @param {number} mazeHeight
 * @returns {string} Chosen direction name.
 */
function chooseDirection(ghost, target, maze, mazeWidth, mazeHeight) {
  const tileX = Math.floor(ghost.x);
  const tileY = Math.floor(ghost.y);
  const walkable = getWalkableDirections(ghost, maze, mazeWidth, mazeHeight);

  // Filter out the reverse direction (no U-turns) unless it's the only option
  const noReverse = walkable.filter((d) => OPPOSITE[d] !== ghost.direction);
  const candidates = noReverse.length > 0 ? noReverse : walkable;

  if (candidates.length === 0) {
    // Stuck: allow reverse
    const reverse = OPPOSITE[ghost.direction];
    return reverse || ghost.direction || "left";
  }

  let bestDir = candidates[0];
  let bestDist = Infinity;
  const maximize = ghost.state === "frightened";
  let bestScore = maximize ? -Infinity : Infinity;

  for (const dir of candidates) {
    const vec = DIRECTION_VECTORS[dir];
    const nextCenterX = tileX + vec.dx + 0.5;
    const nextCenterY = tileY + vec.dy + 0.5;
    const dist = Math.hypot(nextCenterX - (target.tileX + 0.5), nextCenterY - (target.tileY + 0.5));

    if (maximize) {
      if (dist > bestScore) {
        bestScore = dist;
        bestDir = dir;
      }
    } else {
      if (dist < bestScore) {
        bestScore = dist;
        bestDir = dir;
      }
    }
  }

  return bestDir;
}

// ---------------------------------------------------------------------------
// Tile-center detection
// ---------------------------------------------------------------------------

/**
 * Check if a ghost is at (or very near) a tile center.
 * @param {number} x
 * @param {number} y
 * @param {number} epsilon
 * @returns {boolean}
 */
function isAtTileCenter(x, y, epsilon = 0.02) {
  const fracX = x - Math.floor(x);
  const fracY = y - Math.floor(y);
  return Math.abs(fracX - 0.5) < epsilon && Math.abs(fracY - 0.5) < epsilon;
}

/**
 * Snap a ghost's position to the nearest tile center.
 * @param {Object} ghost
 * @returns {Object} New position {x, y}.
 */
function snapToTileCenter(ghost) {
  return {
    x: Math.floor(ghost.x) + 0.5,
    y: Math.floor(ghost.y) + 0.5,
  };
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Update a ghost's house state (inHouse → exitingHouse transitions).
 * Handles bobbing, release thresholds, and re-release timers.
 *
 * @param {Object} ghost - Ghost object (mutated in place).
 * @param {Object} context - { pelletsEaten, deltaTime, frightenedTimer }
 */
function updateGhostHouseState(ghost, context) {
  const { pelletsEaten, deltaTime, frightenedTimer } = context;

  if (ghost.state === "inHouse") {
    // Bob up and down (visual effect; position handled by caller)
    ghost.idleTimer = (ghost.idleTimer || 0) + deltaTime;

    // Check re-release timer (after being eaten)
    if (ghost.reReleaseTimer > 0) {
      ghost.reReleaseTimer -= deltaTime;
      if (ghost.reReleaseTimer <= 0) {
        ghost.reReleaseTimer = 0;
        ghost.x = ghost.originalX;
        ghost.y = ghost.originalY;
        ghost.state = "exitingHouse";
        return;
      }
    }

    // Check pellet-based release
    if (shouldReleaseGhost(ghost.id, pelletsEaten)) {
      ghost.x = ghost.originalX;
      ghost.y = ghost.originalY;
      ghost.state = "exitingHouse";
    }
  }

  if (ghost.state === "exitingHouse") {
    // Check if ghost has reached the exit tile
    const houseConfig = context.houseConfig;
    if (houseConfig) {
      const distToExit = Math.hypot(ghost.x - houseConfig.exitX, ghost.y - houseConfig.exitY);
      if (distToExit < 0.3) {
        ghost.x = houseConfig.exitX;
        ghost.y = houseConfig.exitY;
        // If power-up is active, ghost exits as frightened (blue)
        if (frightenedTimer > 0) {
          ghost.frightened = true;
          ghost.state = "frightened";
        } else {
          // Transition to current global mode
          ghost.state = context.globalMode || "scatter";
        }
      }
    }
  }

  if (ghost.state === "eaten") {
    // Check if ghost has returned to house center
    const houseConfig = context.houseConfig;
    if (houseConfig) {
      const distToCenter = Math.hypot(
        ghost.x - houseConfig.centerX,
        ghost.y - houseConfig.centerY,
      );
      if (distToCenter < 0.5) {
        ghost.x = ghost.originalX;
        ghost.y = ghost.originalY;
        ghost.eaten = false;
        ghost.frightened = false;
        ghost.speed = GHOST_NORMAL_SPEED;
        ghost.state = "inHouse";
        ghost.reReleaseTimer = GHOST_RETURN_DELAY_MS;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mode cycling
// ---------------------------------------------------------------------------

/**
 * Create a fresh mode cycle state.
 * @returns {{mode: string, timer: number, index: number}}
 */
function createModeCycle() {
  return {
    mode: MODE_CYCLE[0].mode,
    timer: MODE_CYCLE[0].duration,
    index: 0,
  };
}

/**
 * Update the mode cycle timer. Mutates and returns the cycle state.
 * @param {{mode: string, timer: number, index: number}} cycle
 * @param {number} deltaTime - Time elapsed in ms.
 * @returns {{mode: string, timer: number, index: number, changed: boolean}}
 */
function updateModeCycle(cycle, deltaTime) {
  let { mode, timer, index } = cycle;
  let changed = false;

  timer -= deltaTime;
  while (timer <= 0 && index < MODE_CYCLE.length - 1) {
    index++;
    mode = MODE_CYCLE[index].mode;
    timer += MODE_CYCLE[index].duration;
    changed = true;
  }

  return { mode, timer, index, changed };
}

/**
 * Determine whether a frightened ghost should render as the white "flash"
 * (near the end of the power-up). Classic Pac-Man flashes in the last third
 * of the frightened duration, toggling every 100ms.
 * @param {number} timerMs - Remaining frightened time in ms.
 * @param {number} [totalDurationMs=FRIGHTENED_DURATION_MS] - Total frightened
 *   duration in ms (may be scaled by level). The flash starts at 1/3 of this.
 * @returns {boolean} True if the ghost body should render white.
 */
function shouldGhostFlash(timerMs, totalDurationMs = FRIGHTENED_DURATION_MS) {
  if (timerMs <= 0) return false;
  const oneThird = totalDurationMs / 3;
  if (timerMs >= oneThird) return false;
  return Math.floor(timerMs / 100) % 2 === 0;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Constants
  GHOST_EAT_SCORE,
  GHOST_NORMAL_SPEED,
  GHOST_FRIGHTENED_SPEED,
  GHOST_EATEN_SPEED,
  DIRECTION_VECTORS,
  OPPOSITE,
  // Creation
  createGhost,
  createInitialGhosts,
  getDefaultHouseConfig,
  // Release
  shouldReleaseGhost,
  // Targeting
  getScatterTarget,
  findNearestPlayer,
  getChaseTarget,
  getGhostTarget,
  // Movement
  isGhostWalkable,
  getWalkableDirections,
  chooseDirection,
  isAtTileCenter,
  snapToTileCenter,
  // State
  updateGhostHouseState,
  // Mode cycling
  createModeCycle,
  updateModeCycle,
  // Frightened visuals
  shouldGhostFlash,
};

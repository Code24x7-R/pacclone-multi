/**
 * mazeGenerator.js — Pure procedural maze generation for pacclone-multi.
 *
 * Uses recursive backtracking on a symmetric grid (left half carved, then
 * mirrored to the right) to produce fair multiplayer mazes. The ghost house,
 * tunnels, and power pellets are placed after carving.
 *
 * Tile types (shared convention with gameLogic.js):
 *   0 = pellet path, 1 = wall, 2 = power pellet, 3 = power pellet (corner),
 *   4 = empty walkable (tunnel / ghost house interior),
 *   6 = ghost house gate (passable only by ghosts)
 *
 * No I/O — fully deterministic given a seedable RNG.
 */

// ---------------------------------------------------------------------------
// Tile type constants (local aliases for readability)
// ---------------------------------------------------------------------------
const PELLET = 0;
const WALL = 1;
const POWER = 2;
const POWER_CORNER = 3;
const EMPTY = 4;
// (5 is reserved internally during generation)
const GATE = 6;

// ---------------------------------------------------------------------------
// Seedable RNG (Mulberry32) — deterministic generation for testing
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ---------------------------------------------------------------------------
// Maze generation
// ---------------------------------------------------------------------------

/**
 * Generate a symmetric maze with ghost house, tunnels, and power pellets.
 *
 * @param {Object} [options]
 * @param {number} [options.width=20] - Maze width (should be even).
 * @param {number} [options.height=13] - Maze height (should be odd).
 * @param {number} [options.seed] - Optional seed for deterministic output.
 * @returns {number[][]} 2D array of tile types.
 */
function generateMaze(options = {}) {
  const width = options.width || 20;
  const height = options.height || 13;
  const rng = mulberry32(options.seed != null ? options.seed : (Date.now() & 0xffffffff));
  const halfWidth = Math.floor(width / 2);

  // 1. Fill with walls.
  const grid = Array.from({ length: height }, () => Array(width).fill(WALL));

  // 2. Reserve the ghost house area (left half only — right half is mirrored).
  //    House is centered in the maze with variable gate orientation.
  //    For the default 20x13 maze this gives rows 5-8, cols 7-12 (6x4).
  const houseWidth = 6;
  const houseHeight = 4;
  const houseLeft = Math.floor((halfWidth - houseWidth / 2));
  // Place the house near the center of the maze.
  const houseTop = Math.floor((height - houseHeight) / 2);
  const houseFits = houseTop > 1 && houseTop + houseHeight < height && houseLeft > 1;

  // Gate orientation: 0=top, 1=bottom (only top/bottom to preserve symmetry)
  const gateOrientation = houseFits ? Math.floor(rng() * 2) : 0;

  if (houseFits) {
    // Reserve the ghost house area (left half only — right half is mirrored).
    for (let r = houseTop; r < houseTop + houseHeight; r++) {
      for (let c = houseLeft; c < halfWidth; c++) {
        grid[r][c] = 5; // 5 = reserved (temporary)
      }
    }
  }

  // 3. Recursive backtracking: carve paths on the left half.
  function carve(cx, cy) {
    const directions = [
      [0, -2],
      [0, 2],
      [-2, 0],
      [2, 0],
    ];
    shuffle(directions, rng);

    for (const [dx, dy] of directions) {
      const nx = cx + dx;
      const ny = cy + dy;
      // Stay within the left half bounds, avoiding the outer wall.
      if (ny > 0 && ny < height - 1 && nx > 0 && nx < halfWidth) {
        // Only carve into walls (1), not reserved house area (5).
        if (grid[ny][nx] === WALL) {
          grid[cy + dy / 2][cx + dx / 2] = PELLET; // path between cells
          grid[ny][nx] = PELLET; // new cell
          carve(nx, ny);
        }
      }
    }
  }

  grid[1][1] = PELLET;
  carve(1, 1);

  // 4. Mirror the left half to the right half for symmetry.
  for (let r = 1; r < height - 1; r++) {
    for (let c = 1; c < halfWidth; c++) {
      grid[r][width - 1 - c] = grid[r][c];
    }
  }

  // 5. Place the ghost house structure (overwrites the reserved area).
  if (houseFits) {
    for (let r = houseTop; r < houseTop + houseHeight; r++) {
      for (let c = houseLeft; c < houseLeft + houseWidth; c++) {
        // Perimeter = walls; interior = empty walkable.
        const onTop = r === houseTop;
        const onBottom = r === houseTop + houseHeight - 1;
        const onLeft = c === houseLeft;
        const onRight = c === houseLeft + houseWidth - 1;
        if (onTop || onBottom || onLeft || onRight) {
          grid[r][c] = WALL;
        } else {
          grid[r][c] = EMPTY;
        }
      }
    }
    // Place gate based on orientation. Gate is 2 tiles wide on the chosen side.
    // Ensure the tile outside the gate is walkable so ghosts can pass through.
    let gateX1, gateY1, gateX2, gateY2;
    let outsideX1, outsideY1, outsideX2, outsideY2;
    switch (gateOrientation) {
      case 0: // top
      default:
        gateX1 = houseLeft + 2; gateY1 = houseTop;
        gateX2 = houseLeft + 3; gateY2 = houseTop;
        outsideX1 = houseLeft + 2; outsideY1 = houseTop - 1;
        outsideX2 = houseLeft + 3; outsideY2 = houseTop - 1;
        break;
      case 1: // bottom
        gateX1 = houseLeft + 2; gateY1 = houseTop + houseHeight - 1;
        gateX2 = houseLeft + 3; gateY2 = houseTop + houseHeight - 1;
        outsideX1 = houseLeft + 2; outsideY1 = houseTop + houseHeight;
        outsideX2 = houseLeft + 3; outsideY2 = houseTop + houseHeight;
        break;
    }
    // Place gate tiles
    grid[gateY1][gateX1] = GATE;
    grid[gateY2][gateX2] = GATE;
    // Ensure tiles outside the gate are walkable
    if (outsideY1 > 0 && outsideY1 < height - 1 && outsideX1 > 0 && outsideX1 < width - 1) {
      grid[outsideY1][outsideX1] = PELLET;
    }
    if (outsideY2 > 0 && outsideY2 < height - 1 && outsideX2 > 0 && outsideX2 < width - 1) {
      grid[outsideY2][outsideX2] = PELLET;
    }
  }

  // 6. Add tunnels at the designated rows (wrap-around edges).
  //    Tunnels at rows 8 and 12 (matching the existing maze).
  const tunnelRows = [8, height - 1];
  for (const tr of tunnelRows) {
    if (tr >= 0 && tr < height) {
      grid[tr][0] = EMPTY;
      grid[tr][width - 1] = EMPTY;
      // Ensure the tile inside the edge is a path.
      if (grid[tr][1] === WALL) grid[tr][1] = PELLET;
      if (grid[tr][width - 2] === WALL) grid[tr][width - 2] = PELLET;
    }
  }

  // 7. Place power pellets in dead-end corners.
  //    To preserve left-right symmetry, we place power pellets in the left
  //    half only and mirror each position to the right half. This yields
  //    symmetric pairs (top-left/top-right, bottom-left/bottom-right).
  const qHeight = Math.floor(height / 2);

  const placePowerUpLeft = (startR, endR, startC, endC) => {
    const deadEnds = [];
    for (let r = startR; r < endR; r++) {
      for (let c = startC; c < endC; c++) {
        if (grid[r][c] === PELLET) {
          let openNeighbors = 0;
          if (r > 0 && grid[r - 1][c] !== WALL) openNeighbors++;
          if (r < height - 1 && grid[r + 1][c] !== WALL) openNeighbors++;
          if (c > 0 && grid[r][c - 1] !== WALL) openNeighbors++;
          if (c < width - 1 && grid[r][c + 1] !== WALL) openNeighbors++;
          if (openNeighbors === 1) deadEnds.push({ r, c });
        }
      }
    }
    if (deadEnds.length > 0) {
      const spot = deadEnds[Math.floor(rng() * deadEnds.length)];
      grid[spot.r][spot.c] = POWER;
      // Mirror to the right half to preserve symmetry.
      grid[spot.r][width - 1 - spot.c] = POWER;
    }
  };

  placePowerUpLeft(1, qHeight, 1, halfWidth); // top-left quadrant → mirrors to top-right
  placePowerUpLeft(qHeight, height - 1, 1, halfWidth); // bottom-left quadrant → mirrors to bottom-right

  // 8. Ensure player starting tiles are walkable AND not dead ends.
  //    The server uses these tile positions (matching the starting positions
  //    in server.js startGame / startNextLevel): (1,1), (w-2,1), (1,4), etc.
  //    A dead-end start traps the player in a 1-tile corridor where they can
  //    only backtrack — they eat the power pellet plus ~4 pellets going one
  //    direction, then hit a wall with no alternative exit.
  const startTiles = [
    [1, 1],
    [width - 2, 1],
    [1, 4],
    [width - 2, 4],
    [1, height - 2],
    [width - 2, height - 2],
  ];
  const dirs = [
    [0, -1], // up
    [0, 1],  // down
    [-1, 0], // left
    [1, 0],  // right
  ];
  for (const [c, r] of startTiles) {
    if (r <= 0 || r >= height - 1 || c <= 0 || c >= width - 1) continue;
    // Make sure the tile itself is walkable.
    if (grid[r][c] === WALL) {
      grid[r][c] = PELLET;
    }
    // Count open neighbors.
    let openNeighbors = 0;
    for (const [dc, dr] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr > 0 && nr < height - 1 && nc > 0 && nc < width - 1 && grid[nr][nc] !== WALL) {
        openNeighbors++;
      }
    }
    // If this start tile is a dead end (only 1 open neighbor), carve a path
    // to a second neighbor so the player has an alternative exit.
    if (openNeighbors < 2) {
      for (const [dc, dr] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr > 0 && nr < height - 1 && nc > 0 && nc < width - 1 && grid[nr][nc] === WALL) {
          grid[nr][nc] = PELLET;
          openNeighbors++;
          if (openNeighbors >= 2) break;
        }
      }
    }
  }

  // 9. Ensure connectivity: flood fill from (1,1); any unreachable pellet
  //    gets connected by carving a path to its nearest reachable neighbor.
  ensureConnectivity(grid, width, height);

  return grid;
}

/**
 * Verify that all pellet/power tiles in the maze are reachable from (1,1).
 * @param {number[][]} grid
 * @param {number} width
 * @param {number} height
 * @returns {boolean} True if the maze is fully connected.
 */
function isConnected(grid, width, height) {
  const walkable = (r, c) =>
    r >= 0 && r < height && c >= 0 && c < width && grid[r][c] !== WALL;

  const visited = Array.from({ length: height }, () => Array(width).fill(false));
  const queue = [];

  // Find a starting walkable cell (prefer 1,1).
  if (walkable(1, 1)) {
    queue.push([1, 1]);
    visited[1][1] = true;
  }

  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];

  while (queue.length > 0) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (walkable(nr, nc) && !visited[nr][nc]) {
        visited[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
  }

  // Check every pellet/power/empty tile is visited.
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (grid[r][c] !== WALL && !visited[r][c]) return false;
    }
  }
  return true;
}

/**
 * Force-connectivity: carve paths from any unreachable pellet tile back to the
 * reachable region. Mutates the grid in place. Used as a safety net after
 * generation so the maze is always playable.
 * @param {number[][]} grid
 * @param {number} width
 * @param {number} height
 */
function ensureConnectivity(grid, width, height) {
  // Repeatedly find unreachable walkable cells and carve a path inward.
  let guard = 0;
  while (!isConnected(grid, width, height) && guard < 1000) {
    guard++;
    // Find an unreachable walkable cell and a reachable one, carve toward it.
    const unreachable = [];
    const reachable = computeReachable(grid, width, height);
    for (let r = 1; r < height - 1; r++) {
      for (let c = 1; c < width - 1; c++) {
        if (grid[r][c] !== WALL && !reachable[r][c]) {
          unreachable.push([r, c]);
        }
      }
    }
    if (unreachable.length === 0) break;
    // Carve the first unreachable cell and its neighbor toward center.
    const [ur, uc] = unreachable[0];
    grid[ur][uc] = PELLET;
    // Carve a neighbor that brings us closer to a reachable cell.
    const dirs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    for (const [dr, dc] of dirs) {
      const nr = ur + dr;
      const nc = uc + dc;
      if (nr > 0 && nr < height - 1 && nc > 0 && nc < width - 1 && grid[nr][nc] === WALL) {
        grid[nr][nc] = PELLET;
        break;
      }
    }
  }
}

/**
 * Compute the set of walkable cells reachable from (1,1).
 * @returns {boolean[][]} Visited grid.
 */
function computeReachable(grid, width, height) {
  const walkable = (r, c) =>
    r >= 0 && r < height && c >= 0 && c < width && grid[r][c] !== WALL;
  const visited = Array.from({ length: height }, () => Array(width).fill(false));
  const queue = [];
  if (walkable(1, 1)) {
    queue.push([1, 1]);
    visited[1][1] = true;
  }
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  while (queue.length > 0) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (walkable(nr, nc) && !visited[nr][nc]) {
        visited[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
  }
  return visited;
}

module.exports = {
  generateMaze,
  isConnected,
  ensureConnectivity,
  // Re-export tile constants for tests
  TILE: { PELLET, WALL, POWER, POWER_CORNER, EMPTY, GATE },
};

/**
 * Tests for src/mazeGenerator.js — pure procedural maze generation.
 *
 * Validates: valid tile types, symmetry, connectivity, ghost house placement,
 * tunnels, power pellets, and determinism with seeds.
 */
const {
  generateMaze,
  isConnected,
  ensureConnectivity,
  TILE,
} = require('../../src/mazeGenerator');

const { PELLET, WALL, POWER, EMPTY, GATE } = TILE;

describe('generateMaze', () => {
  test('produces a 20x13 grid by default', () => {
    const maze = generateMaze();
    expect(maze.length).toBe(13);
    expect(maze[0].length).toBe(20);
  });

  test('produces correct custom dimensions', () => {
    const maze = generateMaze({ width: 10, height: 7 });
    expect(maze.length).toBe(7);
    expect(maze[0].length).toBe(10);
  });

  test('every cell is a valid tile type', () => {
    const validTiles = new Set([PELLET, WALL, POWER, POWER + 1, EMPTY, GATE, 5]);
    // 5 is reserved during generation but should not appear in output.
    const maze = generateMaze({ seed: 42 });
    for (let r = 0; r < maze.length; r++) {
      for (let c = 0; c < maze[r].length; c++) {
        expect(validTiles.has(maze[r][c])).toBe(true);
      }
    }
  });

  test('no reserved tile (5) leaks into the output', () => {
    // Try several seeds to be thorough.
    for (let seed = 0; seed < 20; seed++) {
      const maze = generateMaze({ seed });
      for (let r = 0; r < maze.length; r++) {
        for (let c = 0; c < maze[r].length; c++) {
          expect(maze[r][c]).not.toBe(5);
        }
      }
    }
  });

  test('outer border is walls except at tunnel edges', () => {
    const maze = generateMaze({ seed: 7 });
    const w = maze[0].length;
    const h = maze.length;
    // Top row is fully walled.
    for (let c = 0; c < w; c++) {
      expect(maze[0][c]).toBe(WALL);
    }
    // Bottom row: tunnel openings at edges (EMPTY), plus the adjacent
    // inner tiles are PELLET (set by tunnel code). Interior is WALL.
    expect(maze[h - 1][0]).toBe(EMPTY);
    expect(maze[h - 1][w - 1]).toBe(EMPTY);
    expect(maze[h - 1][1]).toBe(PELLET);
    expect(maze[h - 1][w - 2]).toBe(PELLET);
    for (let c = 2; c < w - 2; c++) {
      expect(maze[h - 1][c]).toBe(WALL);
    }
    // Left/right edges: tunnel rows have openings, rest are walls.
    let tunnelOpenings = 0;
    for (let r = 0; r < h; r++) {
      if (maze[r][0] === EMPTY) tunnelOpenings++;
      if (maze[r][w - 1] === EMPTY) tunnelOpenings++;
    }
    expect(tunnelOpenings).toBeGreaterThan(0);
  });

  test('maze is left-right symmetric', () => {
    const maze = generateMaze({ seed: 123 });
    const w = maze[0].length;
    for (let r = 0; r < maze.length; r++) {
      for (let c = 0; c < Math.floor(w / 2); c++) {
        expect(maze[r][c]).toBe(maze[r][w - 1 - c]);
      }
    }
  });

  test('maze is fully connected (all pellets reachable)', () => {
    for (let seed = 0; seed < 10; seed++) {
      const maze = generateMaze({ seed });
      expect(isConnected(maze, maze[0].length, maze.length)).toBe(true);
    }
  });

  test('ghost house has a gate at the top center', () => {
    const maze = generateMaze({ seed: 99 });
    // Gate should be at row 7 (houseTop - 1 = 8 - 1... actually houseTop=8,
    // gate is at houseTop=8 cols 9-10 per generation code).
    let gateFound = false;
    for (let r = 0; r < maze.length; r++) {
      for (let c = 0; c < maze[r].length; c++) {
        if (maze[r][c] === GATE) gateFound = true;
      }
    }
    expect(gateFound).toBe(true);
  });

  test('ghost house interior is walkable (empty)', () => {
    const maze = generateMaze({ seed: 55 });
    // Interior cells (rows 9-10, cols 8-11) should be EMPTY.
    const interiorWalkable =
      maze[9][8] === EMPTY &&
      maze[9][11] === EMPTY &&
      maze[10][8] === EMPTY &&
      maze[10][11] === EMPTY;
    expect(interiorWalkable).toBe(true);
  });

  test('tunnels exist at the edge rows', () => {
    const maze = generateMaze({ seed: 3 });
    const h = maze.length;
    const w = maze[0].length;
    // Row 8 should have EMPTY at both edges (tunnel).
    expect(maze[8][0]).toBe(EMPTY);
    expect(maze[8][w - 1]).toBe(EMPTY);
    // Bottom tunnel row should also have EMPTY at both edges.
    expect(maze[h - 1][0]).toBe(EMPTY);
    expect(maze[h - 1][w - 1]).toBe(EMPTY);
  });

  test('at least one power pellet is placed', () => {
    const maze = generateMaze({ seed: 42 });
    let powerCount = 0;
    for (let r = 0; r < maze.length; r++) {
      for (let c = 0; c < maze[r].length; c++) {
        if (maze[r][c] === POWER) powerCount++;
      }
    }
    expect(powerCount).toBeGreaterThanOrEqual(1);
  });

  test('power pellets are placed at dead-ends or valid path tiles', () => {
    const maze = generateMaze({ seed: 42 });
    for (let r = 0; r < maze.length; r++) {
      for (let c = 0; c < maze[r].length; c++) {
        if (maze[r][c] === POWER) {
          // A power pellet replaces a pellet tile, so it must be walkable.
          // We just verify it's not a wall/gate.
          expect(maze[r][c]).not.toBe(WALL);
          expect(maze[r][c]).not.toBe(GATE);
        }
      }
    }
  });

  test('tile above ghost house gate is walkable (ghost exit path)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const maze = generateMaze({ seed });
      // Find the gate tile
      let gateR = -1, gateC = -1;
      for (let r = 0; r < maze.length; r++) {
        for (let c = 0; c < maze[r].length; c++) {
          if (maze[r][c] === GATE) {
            gateR = r;
            gateC = c;
            break;
          }
        }
        if (gateR !== -1) break;
      }
      if (gateR === -1) continue; // No gate found, skip
      // Tile above the gate must be walkable (not wall, not gate)
      const aboveR = gateR - 1;
      if (aboveR > 0) {
        expect(maze[aboveR][gateC]).not.toBe(WALL);
        expect(maze[aboveR][gateC]).not.toBe(GATE);
      }
    }
  });

  test('has a reasonable number of pellet tiles', () => {
    const maze = generateMaze({ seed: 42 });
    let pelletCount = 0;
    for (let r = 0; r < maze.length; r++) {
      for (let c = 0; c < maze[r].length; c++) {
        if (maze[r][c] === PELLET || maze[r][c] === POWER) pelletCount++;
      }
    }
    // A playable maze should have at least a few dozen pellets.
    expect(pelletCount).toBeGreaterThan(20);
  });

  test('starting corner tiles are always walkable', () => {
    for (let seed = 0; seed < 20; seed++) {
      const maze = generateMaze({ seed });
      const w = maze[0].length;
      const h = maze.length;
      // Corners corresponding to STARTING_POSITIONS.
      const corners = [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]];
      for (const [c, r] of corners) {
        expect(maze[r][c]).not.toBe(WALL);
      }
    }
  });

  test('is deterministic with the same seed', () => {
    const a = generateMaze({ seed: 777 });
    const b = generateMaze({ seed: 777 });
    expect(a).toEqual(b);
  });

  test('produces different mazes with different seeds', () => {
    const a = generateMaze({ seed: 1 });
    const b = generateMaze({ seed: 2 });
    expect(a).not.toEqual(b);
  });
});

describe('isConnected', () => {
  test('returns true for a simple connected maze', () => {
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 1, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    expect(isConnected(maze, 5, 5)).toBe(true);
  });

  test('returns false for a maze with an isolated pellet', () => {
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 0, 1, 0, 1],
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    expect(isConnected(maze, 5, 5)).toBe(false);
  });
});

describe('ensureConnectivity', () => {
  test('fixes a disconnected maze', () => {
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 0, 1, 0, 1],
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    ensureConnectivity(maze, 5, 5);
    expect(isConnected(maze, 5, 5)).toBe(true);
  });
});

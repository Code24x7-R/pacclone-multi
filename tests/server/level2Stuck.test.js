/**
 * Reproduction test for: Player gets stuck after clearing level 1 and
 * starting level 2. After moving across 5+ pellets, the player cannot
 * move outside areas where pellets have been consumed.
 *
 * Hypothesis: The clampSpriteToWall function may be pinning the player
 * in certain configurations, or the maze generation for level 2 creates
 * a configuration where the player gets trapped.
 */

const { generateMaze, isConnected } = require('../../src/mazeGenerator');
const { clampSpriteToWall, isWall, snapPerpendicular } = require('../../src/gameLogic');

const TILE_SIZE = 40;
const PLAYER_SPEED = 0.05;
const PLAYER_RADIUS = (TILE_SIZE / 2 - 2) / TILE_SIZE; // ≈ 0.45 tiles

/**
 * Simulate player movement for a given number of ticks.
 * Returns the final position and whether the player got stuck.
 */
function simulateMovement(maze, startX, startY, direction, ticks) {
  let x = startX;
  let y = startY;
  let prevX = x;
  let prevY = y;
  let stuckTicks = 0;

  for (let i = 0; i < ticks; i++) {
    prevX = x;
    prevY = y;

    // Calculate next position
    let nextX = x;
    let nextY = y;
    switch (direction) {
      case 'up': nextY -= PLAYER_SPEED; break;
      case 'down': nextY += PLAYER_SPEED; break;
      case 'left': nextX -= PLAYER_SPEED; break;
      case 'right': nextX += PLAYER_SPEED; break;
    }

    // Wall check (axis-separated)
    if (!isWall(nextX, y, maze)) x = nextX;
    if (!isWall(x, nextY, maze)) y = nextY;

    // Clamp to wall
    const clamped = clampSpriteToWall(x, y, PLAYER_RADIUS, maze);
    x = clamped.x;
    y = clamped.y;

    // Check if player moved
    if (Math.abs(x - prevX) < 0.001 && Math.abs(y - prevY) < 0.001) {
      stuckTicks++;
    } else {
      stuckTicks = 0;
    }
  }

  return { x, y, stuckTicks };
}

/**
 * Check if a position is stuck (cannot move in any direction).
 */
function isStuck(maze, x, y) {
  const directions = ['up', 'down', 'left', 'right'];
  for (const dir of directions) {
    let nextX = x;
    let nextY = y;
    switch (dir) {
      case 'up': nextY -= PLAYER_SPEED; break;
      case 'down': nextY += PLAYER_SPEED; break;
      case 'left': nextX -= PLAYER_SPEED; break;
      case 'right': nextX += PLAYER_SPEED; break;
    }

    // Wall check
    let newX = x;
    let newY = y;
    if (!isWall(nextX, y, maze)) newX = nextX;
    if (!isWall(x, nextY, maze)) newY = nextY;

    // Clamp
    const clamped = clampSpriteToWall(newX, newY, PLAYER_RADIUS, maze);
    newX = clamped.x;
    newY = clamped.y;

    // If we moved, not stuck
    if (Math.abs(newX - x) > 0.001 || Math.abs(newY - y) > 0.001) {
      return false;
    }
  }
  return true;
}

describe('Level 2 stuck bug reproduction', () => {
  test('maze is connected after generation', () => {
    for (let seed = 0; seed < 100; seed++) {
      const maze = generateMaze({ seed });
      expect(isConnected(maze, maze[0].length, maze.length)).toBe(true);
    }
  });

  test('player can move from starting position (1.5, 1.5)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const maze = generateMaze({ seed });
      const startX = 1.5;
      const startY = 1.5;

      // Try moving in each direction
      const directions = ['up', 'down', 'left', 'right'];
      let canMove = false;

      for (const dir of directions) {
        const result = simulateMovement(maze, startX, startY, dir, 10);
        if (result.stuckTicks < 10) {
          canMove = true;
          break;
        }
      }

      expect(canMove).toBe(true);
    }
  });

  test('player does not get stuck after moving through corridor', () => {
    // Simulate a player moving through a corridor and eating pellets
    for (let seed = 0; seed < 50; seed++) {
      const maze = generateMaze({ seed });
      let x = 1.5;
      let y = 1.5;

      // Simulate moving right for 20 ticks
      for (let i = 0; i < 20; i++) {
        const nextX = x + PLAYER_SPEED;

        // Wall check
        if (!isWall(nextX, y, maze)) {
          x = nextX;
        }

        // Clamp
        const clamped = clampSpriteToWall(x, y, PLAYER_RADIUS, maze);
        x = clamped.x;
        y = clamped.y;
      }

      // After moving, check if player is stuck
      const stuck = isStuck(maze, x, y);
      if (stuck) {
        console.log(`Seed ${seed}: Player stuck at (${x.toFixed(2)}, ${y.toFixed(2)})`);
        // Print the local area
        const tileX = Math.floor(x);
        const tileY = Math.floor(y);
        for (let dy = -2; dy <= 2; dy++) {
          let row = '';
          for (let dx = -2; dx <= 2; dx++) {
            const t = maze[tileY + dy]?.[tileX + dx];
            row += t === undefined ? '?' : t;
          }
          console.log(`  ${row}`);
        }
      }
      expect(stuck).toBe(false);
    }
  });

  test('clampSpriteToWall does not prevent movement in open corridor', () => {
    // Create a simple corridor maze
    // 1 1 1 1 1
    // 1 0 0 0 1
    // 1 1 1 1 1
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];

    // Player at (1.5, 1.5) moving right
    let x = 1.5;
    let y = 1.5;

    for (let i = 0; i < 10; i++) {
      const nextX = x + PLAYER_SPEED;
      if (!isWall(nextX, y, maze)) {
        x = nextX;
      }
      const clamped = clampSpriteToWall(x, y, PLAYER_RADIUS, maze);
      x = clamped.x;
      y = clamped.y;
    }

    // Player should have moved right
    expect(x).toBeGreaterThan(1.5);
  });

  test('clampSpriteToWall does not pin player at corridor end', () => {
    // Create a corridor that ends at a wall
    // 1 1 1 1 1
    // 1 0 0 1 1
    // 1 1 1 1 1
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 1, 1],
      [1, 1, 1, 1, 1],
    ];

    // Player at (1.5, 1.5) moving right
    let x = 1.5;
    let y = 1.5;

    for (let i = 0; i < 20; i++) {
      const nextX = x + PLAYER_SPEED;
      if (!isWall(nextX, y, maze)) {
        x = nextX;
      }
      const clamped = clampSpriteToWall(x, y, PLAYER_RADIUS, maze);
      x = clamped.x;
      y = clamped.y;
    }

    // Player should be near the wall but able to move back left
    const isCurrentlyStuck = isStuck(maze, x, y);
    expect(isCurrentlyStuck).toBe(false);
  });
});

/**
 * Tests for src/gameLogic.js — phase dash (executePhaseDash, updateDashState).
 *
 * Phase dash: teleport the player forward by DASH_TILES tiles in their
 * current direction. Available once per life (dashAvailable flag).
 * During the brief DASH_DURATION_TICKS visual effect the player is
 * invulnerable and cannot eat pellets.
 */
const {
  updateDashState,
  executePhaseDash,
  DASH_TILES,
  DASH_DURATION_TICKS,
} = require('../../src/gameLogic');

// A simple open maze for testing teleport distances.
const openMaze = Array.from({ length: 11 }, () =>
  Array.from({ length: 11 }, () => 0)
);
// Add walls around the border.
for (let x = 0; x < 11; x++) {
  openMaze[0][x] = 1;
  openMaze[10][x] = 1;
}
for (let y = 0; y < 11; y++) {
  openMaze[y][0] = 1;
  openMaze[y][10] = 1;
}

describe('DASH_TILES', () => {
  test('is 3 (teleports 3 tiles forward)', () => {
    expect(DASH_TILES).toBe(3);
  });
});

describe('DASH_DURATION_TICKS', () => {
  test('is 12 (~200ms at 60 FPS)', () => {
    expect(DASH_DURATION_TICKS).toBe(12);
  });
});

describe('updateDashState (visual-effect ticker)', () => {
  test('ticks down dashActiveTicks', () => {
    const result = updateDashState({ dashActiveTicks: 5 });
    expect(result.dashActiveTicks).toBe(4);
    expect(result.dashing).toBe(true);
  });

  test('reaches zero and clears dashing flag', () => {
    const result = updateDashState({ dashActiveTicks: 1 });
    expect(result.dashActiveTicks).toBe(0);
    expect(result.dashing).toBe(false);
  });

  test('stays at zero', () => {
    const result = updateDashState({ dashActiveTicks: 0 });
    expect(result.dashActiveTicks).toBe(0);
    expect(result.dashing).toBe(false);
  });
});

describe('executePhaseDash', () => {
  test('teleports player 3 tiles right', () => {
    const player = { x: 5.5, y: 5.5, direction: 'right', lastDirection: 'right', dashAvailable: true };
    const result = executePhaseDash(player, openMaze, 11, 11);
    expect(result.moved).toBe(true);
    expect(result.x).toBeCloseTo(8.5, 5);
    expect(result.y).toBeCloseTo(5.5, 5);
    expect(result.dashAvailable).toBe(false);
    expect(result.dashing).toBe(true);
    expect(result.dashActiveTicks).toBe(DASH_DURATION_TICKS);
  });

  test('teleports player 3 tiles down', () => {
    const player = { x: 5.5, y: 5.5, direction: 'down', lastDirection: 'down', dashAvailable: true };
    const result = executePhaseDash(player, openMaze, 11, 11);
    expect(result.moved).toBe(true);
    expect(result.x).toBeCloseTo(5.5, 5);
    expect(result.y).toBeCloseTo(8.5, 5);
  });

  test('teleports player 3 tiles left', () => {
    const player = { x: 5.5, y: 5.5, direction: 'left', lastDirection: 'left', dashAvailable: true };
    const result = executePhaseDash(player, openMaze, 11, 11);
    expect(result.moved).toBe(true);
    expect(result.x).toBeCloseTo(2.5, 5);
    expect(result.y).toBeCloseTo(5.5, 5);
  });

  test('teleports player 3 tiles up', () => {
    const player = { x: 5.5, y: 5.5, direction: 'up', lastDirection: 'up', dashAvailable: true };
    const result = executePhaseDash(player, openMaze, 11, 11);
    expect(result.moved).toBe(true);
    expect(result.x).toBeCloseTo(5.5, 5);
    expect(result.y).toBeCloseTo(2.5, 5);
  });

  test('cannot dash twice (dashAvailable = false)', () => {
    const player = { x: 5.5, y: 5.5, direction: 'right', lastDirection: 'right', dashAvailable: false };
    const result = executePhaseDash(player, openMaze, 11, 11);
    expect(result.moved).toBe(false);
    expect(result.x).toBe(5.5);
    expect(result.y).toBe(5.5);
  });

  test('cannot dash while already dashing', () => {
    const player = { x: 5.5, y: 5.5, direction: 'right', lastDirection: 'right', dashAvailable: true, dashing: true, dashActiveTicks: 5 };
    const result = executePhaseDash(player, openMaze, 11, 11);
    expect(result.moved).toBe(false);
  });

  test('cannot dash without a direction', () => {
    const player = { x: 5.5, y: 5.5, direction: null, lastDirection: null, dashAvailable: true };
    const result = executePhaseDash(player, openMaze, 11, 11);
    expect(result.moved).toBe(false);
  });

  test('uses lastDirection when current direction is null', () => {
    const player = { x: 5.5, y: 5.5, direction: null, lastDirection: 'right', dashAvailable: true };
    const result = executePhaseDash(player, openMaze, 11, 11);
    expect(result.moved).toBe(true);
    expect(result.x).toBeCloseTo(8.5, 5);
  });

  test('blocked by wall at target', () => {
    // Place a wall 3 tiles to the right.
    const mazeWithWall = openMaze.map(row => [...row]);
    mazeWithWall[5][8] = 1;
    const player = { x: 5.5, y: 5.5, direction: 'right', lastDirection: 'right', dashAvailable: true };
    const result = executePhaseDash(player, mazeWithWall, 11, 11);
    expect(result.moved).toBe(false);
  });

  test('blocked vertically (target out of bounds)', () => {
    const player = { x: 5.5, y: 1.5, direction: 'up', lastDirection: 'up', dashAvailable: true };
    const result = executePhaseDash(player, openMaze, 11, 11);
    expect(result.moved).toBe(false);
  });

  test('handles tunnel wrapping (left edge)', () => {
    // Create a tunnel row at row 5.
    const tunnelMaze = openMaze.map(row => [...row]);
    tunnelMaze[5][0] = 0; // tunnel
    tunnelMaze[5][10] = 0; // tunnel
    const player = { x: 1.5, y: 5.5, direction: 'left', lastDirection: 'left', dashAvailable: true };
    const result = executePhaseDash(player, tunnelMaze, 11, 11);
    // 1.5 - 3 = -1.5 → wraps to 11 - 1.5 = 9.5 (tileX = 8 after floor)
    // Actually: targetTileX = 1 + (-1)*3 = -2 → wraps to 11 + (-2) = 9 → center 9.5
    expect(result.moved).toBe(true);
    expect(result.x).toBeCloseTo(9.5, 5);
  });
});

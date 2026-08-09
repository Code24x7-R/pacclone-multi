/**
 * wrapTunnelX.test.js — Tests for the tunnel teleport (horizontal wrap).
 *
 * Classic Pac-Man tunnels let entities walk off one horizontal edge and
 * reappear on the other. A tunnel row is identified by its leftmost tile
 * being type 4 (empty walkable tunnel). On those rows, when x goes below 0
 * it wraps to just inside the right edge, and vice versa.
 */

const { wrapTunnelX, moveEntity, isWall, MAZE } = require('../../src/gameLogic');

describe('wrapTunnelX', () => {
  // Identify tunnel rows in the default maze (rows where col 0 is type 4).
  const tunnelRows = [];
  const nonTunnelRows = [];
  for (let y = 0; y < MAZE.length; y++) {
    if (MAZE[y][0] === 4) tunnelRows.push(y);
    else nonTunnelRows.push(y);
  }
  const width = MAZE[0].length; // 20

  test('default maze has at least one tunnel row', () => {
    expect(tunnelRows.length).toBeGreaterThan(0);
  });

  describe('on tunnel rows', () => {
    test('wraps x < 0 to the right side', () => {
      tunnelRows.forEach((row) => {
        expect(wrapTunnelX(-0.3, row + 0.5, MAZE)).toBeCloseTo(width - 0.3, 5);
        expect(wrapTunnelX(-1.0, row + 0.5, MAZE)).toBeCloseTo(width - 1.0, 5);
      });
    });

    test('wraps x >= width to the left side', () => {
      tunnelRows.forEach((row) => {
        expect(wrapTunnelX(width + 0.3, row + 0.5, MAZE)).toBeCloseTo(0.3, 5);
        expect(wrapTunnelX(width + 1.0, row + 0.5, MAZE)).toBeCloseTo(1.0, 5);
      });
    });

    test('leaves in-bounds x unchanged', () => {
      tunnelRows.forEach((row) => {
        expect(wrapTunnelX(0.0, row + 0.5, MAZE)).toBe(0.0);
        expect(wrapTunnelX(5.5, row + 0.5, MAZE)).toBe(5.5);
        expect(wrapTunnelX(width - 0.01, row + 0.5, MAZE)).toBeCloseTo(width - 0.01, 5);
      });
    });

    test('a full left-to-right teleport preserves fractional position', () => {
      // Player at x=0.2 moving left -> x=-0.1 -> wraps to width-0.1.
      const row = tunnelRows[0] + 0.5;
      const wrapped = wrapTunnelX(-0.1, row, MAZE);
      expect(wrapped).toBeCloseTo(width - 0.1, 5);
      // The fractional offset from the rightmost tile center (width-1+0.5) is
      // preserved: entity is 0.4 tiles left of the right-edge tile center.
      const rightTileCenter = (width - 1) + 0.5;
      expect(Math.abs(rightTileCenter - wrapped)).toBeCloseTo(0.4, 5);
    });
  });

  describe('on non-tunnel rows', () => {
    test('does NOT wrap — out-of-bounds x is returned unchanged', () => {
      nonTunnelRows.forEach((row) => {
        expect(wrapTunnelX(-0.3, row + 0.5, MAZE)).toBe(-0.3);
        expect(wrapTunnelX(width + 0.3, row + 0.5, MAZE)).toBe(width + 0.3);
      });
    });

    test('in-bounds x is unchanged', () => {
      nonTunnelRows.forEach((row) => {
        expect(wrapTunnelX(5.5, row + 0.5, MAZE)).toBe(5.5);
      });
    });
  });

  describe('edge cases', () => {
    test('vertical out-of-bounds returns x unchanged', () => {
      // Even on a tunnel column, if y is outside the maze, no wrap.
      expect(wrapTunnelX(-0.3, -1, MAZE)).toBe(-0.3);
      expect(wrapTunnelX(-0.3, MAZE.length + 5, MAZE)).toBe(-0.3);
    });

    test('x exactly at 0 is unchanged (not negative)', () => {
      tunnelRows.forEach((row) => {
        expect(wrapTunnelX(0, row + 0.5, MAZE)).toBe(0);
      });
    });

    test('x exactly at width wraps to 0', () => {
      tunnelRows.forEach((row) => {
        expect(wrapTunnelX(width, row + 0.5, MAZE)).toBe(0);
      });
    });

    test('works with a custom maze', () => {
      // A tiny 6-wide maze with a tunnel row at row 1.
      const maze = [
        [1, 1, 1, 1, 1, 1],
        [4, 0, 0, 0, 0, 4], // tunnel row
        [1, 1, 1, 1, 1, 1],
      ];
      expect(wrapTunnelX(-0.5, 1.5, maze)).toBeCloseTo(5.5, 5);
      expect(wrapTunnelX(6.5, 1.5, maze)).toBeCloseTo(0.5, 5);
      // Non-tunnel row (row 0): no wrap.
      expect(wrapTunnelX(-0.5, 0.5, maze)).toBe(-0.5);
    });
  });

  describe('default maze tunnel reachability', () => {
    test('tunnel entrance (row 8, col 4) is walkable, not a wall', () => {
      // The wall that used to block the tunnel (row 8 col 4) must be gone.
      // isWall() returns true for type 1 (wall) and false for type 4 (tunnel).
      expect(isWall(4.5, 8.5, MAZE)).toBe(false);
      // And the interior corridor leading to it (row 8 col 5) is also walkable.
      expect(isWall(5.5, 8.5, MAZE)).toBe(false);
    });

    test('a player can traverse the full tunnel from left to right', () => {
      // Start in the interior corridor at row 8, col 5, moving left.
      // Speed 0.1 per step (like PLAYER_SPEED). After enough steps the
      // entity walks through col 4 (tunnel entrance) into cols 3,2,1,0 and
      // wraps to the right edge.
      const speed = 0.1;
      let pos = { x: 5.5, y: 8.5 };

      // Move left from col 5 into the tunnel.
      for (let i = 0; i < 60; i++) {
        pos = moveEntity(pos, 'left', speed, MAZE);
      }
      // After ~55 steps the entity should have wrapped to the right side.
      expect(pos.x).toBeGreaterThan(10); // wrapped to right half
      expect(pos.y).toBe(8.5); // y unchanged (horizontal movement)
    });

    test('a player can traverse the full tunnel from right to left', () => {
      // Mirror: start at the right tunnel entrance, moving right.
      const speed = 0.1;
      let pos = { x: 14.5, y: 8.5 };

      // Move right from col 14 through the right tunnel (col 15 is now
      // walkable) into cols 16-19 and wrap to the left edge.
      for (let i = 0; i < 60; i++) {
        pos = moveEntity(pos, 'right', speed, MAZE);
      }
      expect(pos.x).toBeLessThan(10); // wrapped to left half
      expect(pos.y).toBe(8.5);
    });
  });
});

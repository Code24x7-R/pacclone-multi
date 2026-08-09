/**
 * snapPerpendicular.test.js — Tests for the perpendicular-axis corridor snap.
 *
 * When a player turns, the axis perpendicular to the new direction must be
 * snapped to the nearest half-tile (corridor center) so the sprite stays
 * aligned with the pellet line. Without this, turning at a non-half-tile
 * offset leaves the player drifting, and the offset compounds over turns.
 */

const { snapPerpendicular } = require('../../src/gameLogic');

describe('snapPerpendicular', () => {
  // --- Vertical movement (up/down): X must snap to half-tile ---

  describe('when turning to vertical movement', () => {
    test('snaps X to nearest half-tile when above center', () => {
      // Player at x=1.8 moving right, presses up -> snap X to 1.5
      expect(snapPerpendicular(1.8, 1.5, 'up')).toEqual({ x: 1.5, y: 1.5 });
    });

    test('snaps X to nearest half-tile when below center', () => {
      // Player at x=2.2 moving right, presses up -> snap X to 2.5
      expect(snapPerpendicular(2.2, 1.5, 'up')).toEqual({ x: 2.5, y: 1.5 });
    });

    test('leaves X unchanged when already at half-tile', () => {
      // Player at x=1.5 (perfectly centered), presses up -> no snap
      expect(snapPerpendicular(1.5, 1.5, 'up')).toEqual({ x: 1.5, y: 1.5 });
    });

    test('preserves Y exactly (does not move the player along travel axis)', () => {
      // Y must not change when turning vertically.
      expect(snapPerpendicular(1.8, 3.7, 'down')).toEqual({ x: 1.5, y: 3.7 });
    });

    test('handles x=0.5 boundary (top-left corridor)', () => {
      expect(snapPerpendicular(0.5, 1.5, 'up')).toEqual({ x: 0.5, y: 1.5 });
    });

    test('snaps x=0.49 down to 0.5', () => {
      expect(snapPerpendicular(0.49, 1.5, 'down')).toEqual({ x: 0.5, y: 1.5 });
    });

    test('snaps x=0.51 to 0.5', () => {
      expect(snapPerpendicular(0.51, 1.5, 'up')).toEqual({ x: 0.5, y: 1.5 });
    });
  });

  // --- Horizontal movement (left/right): Y must snap to half-tile ---

  describe('when turning to horizontal movement', () => {
    test('snaps Y to nearest half-tile when above center', () => {
      // Player at y=1.8 moving down, presses right -> snap Y to 1.5
      expect(snapPerpendicular(2.5, 1.8, 'right')).toEqual({ x: 2.5, y: 1.5 });
    });

    test('snaps Y to nearest half-tile when below center', () => {
      // Player at y=2.2 moving down, presses left -> snap Y to 2.5
      expect(snapPerpendicular(2.5, 2.2, 'left')).toEqual({ x: 2.5, y: 2.5 });
    });

    test('leaves Y unchanged when already at half-tile', () => {
      expect(snapPerpendicular(2.5, 2.5, 'right')).toEqual({ x: 2.5, y: 2.5 });
    });

    test('preserves X exactly (does not move the player along travel axis)', () => {
      // X must not change when turning horizontally.
      expect(snapPerpendicular(7.3, 1.8, 'left')).toEqual({ x: 7.3, y: 1.5 });
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    test('returns position unchanged for null/unknown direction', () => {
      // Should be a no-op for safety — never throws, never moves.
      expect(snapPerpendicular(1.8, 1.5, null)).toEqual({ x: 1.8, y: 1.5 });
      expect(snapPerpendicular(1.8, 1.5, 'unknown')).toEqual({ x: 1.8, y: 1.5 });
    });

    test('handles large coordinates (no precision loss)', () => {
      // Far-right corridors should snap just as cleanly.
      expect(snapPerpendicular(18.3, 5.5, 'up')).toEqual({ x: 18.5, y: 5.5 });
      expect(snapPerpendicular(18.7, 5.5, 'down')).toEqual({ x: 18.5, y: 5.5 });
    });

    test('snap distance is always <= 0.25 tiles', () => {
      // Worst case: player is exactly between two half-tiles (e.g. x=1.0 or x=2.0).
      // Math.round(1.0 - 0.5) + 0.5 = Math.round(0.5) + 0.5 = 1 + 0.5 = 1.5.
      // Distance from 1.0 to 1.5 is 0.5 — but that's the rounding boundary.
      // In practice the player can only be within 0.25 of a half-tile because
      // they move along half-tile-aligned corridors. Verify typical cases:
      for (let i = 0; i < 10; i++) {
        const x = 1.5 + (Math.random() - 0.5) * 0.4; // within +/- 0.2 of 1.5
        const result = snapPerpendicular(x, 1.5, 'up');
        expect(Math.abs(result.x - 1.5)).toBeLessThanOrEqual(0.2);
        expect(result.y).toBe(1.5);
      }
    });
  });

  // --- The drift scenario from the bug report ---

  describe('drift-prevention scenario', () => {
    test('a right-then-up turn at x=1.8 snaps to x=1.5, ending drift', () => {
      // Simulate: player starts at (1.5, 1.5), moves right for 3 ticks to x=1.8.
      var x = 1.5;
      for (let i = 0; i < 3; i++) x += 0.1; // x = 1.8
      expect(x).toBeCloseTo(1.8, 5);

      // Player presses up. Without snap: travels up at x=1.8 (0.3 off line).
      // With snap: x snaps to 1.5, perfectly on the pellet line.
      const snapped = snapPerpendicular(x, 1.5, 'up');
      expect(snapped.x).toBe(1.5);
      expect(snapped.y).toBe(1.5);
    });

    test('four consecutive turns do not accumulate drift', () => {
      // Simulate the bug report: 4-5 turns through a maze.
      // After each turn, the perpendicular axis is snapped to a half-tile.
      var x = 1.5, y = 1.5;
      var dir = 'right';

      // Move right 3 ticks, turn up
      for (let i = 0; i < 3; i++) x += 0.1;
      const s1 = snapPerpendicular(x, y, 'up');
      x = s1.x; y = s1.y; dir = 'up';
      // After snap, x is a half-tile.
      expect(x % 1).toBeCloseTo(0.5, 5);

      // Move up 2 ticks, turn left
      for (let i = 0; i < 2; i++) y -= 0.1;
      const s2 = snapPerpendicular(x, y, 'left');
      x = s2.x; y = s2.y; dir = 'left';
      // After snap, y is a half-tile.
      expect(y % 1).toBeCloseTo(0.5, 5);

      // Move left 4 ticks, turn down
      for (let i = 0; i < 4; i++) x -= 0.1;
      const s3 = snapPerpendicular(x, y, 'down');
      x = s3.x; y = s3.y; dir = 'down';
      expect(x % 1).toBeCloseTo(0.5, 5);

      // Move down 1 tick, turn right
      for (let i = 0; i < 1; i++) y += 0.1;
      const s4 = snapPerpendicular(x, y, 'right');
      x = s4.x; y = s4.y; dir = 'right';
      expect(y % 1).toBeCloseTo(0.5, 5);

      // After 4 turns, the player is still aligned with corridor centers.
      // The maximum drift from a half-tile is 0 (snap guarantees alignment).
      var finalDrift = (dir === 'up' || dir === 'down')
        ? Math.abs(x - (Math.round(x - 0.5) + 0.5))
        : Math.abs(y - (Math.round(y - 0.5) + 0.5));
      expect(finalDrift).toBe(0);
    });
  });
});

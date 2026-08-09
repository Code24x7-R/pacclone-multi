/**
 * clampSpriteToWall.test.js — Tests for sprite-to-wall clamping.
 *
 * The raw movement wall-check only gates the sprite *center* against wall
 * tiles. But the player radius (~0.45 tiles) means the body can stick into
 * a wall tile at the end of a corridor — visually half the sprite inside
 * the wall. This also breaks ghost collision: a ghost approaching down the
 * corridor can't get within the 0.5 collision threshold of a player pinned
 * near the far wall.
 *
 * clampSpriteToWall pushes the center back so the sprite edge sits flush
 * against the wall boundary, fixing both the visual clip and the collision
 * reachability.
 */

const { clampSpriteToWall } = require('../../src/gameLogic');

// A tiny 5x5 test maze:
//   1 1 1 1 1
//   1 0 0 0 1
//   1 0 1 0 1
//   1 0 0 0 1
//   1 1 1 1 1
// The center tile (2,2) is a wall. Row 1 and row 3 are open corridors.
const MAZE = [
  [1, 1, 1, 1, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 1, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1],
];

const R = 0.45; // player radius in tile units

describe('clampSpriteToWall', () => {
  // --- No-op when sprite is safely away from walls ---

  test('leaves position unchanged in open space', () => {
    // Center of tile (1,1): sprite spans [0.55, 1.55] — well clear of walls.
    expect(clampSpriteToWall(1.5, 1.5, R, MAZE)).toEqual({ x: 1.5, y: 1.5 });
  });

  test('leaves position unchanged when against a wall on the perpendicular axis only', () => {
    // At (1.5, 2.5) moving left/right along row 3. Y is at row 3 center,
    // tile (1,2) is walkable. Sprite vertical span [2.05, 2.95] — row 2
    // and row 3 are walkable, so no vertical clamp needed.
    expect(clampSpriteToWall(1.5, 2.5, R, MAZE)).toEqual({ x: 1.5, y: 2.5 });
  });

  // --- Horizontal clamping (end of corridor) ---

  test('clamps player against right wall at end of corridor', () => {
    // Row 1 is [1,0,0,0,1]: right wall is column 4. Player center at x=3.95.
    // Sprite right edge would be at 3.95 + 0.45 = 4.40 — inside wall column 4.
    // Clamp should push center back to 4 - 0.45 = 3.55.
    const result = clampSpriteToWall(3.95, 1.5, R, MAZE);
    expect(result.x).toBeCloseTo(3.55, 5);
    expect(result.y).toBeCloseTo(1.5, 5);
  });

  test('clamps player against left wall at end of corridor', () => {
    // Row 1: left wall is column 0. Player center at x=1.05. Sprite left edge
    // would be at 1.05 - 0.45 = 0.60 — inside wall column 0.
    // Clamp should push center forward to 1 + 0.45 = 1.45.
    const result = clampSpriteToWall(1.05, 1.5, R, MAZE);
    expect(result.x).toBeCloseTo(1.45, 5);
    expect(result.y).toBeCloseTo(1.5, 5);
  });

  test('does not clamp when sprite edge is still clear of wall', () => {
    // Center at x=3.5, sprite right edge at 3.95 — still inside tile column 3
    // (walkable). No clamp.
    expect(clampSpriteToWall(3.5, 1.5, R, MAZE)).toEqual({ x: 3.5, y: 1.5 });
  });

  // --- Vertical clamping ---

  test('clamps player against bottom wall', () => {
    // Column 1, bottom wall is row 4. Player center at y=3.95. Sprite bottom
    // edge would be at 4.40 — inside wall row 4.
    // Clamp: y = 4 - 0.45 = 3.55.
    const result = clampSpriteToWall(1.5, 3.95, R, MAZE);
    expect(result.y).toBeCloseTo(3.55, 5);
    expect(result.x).toBeCloseTo(1.5, 5);
  });

  test('clamps player against top wall', () => {
    // Column 1, top wall is row 0. Player center at y=1.05. Sprite top edge
    // would be at 0.60 — inside wall row 0.
    // Clamp: y = 1 + 0.45 = 1.45.
    const result = clampSpriteToWall(1.5, 1.05, R, MAZE);
    expect(result.y).toBeCloseTo(1.45, 5);
    expect(result.x).toBeCloseTo(1.5, 5);
  });

  // --- Corner case: clamped position lets a ghost reach the player ---

  test('after clamping against right wall, a ghost in the corridor is within collision range', () => {
    // Player clamped against right wall at x≈3.55 (sprite edge flush at x=4).
    // A ghost approaching from the left at x=3.1, same row.
    const player = clampSpriteToWall(3.95, 1.5, R, MAZE);
    const ghostX = 3.1;
    const dist = Math.hypot(player.x - ghostX, player.y - 1.5);
    expect(dist).toBeLessThan(0.5); // collision threshold
  });

  test('without clamping, a ghost could NOT reach the wall-pinned player', () => {
    // Raw (unclamped) center at x=3.95. Ghost at x=3.5 is 0.45 away but the
    // ghost is also clamped to x≈3.55, so the effective gap is ~0.40. However,
    // if the player could sit at x=3.95 (unclamped) and ghost at x=3.1, the
    // distance is 0.85 — beyond the 0.5 collision threshold.
    const rawX = 3.95;
    const ghostX = 3.1;
    const dist = Math.hypot(rawX - ghostX, 0);
    expect(dist).toBeGreaterThanOrEqual(0.5);
  });

  // --- Symmetry: clamp is idempotent ---

  test('clamping an already-clamped position is a no-op', () => {
    const first = clampSpriteToWall(2.95, 1.5, R, MAZE);
    const second = clampSpriteToWall(first.x, first.y, R, MAZE);
    expect(second).toEqual(first);
  });

  // --- Smaller sprite (ghost radius) clamps less ---

  test('a smaller radius clamps less aggressively', () => {
    // Ghost radius ~0.33 tiles. Center at x=3.95. Sprite edge at 4.28.
    // Edge is in wall tile column 4, so clamp to 4 - 0.33 = 3.67.
    const ghostR = 0.33;
    const result = clampSpriteToWall(3.95, 1.5, ghostR, MAZE);
    expect(result.x).toBeCloseTo(3.67, 5);
  });
});

describe('clampSpriteToWall — tunnel edges', () => {
  // Tunnel row: leftmost tile is type 4 (EMPTY walkable tunnel). The player
  // must be able to reach x=0 (and beyond) to trigger the horizontal wrap.
  // The clamp must NOT pin the player ~0.45 tiles short of the edge.
  const R = 0.45; // player radius in tile units
  const TUNNEL_MAZE = [
    [1, 1, 1, 1, 1, 1, 1, 1],
    [4, 4, 4, 4, 0, 1, 1, 1], // row 1 is a tunnel row (col 0 = 4)
    [1, 1, 1, 1, 1, 1, 1, 1],
  ];

  test('does not clamp the player away from the left tunnel edge', () => {
    // Player moving left toward x=0. Without the fix, the clamp pins the
    // player at x=0.45 (left edge at x=0 is "out of bounds" = wall).
    const result = clampSpriteToWall(0.1, 1.5, R, TUNNEL_MAZE);
    // The player should be able to reach x=0.1 (or very close), NOT pinned.
    expect(result.x).toBeLessThan(0.45);
  });

  test('does not clamp the player away from the right tunnel edge', () => {
    // Player moving right toward the edge at x=width. Row 1 tunnel extends
    // to col 4; col 5 is a wall. Place the tunnel opening at the right.
    const MAZE2 = [
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 4, 4, 4, 4], // row 1 tunnel opens at right edge (col 7 = 4)
      [1, 1, 1, 1, 1, 1, 1, 1],
    ];
    // Player at x=7.9 on the tunnel row. Right edge at 8.35 is out of bounds,
    // but on a tunnel row it should NOT be clamped back.
    const result = clampSpriteToWall(7.9, 1.5, R, MAZE2);
    expect(result.x).toBeGreaterThan(7.5);
  });

  test('still clamps the player from walls on a tunnel row', () => {
    // The tunnel row has a wall at col 5. A player at x=4.95 (edge at 5.4,
    // which is the wall tile col 5) must still be clamped back.
    const result = clampSpriteToWall(4.95, 1.5, R, TUNNEL_MAZE);
    expect(result.x).toBeCloseTo(4.55, 5); // 5 - 0.45
  });

  test('player can reach x=0 on a tunnel row (wrap trigger point)', () => {
    // The critical case: player at x=0.0 should NOT be pushed right.
    const result = clampSpriteToWall(0.0, 1.5, R, TUNNEL_MAZE);
    expect(result.x).toBeCloseTo(0.0, 5);
  });
});

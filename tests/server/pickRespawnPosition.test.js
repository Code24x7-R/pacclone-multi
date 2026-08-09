const { pickRespawnPosition, MAZE } = require("../../src/gameLogic");

// A tiny maze where only the top corners are walkable; bottom corners are walls.
// Layout (3x3):
//   1 1 1
//   1 0 1   <- center walkable
//   1 1 1   <- bottom row all walls
const TINY_MAZE = [
  [1, 1, 1],
  [1, 0, 1],
  [1, 1, 1],
];

// A maze where ALL four corners are walkable.
// Layout (5x5):
//   1 1 1 1 1
//   1 0 1 0 1
//   1 1 1 1 1
//   1 0 1 0 1
//   1 1 1 1 1
const FOUR_CORNERS_MAZE = [
  [1, 1, 1, 1, 1],
  [1, 0, 1, 0, 1],
  [1, 1, 1, 1, 1],
  [1, 0, 1, 0, 1],
  [1, 1, 1, 1, 1],
];

// A maze where the literal bottom corners are WALLS, so snapping must
// kick in. Corners land at y = h-1.5 = 4.5 -> row 4, which is all walls;
// they should snap up to row 3 (walkable).
// Layout (6x5):
//   1 1 1 1 1
//   1 0 0 0 1
//   1 0 0 0 1
//   1 0 0 0 1   <- snapping target
//   1 1 1 1 1   <- corner lands here (wall)
//   1 1 1 1 1
const BOTTOM_WALL_MAZE = [
  [1, 1, 1, 1, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
];

describe("pickRespawnPosition", () => {
  test("picks a walkable corner", () => {
    // TINY_MAZE: only top corners are walkable (1.5,1.5) and (1.5... wait
    // width is 3, so w-1.5 = 1.5 — both top corners overlap the same tile).
    // Use FOUR_CORNERS_MAZE instead for a clear 4-corner case.
    const pos = pickRespawnPosition([], FOUR_CORNERS_MAZE, () => 0);
    // rng=0 -> first corner in pool.
    expect(pos).toEqual({ x: 1.5, y: 1.5 });
  });

  test("respects the RNG to choose different corners", () => {
    // rng returning 0.99 should pick the last corner.
    const pos = pickRespawnPosition([], FOUR_CORNERS_MAZE, () => 0.99);
    // 5x5 maze -> last corner at (3.5, 3.5).
    expect(pos).toEqual({ x: 3.5, y: 3.5 });
  });

  test("excludes a corner occupied by another player", () => {
    // Occupy the first corner (1.5, 1.5). rng=0 would normally pick it,
    // but it's occupied so the function should pick a different one.
    const occupied = [{ x: 1.5, y: 1.5 }];
    const pos = pickRespawnPosition(occupied, FOUR_CORNERS_MAZE, () => 0);
    expect(pos).not.toEqual({ x: 1.5, y: 1.5 });
    // Next corner in pool is (3.5, 1.5).
    expect(pos).toEqual({ x: 3.5, y: 1.5 });
  });

  test("filters out wall corners from the pool", () => {
    // TINY_MAZE bottom corners are walls. With no occupants, the pool should
    // only contain walkable corners. (1.5,1.5) and (1.5,1.5) overlap, and
    // (1.5, 2.5)/(1.5,2.5) are walls, so only the top corners remain.
    const pos = pickRespawnPosition([], TINY_MAZE, () => 0);
    // Must not be a wall tile.
    const wallAtPos =
      TINY_MAZE[Math.floor(pos.y)][Math.floor(pos.x)] === 1;
    expect(wallAtPos).toBe(false);
  });

  test("never returns a wall tile even if all walkable corners are occupied", () => {
    // Occupy the two walkable top corners of TINY_MAZE. The only remaining
    // "corners" are walls, so the function falls back to the walkable pool
    // (never a wall).
    const occupied = [
      { x: 1.5, y: 1.5 },
      { x: 1.5, y: 1.5 }, // same tile (width 3 -> w-1.5 = 1.5)
    ];
    const pos = pickRespawnPosition(occupied, TINY_MAZE, () => 0);
    const wallAtPos =
      TINY_MAZE[Math.floor(pos.y)][Math.floor(pos.x)] === 1;
    expect(wallAtPos).toBe(false);
  });

  test("spreads players across corners — no two on the same tile", () => {
    // Simulate 4 players joining one by one, each picking a respawn that
    // avoids the already-occupied corners.
    const chosen = [];
    for (let i = 0; i < 4; i++) {
      // rng=0 always tries the first corner first.
      const pos = pickRespawnPosition(chosen, FOUR_CORNERS_MAZE, () => 0);
      chosen.push(pos);
    }
    // All four corners of FOUR_CORNERS_MAZE should be unique.
    const keys = chosen.map(p => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(4);
  });

  test("does not spawn on top of an occupied corner (distance < 0.5)", () => {
    // Place a player near (but not exactly at) the first corner.
    const occupied = [{ x: 1.6, y: 1.6 }];
    const pos = pickRespawnPosition(occupied, FOUR_CORNERS_MAZE, () => 0);
    // (1.5,1.5) is within 0.5 of (1.6,1.6) -> excluded.
    expect(pos).not.toEqual({ x: 1.5, y: 1.5 });
  });

  test("treats a far-away player as non-blocking", () => {
    // Occupy a corner far from the first; rng=0 should still pick corner 0.
    const occupied = [{ x: 3.5, y: 3.5 }];
    const pos = pickRespawnPosition(occupied, FOUR_CORNERS_MAZE, () => 0);
    expect(pos).toEqual({ x: 1.5, y: 1.5 });
  });

  test("works with the default (real) maze", () => {
    const pos = pickRespawnPosition([], MAZE, () => 0);
    // Default maze: top-left (1.5,1.5) is walkable, so rng=0 picks it.
    expect(pos).toEqual({ x: 1.5, y: 1.5 });
    // And it must not be a wall.
    expect(MAZE[Math.floor(pos.y)][Math.floor(pos.x)]).not.toBe(1);
  });

  test("snaps a wall corner to the nearest walkable tile", () => {
    // BOTTOM_WALL_MAZE: literal bottom corners (row 4) are walls. The nearest
    // walkable tile is row 3, so a respawn there should land at y=3.5, not y=4.5.
    const pos = pickRespawnPosition([], BOTTOM_WALL_MAZE, () => 0.99);
    // rng=0.99 picks the last corner (bottom-right), which must snap up.
    expect(pos.y).toBeCloseTo(3.5);
    expect(BOTTOM_WALL_MAZE[Math.floor(pos.y)][Math.floor(pos.x)]).not.toBe(1);
  });

  test("snapping produces 4 unique corners on the real (default) maze", () => {
    // The default maze's literal bottom corners are walls; after snapping,
    // all 4 players should still get distinct walkable corners.
    const chosen = [];
    for (let i = 0; i < 4; i++) {
      chosen.push(pickRespawnPosition(chosen, MAZE, () => 0));
    }
    const keys = chosen.map(p => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(4);
    // And none may be a wall.
    for (const p of chosen) {
      expect(MAZE[Math.floor(p.y)][Math.floor(p.x)]).not.toBe(1);
    }
  });
});

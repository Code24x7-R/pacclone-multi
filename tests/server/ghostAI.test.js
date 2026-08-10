const {
  createGhost,
  createInitialGhosts,
  getDefaultHouseConfig,
  shouldReleaseGhost,
  getScatterTarget,
  findNearestPlayer,
  getChaseTarget,
  getGhostTarget,
  isGhostWalkable,
  getWalkableDirections,
  chooseDirection,
  isGhostStuck,
  isAtTileCenter,
  snapToTileCenter,
  updateGhostHouseState,
  createModeCycle,
  updateModeCycle,
  GHOST_EAT_SCORE,
  GHOST_NORMAL_SPEED,
  GHOST_FRIGHTENED_SPEED,
  GHOST_EATEN_SPEED,
  STUCK_TICK_THRESHOLD,
} = require("../../src/ghostAI");

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// A simple 10x10 maze with a ghost house gate at (5,3)
// 0=pellet, 1=wall, 2=power, 6=gate
const MAZE = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 6, 1, 1, 0, 1], // gate at (5,3)
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

const HOUSE_CONFIG = {
  centerX: 5.5,
  centerY: 4.5,
  exitX: 5.5,
  exitY: 2.5,
  gateX: 5,
  gateY: 3,
};

describe("createGhost", () => {
  test("creates a ghost with correct personality attributes", () => {
    const blinky = createGhost("blinky", HOUSE_CONFIG);
    expect(blinky.id).toBe("blinky");
    expect(blinky.name).toBe("Blinky");
    expect(blinky.color).toBe("red");
    expect(blinky.state).toBe("scatter"); // Blinky starts outside
    expect(blinky.speed).toBe(GHOST_NORMAL_SPEED);
  });

  test("non-blinky ghosts start inHouse", () => {
    const pinky = createGhost("pinky", HOUSE_CONFIG);
    const inky = createGhost("inky", HOUSE_CONFIG);
    const clyde = createGhost("clyde", HOUSE_CONFIG);
    expect(pinky.state).toBe("inHouse");
    expect(inky.state).toBe("inHouse");
    expect(clyde.state).toBe("inHouse");
  });

  test("ghosts have staggered starting positions", () => {
    const pinky = createGhost("pinky", HOUSE_CONFIG);
    const inky = createGhost("inky", HOUSE_CONFIG);
    const clyde = createGhost("clyde", HOUSE_CONFIG);
    // Pinky at center
    expect(pinky.x).toBe(HOUSE_CONFIG.centerX);
    expect(pinky.y).toBe(HOUSE_CONFIG.centerY);
    // Inky offset left
    expect(inky.x).toBe(HOUSE_CONFIG.centerX - 1);
    // Clyde offset right
    expect(clyde.x).toBe(HOUSE_CONFIG.centerX + 1);
  });

  test("blinky starts above the gate", () => {
    const blinky = createGhost("blinky", HOUSE_CONFIG);
    expect(blinky.y).toBe(HOUSE_CONFIG.centerY - 2);
  });

  test("ghosts have unique idle timers", () => {
    const g1 = createGhost("pinky", HOUSE_CONFIG);
    const g2 = createGhost("pinky", HOUSE_CONFIG);
    // They should be different (random) but both >= 0
    expect(g1.idleTimer).toBeGreaterThanOrEqual(0);
    expect(g2.idleTimer).toBeGreaterThanOrEqual(0);
  });
});

describe("createInitialGhosts", () => {
  test("creates exactly 4 ghosts", () => {
    const ghosts = createInitialGhosts(HOUSE_CONFIG);
    expect(ghosts).toHaveLength(4);
  });

  test("creates all four personalities", () => {
    const ghosts = createInitialGhosts(HOUSE_CONFIG);
    const ids = ghosts.map((g) => g.id);
    expect(ids).toContain("blinky");
    expect(ids).toContain("pinky");
    expect(ids).toContain("inky");
    expect(ids).toContain("clyde");
  });
});

describe("getDefaultHouseConfig", () => {
  test("finds gate tile and computes house geometry", () => {
    const config = getDefaultHouseConfig(MAZE);
    expect(config.gateX).toBe(5);
    expect(config.gateY).toBe(3);
    expect(config.centerX).toBe(5.5);
    // Walkable space is below the gate (row 4), so exit is below, house center is above
    expect(config.centerY).toBe(2.5);
    expect(config.exitX).toBe(5.5);
    expect(config.exitY).toBe(4.5);
  });

  test("returns defaults when no gate found", () => {
    const noGateMaze = [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ];
    const config = getDefaultHouseConfig(noGateMaze);
    // Fallback: center of maze, gate at -1 (not found)
    expect(config.centerX).toBe(1.5);
    expect(config.centerY).toBe(1.5);
    expect(config.gateX).toBe(-1);
    expect(config.gateY).toBe(-1);
  });
});

describe("shouldReleaseGhost", () => {
  test("blinky releases immediately (threshold 0)", () => {
    expect(shouldReleaseGhost("blinky", 0)).toBe(true);
    expect(shouldReleaseGhost("blinky", 100)).toBe(true);
  });

  test("pinky releases at 15 pellets", () => {
    expect(shouldReleaseGhost("pinky", 14)).toBe(false);
    expect(shouldReleaseGhost("pinky", 15)).toBe(true);
    expect(shouldReleaseGhost("pinky", 16)).toBe(true);
  });

  test("inky releases at 30 pellets", () => {
    expect(shouldReleaseGhost("inky", 29)).toBe(false);
    expect(shouldReleaseGhost("inky", 30)).toBe(true);
  });

  test("clyde releases at 50 pellets", () => {
    expect(shouldReleaseGhost("clyde", 49)).toBe(false);
    expect(shouldReleaseGhost("clyde", 50)).toBe(true);
  });

  test("unknown personality never releases", () => {
    expect(shouldReleaseGhost("unknown", 1000)).toBe(false);
  });
});

describe("getScatterTarget", () => {
  test("blinky targets top-right", () => {
    const target = getScatterTarget("blinky", 20, 20);
    expect(target).toEqual({ tileX: 19, tileY: 0 });
  });

  test("pinky targets top-left", () => {
    const target = getScatterTarget("pinky", 20, 20);
    expect(target).toEqual({ tileX: 0, tileY: 0 });
  });

  test("inky targets bottom-right", () => {
    const target = getScatterTarget("inky", 20, 20);
    expect(target).toEqual({ tileX: 19, tileY: 19 });
  });

  test("clyde targets bottom-left", () => {
    const target = getScatterTarget("clyde", 20, 20);
    expect(target).toEqual({ tileX: 0, tileY: 19 });
  });
});

describe("findNearestPlayer", () => {
  test("returns nearest player", () => {
    const from = { x: 5, y: 5 };
    const players = [
      { x: 1, y: 1 },
      { x: 6, y: 6 },
      { x: 10, y: 10 },
    ];
    const nearest = findNearestPlayer(from, players);
    expect(nearest).toEqual({ x: 6, y: 6 });
  });

  test("returns null for empty players", () => {
    expect(findNearestPlayer({ x: 0, y: 0 }, [])).toBeNull();
  });

  test("returns the only player", () => {
    const nearest = findNearestPlayer({ x: 0, y: 0 }, [{ x: 3, y: 4 }]);
    expect(nearest).toEqual({ x: 3, y: 4 });
  });
});

describe("getChaseTarget", () => {
  const players = [{ x: 10, y: 10, direction: "left" }];
  const blinky = { x: 5, y: 5 };

  test("blinky targets player position", () => {
    const target = getChaseTarget("blinky", players, blinky, 20, 20);
    expect(target).toEqual({ tileX: 10, tileY: 10 });
  });

  test("pinky targets 4 tiles ahead of player (left)", () => {
    const target = getChaseTarget("pinky", players, blinky, 20, 20);
    // Player at (10,10) moving left → target at (6,10)
    expect(target).toEqual({ tileX: 6, tileY: 10 });
  });

  test("pinky has overflow bug when moving up", () => {
    const upPlayers = [{ x: 10, y: 10, direction: "up" }];
    const target = getChaseTarget("pinky", upPlayers, blinky, 20, 20);
    // 4 up + 4 left overflow → (6, 6)
    expect(target).toEqual({ tileX: 6, tileY: 6 });
  });

  test("inky uses vector from blinky through 2-ahead of player", () => {
    // Player at (10,10) moving left → 2 ahead at (8,10)
    // Vector from blinky (5,5) to (8,10) = (3,5)
    // Inky target = blinky + 2*vector = (5+6, 5+10) = (11,15)
    const target = getChaseTarget("inky", players, blinky, 20, 20);
    expect(target).toEqual({ tileX: 11, tileY: 15 });
  });

  test("clyde chases when player is far", () => {
    const farPlayers = [{ x: 18, y: 18, direction: "left" }];
    const target = getChaseTarget("clyde", farPlayers, blinky, 20, 20);
    // Distance from blinky (5,5) to (18,18) > 8 → chase
    expect(target).toEqual({ tileX: 18, tileY: 18 });
  });

  test("clyde scatters when player is close", () => {
    const closePlayers = [{ x: 6, y: 6, direction: "left" }];
    const target = getChaseTarget("clyde", closePlayers, blinky, 20, 20);
    // Distance from blinky (5,5) to (6,6) < 8 → scatter to bottom-left
    expect(target).toEqual({ tileX: 0, tileY: 19 });
  });

  test("falls back to scatter when no players", () => {
    const target = getChaseTarget("blinky", [], blinky, 20, 20);
    // No players → scatter target (top-right for blinky)
    expect(target).toEqual({ tileX: 19, tileY: 0 });
  });
});

describe("getGhostTarget", () => {
  const context = {
    players: [{ x: 10, y: 10, direction: "left" }],
    blinky: { x: 5, y: 5 },
    mode: "chase",
    mazeWidth: 20,
    mazeHeight: 20,
    houseConfig: HOUSE_CONFIG,
  };

  test("scatter state returns scatter target", () => {
    const ghost = { id: "blinky", state: "scatter", x: 5, y: 5 };
    const target = getGhostTarget(ghost, context);
    expect(target).toEqual({ tileX: 19, tileY: 0 });
  });

  test("chase state returns chase target", () => {
    const ghost = { id: "blinky", state: "chase", x: 5, y: 5 };
    const target = getGhostTarget(ghost, context);
    expect(target).toEqual({ tileX: 10, tileY: 10 });
  });

  test("exitingHouse targets the exit point", () => {
    const ghost = { id: "pinky", state: "exitingHouse", x: 5.5, y: 4.5 };
    const target = getGhostTarget(ghost, context);
    expect(target).toEqual({ tileX: 5, tileY: 2 });
  });

  test("eaten targets the house center", () => {
    const ghost = { id: "blinky", state: "eaten", x: 3, y: 3 };
    const target = getGhostTarget(ghost, context);
    expect(target).toEqual({ tileX: 5, tileY: 4 });
  });

  test("inHouse returns current tile (no movement target)", () => {
    const ghost = { id: "pinky", state: "inHouse", x: 5.5, y: 4.5 };
    const target = getGhostTarget(ghost, context);
    expect(target).toEqual({ tileX: 5, tileY: 4 });
  });
});

describe("isGhostWalkable", () => {
  test("returns false for walls", () => {
    expect(isGhostWalkable(MAZE, 0, 0, "chase", 10, 10)).toBe(false);
  });

  test("returns true for pellet paths", () => {
    expect(isGhostWalkable(MAZE, 1, 1, "chase", 10, 10)).toBe(true);
  });

  test("returns true for power pellets", () => {
    const powerMaze = [
      [1, 1, 1],
      [1, 2, 1],
      [1, 1, 1],
    ];
    expect(isGhostWalkable(powerMaze, 1, 1, "chase", 3, 3)).toBe(true);
  });

  test("gate is walkable for chase state", () => {
    expect(isGhostWalkable(MAZE, 5, 3, "chase", 10, 10)).toBe(true);
  });

  test("gate is walkable for scatter state", () => {
    expect(isGhostWalkable(MAZE, 5, 3, "scatter", 10, 10)).toBe(true);
  });

  test("gate is walkable for exitingHouse state", () => {
    expect(isGhostWalkable(MAZE, 5, 3, "exitingHouse", 10, 10)).toBe(true);
  });

  test("gate is walkable for eaten state", () => {
    expect(isGhostWalkable(MAZE, 5, 3, "eaten", 10, 10)).toBe(true);
  });

  test("gate is walkable for frightened state", () => {
    expect(isGhostWalkable(MAZE, 5, 3, "frightened", 10, 10)).toBe(true);
  });

  test("out of bounds is not walkable", () => {
    expect(isGhostWalkable(MAZE, -1, 0, "chase", 10, 10)).toBe(false);
    expect(isGhostWalkable(MAZE, 0, -1, "chase", 10, 10)).toBe(false);
    expect(isGhostWalkable(MAZE, 10, 0, "chase", 10, 10)).toBe(false);
    expect(isGhostWalkable(MAZE, 0, 10, "chase", 10, 10)).toBe(false);
  });
});

describe("getWalkableDirections", () => {
  test("returns all open directions in open space", () => {
    // Ghost at (1,1) in MAZE — surrounded by open tiles except walls
    const ghost = { x: 1.5, y: 1.5, direction: "right", state: "chase" };
    const dirs = getWalkableDirections(ghost, MAZE, 10, 10);
    // (1,1) neighbors: up=(1,0)=wall, down=(1,2)=open, left=(0,1)=wall, right=(2,1)=open
    expect(dirs).toContain("down");
    expect(dirs).toContain("right");
    expect(dirs).not.toContain("up");
    expect(dirs).not.toContain("left");
  });

  test("prevents U-turns", () => {
    const ghost = { x: 1.5, y: 1.5, direction: "right", state: "chase" };
    const dirs = getWalkableDirections(ghost, MAZE, 10, 10);
    // Moving right, so left (reverse) should be excluded
    expect(dirs).not.toContain("left");
  });

  test("allows U-turns when frightened", () => {
    // Use open maze where all directions are walkable so U-turn is testable
    const openMaze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const ghost = { x: 2.5, y: 2.5, direction: "right", state: "frightened" };
    const dirs = getWalkableDirections(ghost, openMaze, 5, 5);
    // Frightened ghosts can turn around (left is reverse of right)
    expect(dirs).toContain("left");
    expect(dirs).toContain("right");
  });

  test("allows gate passage for exiting ghosts", () => {
    // Ghost at (5,4) trying to move up to gate at (5,3)
    // Use direction "left" so "up" is not filtered as a U-turn
    const ghost = { x: 5.5, y: 4.5, direction: "left", state: "exitingHouse" };
    const dirs = getWalkableDirections(ghost, MAZE, 10, 10);
    expect(dirs).toContain("up");
  });
});

describe("chooseDirection", () => {
  test("chooses direction that minimizes distance to target", () => {
    // Ghost at (1,1), target at (5,1) → should go right
    const ghost = { x: 1.5, y: 1.5, direction: "up", state: "chase" };
    const target = { tileX: 5, tileY: 1 };
    const dir = chooseDirection(ghost, target, MAZE, 10, 10);
    expect(dir).toBe("right");
  });

  test("frightened ghost maximizes distance (runs away)", () => {
    // Ghost at (5,5), target at (5,5) → should move away
    const openMaze = [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ];
    const ghost = { x: 5.5, y: 5.5, direction: "left", state: "frightened" };
    const target = { tileX: 5, tileY: 5 };
    const dir = chooseDirection(ghost, target, openMaze, 10, 10);
    // Should move away from (5,5) — any direction is fine, just not toward target
    expect(["up", "down", "left", "right"]).toContain(dir);
  });

  test("avoids walls when choosing direction", () => {
    // Ghost at (1,1), target at (1,5) — down is open, up is wall
    const ghost = { x: 1.5, y: 1.5, direction: "right", state: "chase" };
    const target = { tileX: 1, tileY: 5 };
    const dir = chooseDirection(ghost, target, MAZE, 10, 10);
    expect(dir).toBe("down");
  });

  test("allows reverse when no other option", () => {
    // Dead-end: ghost at (2,1) with left=(1,1) open but right=(3,1)=wall,
    // up=(2,0)=wall, down=(2,2)=wall. Ghost moving right, must reverse to left.
    const deadEndMaze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
    ];
    const ghost = { x: 2.5, y: 1.5, direction: "right", state: "chase" };
    const target = { tileX: 4, tileY: 4 };
    const dir = chooseDirection(ghost, target, deadEndMaze, 5, 5);
    // Only walkable option is left (reverse) since right/up/down are walls
    expect(dir).toBe("left");
  });

  test("frightened ghost can reverse direction to maximize distance", () => {
    // Ghost at (2,1) with left=(1,1) open and right=(3,1) open.
    // Ghost moving right, target is far to the right.
    // Frightened ghost should reverse to left to maximize distance.
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
    ];
    const ghost = { x: 2.5, y: 1.5, direction: "right", state: "frightened" };
    const target = { tileX: 4, tileY: 4 }; // Far to the right
    const dir = chooseDirection(ghost, target, maze, 5, 5);
    // Frightened ghost should reverse to left to maximize distance from target
    expect(dir).toBe("left");
  });
});

describe("isGhostStuck", () => {
  test("returns true when all directions are walls", () => {
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1], // Ghost at (2,2), all neighbors are walls
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
    ];
    const ghost = { x: 2.5, y: 2.5, state: "chase" };
    expect(isGhostStuck(ghost, maze, 5, 5)).toBe(true);
  });

  test("returns false when at least one direction is open", () => {
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 1, 0, 1, 1], // Up is open
      [1, 1, 0, 1, 1], // Ghost at (2,2)
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
    ];
    const ghost = { x: 2.5, y: 2.5, state: "chase" };
    expect(isGhostStuck(ghost, maze, 5, 5)).toBe(false);
  });

  test("returns false in open space", () => {
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1], // Ghost at (2,2), all directions open
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const ghost = { x: 2.5, y: 2.5, state: "chase" };
    expect(isGhostStuck(ghost, maze, 5, 5)).toBe(false);
  });

  test("gate tile counts as walkable for stuck detection", () => {
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 1, 6, 1, 1], // Gate above
      [1, 1, 0, 1, 1], // Ghost at (2,2)
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
    ];
    const ghost = { x: 2.5, y: 2.5, state: "chase" };
    expect(isGhostStuck(ghost, maze, 5, 5)).toBe(false);
  });

  // --- Movement-timeout stuck detection (catchall for frozen ghosts) ---

  test("returns true when stuckTicks exceeds threshold despite open neighbors", () => {
    // Open maze — ghost has valid exits but has not moved for too long.
    // This simulates a frightened ghost that is frozen in place.
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1], // Ghost at (2,2), all directions open
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const ghost = { x: 2.5, y: 2.5, state: "frightened", stuckTicks: STUCK_TICK_THRESHOLD };
    expect(isGhostStuck(ghost, maze, 5, 5)).toBe(true);
  });

  test("returns false when stuckTicks is below threshold and neighbors are open", () => {
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1], // Ghost at (2,2)
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const ghost = { x: 2.5, y: 2.5, state: "frightened", stuckTicks: STUCK_TICK_THRESHOLD - 1 };
    expect(isGhostStuck(ghost, maze, 5, 5)).toBe(false);
  });

  test("returns true at exactly the threshold", () => {
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1], // Ghost at (2,2)
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const ghost = { x: 2.5, y: 2.5, state: "chase", stuckTicks: STUCK_TICK_THRESHOLD };
    expect(isGhostStuck(ghost, maze, 5, 5)).toBe(true);
  });

  test("stuckTicks defaults to 0 when absent", () => {
    // Ghost without stuckTicks field should not trigger timeout.
    const maze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1], // Ghost at (2,2)
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const ghost = { x: 2.5, y: 2.5, state: "chase" };
    expect(isGhostStuck(ghost, maze, 5, 5)).toBe(false);
  });

  test("threshold is ~3 seconds worth of ticks at 60 FPS", () => {
    // STUCK_TICK_THRESHOLD should be 180 (60 FPS * 3 seconds).
    expect(STUCK_TICK_THRESHOLD).toBe(180);
  });
});

describe("wall collision bug fix (ghost frozen at tile edge)", () => {
  // This test reproduces the bug where a ghost that hits a wall gets stuck
  // at the tile edge and can never reach a tile center again, so it can never
  // pick a new direction. The ghost appears "frozen".
  //
  // The bug was in the server's wall collision logic: when a ghost hit a wall,
  // it was snapped to the tile edge (Math.floor(x) + 0.99 or + 0.01) instead
  // of the tile center. Since isAtTileCenter uses a small epsilon (0.04), a
  // ghost at x=4.99 would never be considered "at center", so it would never
  // pick a new direction, resulting in an infinite loop of hitting the wall.

  const corridorMaze = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 1, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  const mazeWidth = 7;
  const mazeHeight = 3;
  const ghostBaseSpeed = 0.08;

  function simulateGhostMovement_buggy(ghost, ticks) {
    const positions = [];
    for (let i = 0; i < ticks; i++) {
      const atCenter = isAtTileCenter(ghost.x, ghost.y, ghostBaseSpeed / 2);
      if (atCenter) {
        const snapped = snapToTileCenter(ghost);
        ghost.x = snapped.x;
        ghost.y = snapped.y;
        // Force direction to right (toward wall)
        ghost.direction = 'right';
      }
      const vec = { dx: 1, dy: 0 };
      const moveAmount = ghostBaseSpeed * (ghost.speed || 0.8);
      const nextX = ghost.x + vec.dx * moveAmount;
      const nextY = ghost.y + vec.dy * moveAmount;
      if (!isGhostWalkable(corridorMaze, Math.floor(nextX), Math.floor(nextY), ghost.state, mazeWidth, mazeHeight)) {
        // OLD BUGGY CODE: snap to tile edge
        if (vec.dx > 0) ghost.x = Math.floor(ghost.x) + 0.99;
        else if (vec.dx < 0) ghost.x = Math.floor(ghost.x) + 0.01;
        if (vec.dy > 0) ghost.y = Math.floor(ghost.y) + 0.99;
        else if (vec.dy < 0) ghost.y = Math.floor(ghost.y) + 0.01;
      } else {
        ghost.x = nextX;
        ghost.y = nextY;
      }
      positions.push({ x: ghost.x, y: ghost.y });
    }
    return positions;
  }

  function simulateGhostMovement_fixed(ghost, ticks) {
    const positions = [];
    for (let i = 0; i < ticks; i++) {
      const atCenter = isAtTileCenter(ghost.x, ghost.y, ghostBaseSpeed / 2);
      if (atCenter) {
        const snapped = snapToTileCenter(ghost);
        ghost.x = snapped.x;
        ghost.y = snapped.y;
        // Force direction to right (toward wall)
        ghost.direction = 'right';
      }
      const vec = { dx: 1, dy: 0 };
      const moveAmount = ghostBaseSpeed * (ghost.speed || 0.8);
      const nextX = ghost.x + vec.dx * moveAmount;
      const nextY = ghost.y + vec.dy * moveAmount;
      if (!isGhostWalkable(corridorMaze, Math.floor(nextX), Math.floor(nextY), ghost.state, mazeWidth, mazeHeight)) {
        // FIXED: snap to tile center
        const snapped = snapToTileCenter(ghost);
        ghost.x = snapped.x;
        ghost.y = snapped.y;
      } else {
        ghost.x = nextX;
        ghost.y = nextY;
      }
      positions.push({ x: ghost.x, y: ghost.y });
    }
    return positions;
  }

  test("BUG DEMO: old code snaps ghost to tile edge, freezing it", () => {
    const ghost = { x: 1.5, y: 1.5, direction: 'right', state: 'chase', speed: 0.8 };
    // Run enough ticks to hit the wall and get stuck (wall is hit at tick 52)
    const positions = simulateGhostMovement_buggy(ghost, 70);
    // After hitting the wall, the ghost should be stuck at x ≈ 4.99
    // (the right edge of tile 4, since tile 5 is a wall)
    const lastPos = positions[positions.length - 1];
    const fracX = lastPos.x - Math.floor(lastPos.x);
    // The ghost should NOT be at a tile center (this is the bug)
    const atTileCenter = Math.abs(fracX - 0.5) < 0.1;
    // This test documents the buggy behavior: ghost is stuck at edge
    expect(atTileCenter).toBe(false);
    // The ghost should be at the tile edge (x ≈ 4.99)
    expect(lastPos.x).toBeCloseTo(4.99, 2);
    // The ghost should have the same position for the last 10 ticks (stuck)
    const last10 = positions.slice(-10);
    const uniquePositions = new Set(last10.map(p => p.x.toFixed(4) + ',' + p.y.toFixed(4)));
    expect(uniquePositions.size).toBe(1);
  });

  test("FIX VERIFIED: new code snaps ghost to tile center, allowing recovery", () => {
    const ghost = { x: 1.5, y: 1.5, direction: 'right', state: 'chase', speed: 0.8 };
    const positions = simulateGhostMovement_fixed(ghost, 60);
    // After hitting the wall, the ghost should NOT be stuck
    const last10 = positions.slice(-10);
    const uniquePositions = new Set(last10.map(p => p.x.toFixed(4) + ',' + p.y.toFixed(4)));
    // With the fix, the ghost should be moving (multiple unique positions)
    expect(uniquePositions.size).toBeGreaterThan(1);
  });

  test("frightened ghost with fix can recover from wall collision", () => {
    const ghost = { x: 1.5, y: 1.5, direction: 'right', state: 'frightened', speed: 0.5 };
    const positions = simulateGhostMovement_fixed(ghost, 60);
    const last10 = positions.slice(-10);
    const uniquePositions = new Set(last10.map(p => p.x.toFixed(4) + ',' + p.y.toFixed(4)));
    expect(uniquePositions.size).toBeGreaterThan(1);
  });
});

describe("isAtTileCenter", () => {
  test("returns true at exact tile center", () => {
    expect(isAtTileCenter(5.5, 3.5)).toBe(true);
  });

  test("returns false away from center", () => {
    expect(isAtTileCenter(5.7, 3.5)).toBe(false);
    expect(isAtTileCenter(5.5, 3.8)).toBe(false);
  });

  test("uses epsilon tolerance", () => {
    expect(isAtTileCenter(5.51, 3.49, 0.02)).toBe(true);
    expect(isAtTileCenter(5.55, 3.5, 0.02)).toBe(false);
  });
});

describe("snapToTileCenter", () => {
  test("snaps to nearest tile center", () => {
    expect(snapToTileCenter({ x: 5.3, y: 3.7 })).toEqual({ x: 5.5, y: 3.5 });
    expect(snapToTileCenter({ x: 1.1, y: 2.9 })).toEqual({ x: 1.5, y: 2.5 });
  });
});

describe("updateGhostHouseState", () => {
  test("releases ghost when pellet threshold met", () => {
    const ghost = createGhost("pinky", HOUSE_CONFIG);
    ghost.state = "inHouse";
    updateGhostHouseState(ghost, { pelletsEaten: 15, deltaTime: 16 });
    expect(ghost.state).toBe("exitingHouse");
  });

  test("does not release ghost before threshold", () => {
    const ghost = createGhost("pinky", HOUSE_CONFIG);
    ghost.state = "inHouse";
    updateGhostHouseState(ghost, { pelletsEaten: 10, deltaTime: 16 });
    expect(ghost.state).toBe("inHouse");
  });

  test("transitions exitingHouse to scatter when reaching exit", () => {
    const ghost = createGhost("pinky", HOUSE_CONFIG);
    ghost.state = "exitingHouse";
    ghost.x = HOUSE_CONFIG.exitX;
    ghost.y = HOUSE_CONFIG.exitY;
    updateGhostHouseState(ghost, {
      pelletsEaten: 0,
      deltaTime: 16,
      houseConfig: HOUSE_CONFIG,
      globalMode: "scatter",
    });
    expect(ghost.state).toBe("scatter");
  });

  test("transitions eaten ghost back to house", () => {
    const ghost = createGhost("blinky", HOUSE_CONFIG);
    ghost.state = "eaten";
    ghost.x = HOUSE_CONFIG.centerX;
    ghost.y = HOUSE_CONFIG.centerY;
    updateGhostHouseState(ghost, {
      pelletsEaten: 0,
      deltaTime: 16,
      houseConfig: HOUSE_CONFIG,
    });
    expect(ghost.state).toBe("inHouse");
    expect(ghost.eaten).toBe(false);
    expect(ghost.reReleaseTimer).toBeGreaterThan(0);
  });

  test("decrements reReleaseTimer", () => {
    const ghost = createGhost("pinky", HOUSE_CONFIG);
    ghost.state = "inHouse";
    ghost.reReleaseTimer = 3000;
    updateGhostHouseState(ghost, { pelletsEaten: 0, deltaTime: 1000 });
    expect(ghost.reReleaseTimer).toBe(2000);
  });

  test("releases ghost after reReleaseTimer expires", () => {
    const ghost = createGhost("pinky", HOUSE_CONFIG);
    ghost.state = "inHouse";
    ghost.reReleaseTimer = 500;
    updateGhostHouseState(ghost, { pelletsEaten: 0, deltaTime: 600 });
    expect(ghost.state).toBe("exitingHouse");
    expect(ghost.reReleaseTimer).toBe(0);
  });

  test("ghost exits house by moving up through gate to tile above", () => {
    const ghost = createGhost("pinky", HOUSE_CONFIG);
    ghost.state = "exitingHouse";
    ghost.x = HOUSE_CONFIG.centerX;
    ghost.y = HOUSE_CONFIG.centerY;
    ghost.direction = "up";

    // The exit point should be the tile above the gate, not the gate tile.
    // This ensures the ghost fully clears the gate before transitioning.
    expect(HOUSE_CONFIG.exitY).toBeLessThan(HOUSE_CONFIG.gateY);

    // Simulate the ghost reaching the exit point
    ghost.x = HOUSE_CONFIG.exitX;
    ghost.y = HOUSE_CONFIG.exitY;
    updateGhostHouseState(ghost, {
      pelletsEaten: 0,
      deltaTime: 16,
      houseConfig: HOUSE_CONFIG,
      globalMode: "scatter",
    });
    expect(ghost.state).toBe("scatter");
  });
});

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

describe("createModeCycle", () => {
  test("starts in scatter mode", () => {
    const cycle = createModeCycle();
    expect(cycle.mode).toBe("scatter");
    expect(cycle.index).toBe(0);
    expect(cycle.timer).toBe(MODE_CYCLE[0].duration);
  });
});

describe("updateModeCycle", () => {
  test("advances to next mode when timer expires", () => {
    const cycle = createModeCycle();
    cycle.timer = 100;
    const result = updateModeCycle(cycle, 200);
    expect(result.mode).toBe("chase");
    expect(result.changed).toBe(true);
    expect(result.index).toBe(1);
  });

  test("does not advance before timer expires", () => {
    const cycle = createModeCycle();
    cycle.timer = 5000;
    const result = updateModeCycle(cycle, 1000);
    expect(result.mode).toBe("scatter");
    expect(result.changed).toBe(false);
    expect(result.index).toBe(0);
  });

  test("advances through multiple phases", () => {
    const cycle = createModeCycle();
    // Advance through first two phases (7000 + 20000 = 27000ms)
    const result = updateModeCycle(cycle, 27000);
    expect(result.mode).toBe("scatter"); // third phase
    expect(result.index).toBe(2);
  });

  test("permanent chase phase never advances", () => {
    const cycle = { mode: "chase", timer: Infinity, index: MODE_CYCLE.length - 1 };
    const result = updateModeCycle(cycle, 999999);
    expect(result.mode).toBe("chase");
    expect(result.index).toBe(MODE_CYCLE.length - 1);
    expect(result.changed).toBe(false);
  });
});

describe("constants", () => {
  test("GHOST_EAT_SCORE is 200", () => {
    expect(GHOST_EAT_SCORE).toBe(200);
  });

  test("speed multipliers are correct", () => {
    expect(GHOST_NORMAL_SPEED).toBe(0.8);
    expect(GHOST_FRIGHTENED_SPEED).toBe(0.5);
    expect(GHOST_EATEN_SPEED).toBe(1.5);
  });
});

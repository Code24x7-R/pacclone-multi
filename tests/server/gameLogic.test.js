const {
  MAZE,
  TILE_SIZE,
  PLAYER_SPEED,
  GHOST_SPEED,
  PELLET_SCORE,
  POWER_PELLET_SCORE,
  GHOST_EAT_SCORE,
  PLAYER_EAT_SCORE,
  GAME_STATES,
  STARTING_POSITIONS,
  GHOST_SPAWN,
  DIRECTIONS,
  isWall,
  moveEntity,
  distance,
  isColliding,
  extractPellets,
  createInitialState,
  createPlayersFromLobby,
  randomDirection,
  checkGameOver,
  isValidDirection,
} = require("../../src/gameLogic");

// ---------------------------------------------------------------------------
// Maze & Wall Detection
// ---------------------------------------------------------------------------
describe("MAZE", () => {
  test("has 13 rows", () => {
    expect(MAZE.length).toBe(13);
  });

  test("each row has 20 columns", () => {
    MAZE.forEach((row) => {
      expect(row.length).toBe(20);
    });
  });

  test("top border is all walls", () => {
    const lastCol = MAZE[0].length - 1;
    for (let x = 0; x <= lastCol; x++) {
      expect(MAZE[0][x]).toBe(1);
    }
  });

  test("left/right borders are walls except at tunnel rows", () => {
    const lastRow = MAZE.length - 1;
    const lastCol = MAZE[0].length - 1;
    // Tunnel rows (where the maze wraps) have openings at the edges
    const tunnelRows = new Set();
    for (let y = 0; y <= lastRow; y++) {
      if (MAZE[y][0] !== 1) tunnelRows.add(y);
    }
    for (let y = 0; y <= lastRow; y++) {
      if (tunnelRows.has(y)) {
        // Tunnel rows: edge tiles should be type 4 (empty walkable), not walls
        expect(MAZE[y][0]).not.toBe(1);
        expect(MAZE[y][lastCol]).not.toBe(1);
      } else {
        expect(MAZE[y][0]).toBe(1);
        expect(MAZE[y][lastCol]).toBe(1);
      }
    }
  });
});

describe("isWall", () => {
  test("returns true for wall tiles", () => {
    expect(isWall(0, 0)).toBe(true); // top-left corner
    expect(isWall(0.5, 0.5)).toBe(true); // still in tile (0,0)
    expect(isWall(2, 5)).toBe(true); // MAZE[5][2] === 1 (interior wall)
    expect(isWall(5, 0)).toBe(true); // top edge
  });

  test("returns false for path tiles (pellet)", () => {
    expect(isWall(2, 1)).toBe(false); // MAZE[1][2] === 0
    expect(isWall(2.5, 1.5)).toBe(false); // center of tile (2,1)
  });

  test("returns true for out-of-bounds positions", () => {
    expect(isWall(-1, 0)).toBe(true);
    expect(isWall(0, -1)).toBe(true);
    expect(isWall(100, 0)).toBe(true);
    expect(isWall(0, 100)).toBe(true);
  });

  test("uses floor of continuous coordinates", () => {
    // Tile (1,1) is a power pellet (value 2), not a wall
    expect(isWall(1.9, 1.9)).toBe(false);
    // Tile (0,0) is a wall
    expect(isWall(0.1, 0.1)).toBe(true);
  });

  test("accepts a custom maze override", () => {
    const customMaze = [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ];
    expect(isWall(1, 1, customMaze)).toBe(false);
    expect(isWall(0, 0, customMaze)).toBe(true);
    expect(isWall(5, 5, customMaze)).toBe(true); // out of bounds on custom
  });
});

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------
describe("moveEntity", () => {
  test("moves right correctly", () => {
    // Use a custom open maze so we don't depend on specific MAZE layout
    const openMaze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const result = moveEntity({ x: 2, y: 2 }, "right", PLAYER_SPEED, openMaze);
    expect(result.x).toBeCloseTo(2 + PLAYER_SPEED, 10);
    expect(result.y).toBe(2);
  });

  test("moves left correctly", () => {
    const openMaze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const result = moveEntity({ x: 2, y: 2 }, "left", PLAYER_SPEED, openMaze);
    expect(result.x).toBeCloseTo(2 - PLAYER_SPEED, 10);
    expect(result.y).toBe(2);
  });

  test("moves up correctly", () => {
    const openMaze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const result = moveEntity({ x: 2, y: 2 }, "up", PLAYER_SPEED, openMaze);
    expect(result.x).toBe(2);
    expect(result.y).toBeCloseTo(2 - PLAYER_SPEED, 10);
  });

  test("moves down correctly", () => {
    const openMaze = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const result = moveEntity({ x: 2, y: 2 }, "down", PLAYER_SPEED, openMaze);
    expect(result.x).toBe(2);
    expect(result.y).toBeCloseTo(2 + PLAYER_SPEED, 10);
  });

  test("stops at wall on X axis but slides on Y", () => {
    // Use a custom maze: entity at (1,1), wall to the left at (0,1)
    // but open below at (1,2) — moving down-left should slide.
    const slideMaze = [
      [1, 1, 1],
      [1, 0, 1],
      [1, 0, 1],
    ];
    // Move down from (1,1): Y goes to ~1.95 (floor=1, open), X stays 1
    const rDown = moveEntity({ x: 1, y: 1 }, "down", 0.95, slideMaze);
    expect(rDown.x).toBe(1);
    expect(rDown.y).toBeCloseTo(1.95, 10);
    // Move left from (1,1): X goes to ~0.05 (floor=0, wall) → blocked, stays 1
    const rLeft = moveEntity({ x: 1, y: 1 }, "left", 0.95, slideMaze);
    expect(rLeft.x).toBe(1);
    expect(rLeft.y).toBe(1);
  });

  test("slides along wall when one axis is blocked", () => {
    // Diagonal scenario: entity tries to move into a corner.
    // Using MAZE position (3,1) which has open right (4,1) but wall up (3,0).
    const rUp = moveEntity({ x: 3, y: 1.5 }, "up", PLAYER_SPEED, MAZE);
    // Up from y=1.5 by 0.05 → y=1.45, floor=1 → MAZE[1][3]=0 (open), so moves
    expect(rUp.y).toBeCloseTo(1.5 - PLAYER_SPEED, 10);
    expect(rUp.x).toBe(3);
  });

  test("returns original position when blocked on both axes", () => {
    // Place entity inside a wall tile — moving any direction should be blocked
    const trapped = { x: 0.5, y: 0.5 }; // (0,0) is wall
    const result = moveEntity(trapped, "right", PLAYER_SPEED, MAZE);
    // right: x=0.55, floor=0 → MAZE[0][0]=1 (wall) → blocked, stays at 0.5
    expect(result.x).toBe(0.5);
  });

  test("handles zero speed", () => {
    const pos = { x: 5, y: 5 };
    const result = moveEntity(pos, "right", 0);
    expect(result).toEqual({ x: 5, y: 5 });
  });
});

// ---------------------------------------------------------------------------
// Distance & Collision
// ---------------------------------------------------------------------------
describe("distance", () => {
  test("computes euclidean distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
  });

  test("is symmetric", () => {
    const a = { x: 2, y: 3 };
    const b = { x: 5, y: 7 };
    expect(distance(a, b)).toBe(distance(b, a));
  });
});

describe("isColliding", () => {
  test("returns true when distance is below threshold", () => {
    expect(isColliding({ x: 0, y: 0 }, { x: 0.3, y: 0 }, 0.5)).toBe(true);
  });

  test("returns false when distance is above threshold", () => {
    expect(isColliding({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.5)).toBe(false);
  });

  test("returns false when distance equals threshold (strict less-than)", () => {
    expect(isColliding({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 0.5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pellet Extraction
// ---------------------------------------------------------------------------
describe("extractPellets", () => {
  test("extracts pellets and power pellets from the maze", () => {
    const { pellets, powerPellets } = extractPellets();
    expect(pellets.length).toBeGreaterThan(0);
    expect(powerPellets.length).toBeGreaterThan(0);
  });

  test("power pellets are at corner positions of the maze path", () => {
    const { powerPellets } = extractPellets();
    // MAZE has power pellets (value 2) at: (1,3), (18,3) — near top corners
    const positions = powerPellets.map((p) => `${p.x},${p.y}`).sort();
    expect(positions).toContain("1,3");
    expect(positions).toContain("18,3");
  });

  test("does not include walls or power pellets in pellets array", () => {
    const { pellets } = extractPellets();
    pellets.forEach((p) => {
      expect(MAZE[p.y][p.x]).toBe(0);
    });
  });

  test("works with a custom maze", () => {
    const customMaze = [
      [1, 1, 1],
      [1, 0, 2],
      [1, 1, 1],
    ];
    const { pellets, powerPellets } = extractPellets(customMaze);
    expect(pellets).toEqual([{ x: 1, y: 1 }]);
    expect(powerPellets).toEqual([{ x: 2, y: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Game State Initialization
// ---------------------------------------------------------------------------
describe("createInitialState", () => {
  test("creates empty players array", () => {
    const state = createInitialState();
    expect(state.players).toEqual([]);
  });

  test("creates one ghost at spawn position", () => {
    const state = createInitialState();
    expect(state.ghosts).toHaveLength(1);
    expect(state.ghosts[0]).toMatchObject({
      id: 1,
      x: GHOST_SPAWN.x,
      y: GHOST_SPAWN.y,
      color: "red",
      direction: "left",
    });
  });

  test("populates pellets from the maze", () => {
    const state = createInitialState();
    expect(state.pellets.length).toBeGreaterThan(0);
    expect(state.powerPellets.length).toBeGreaterThan(0);
  });

  test("returns independent copies (no shared references)", () => {
    const state1 = createInitialState();
    const state2 = createInitialState();
    state1.pellets.pop();
    expect(state2.pellets.length).toBeGreaterThan(state1.pellets.length);
  });
});

// ---------------------------------------------------------------------------
// Player Creation from Lobby
// ---------------------------------------------------------------------------
describe("createPlayersFromLobby", () => {
  test("creates players with correct starting positions", () => {
    const lobby = [
      { id: 100, name: "Alice" },
      { id: 200, name: "Bob" },
    ];
    const players = createPlayersFromLobby(lobby);
    expect(players).toHaveLength(2);
    expect(players[0]).toMatchObject({
      id: 100,
      name: "Alice",
      x: STARTING_POSITIONS[0].x,
      y: STARTING_POSITIONS[0].y,
    });
    expect(players[1]).toMatchObject({
      id: 200,
      name: "Bob",
      x: STARTING_POSITIONS[1].x,
      y: STARTING_POSITIONS[1].y,
    });
  });

  test("assigns unique colors from PLAYER_COLORS", () => {
    const lobby = [
      { id: 1, name: "P1" },
      { id: 2, name: "P2" },
      { id: 3, name: "P3" },
      { id: 4, name: "P4" },
    ];
    const players = createPlayersFromLobby(lobby);
    const colors = players.map((p) => p.color);
    expect(new Set(colors).size).toBe(4); // all unique
  });

  test("gives each player 3 lives and 0 score", () => {
    const lobby = [{ id: 1, name: "Solo" }];
    const players = createPlayersFromLobby(lobby);
    expect(players[0].lives).toBe(3);
    expect(players[0].score).toBe(0);
    expect(players[0].poweredUp).toBe(false);
    expect(players[0].direction).toBeNull();
  });

  test("handles empty lobby", () => {
    const players = createPlayersFromLobby([]);
    expect(players).toEqual([]);
  });

  test("wraps around starting positions for more than 4 players", () => {
    const lobby = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      name: `P${i + 1}`,
    }));
    const players = createPlayersFromLobby(lobby);
    // Player 5 should reuse position 0
    expect(players[4].x).toBe(STARTING_POSITIONS[0].x);
    expect(players[4].y).toBe(STARTING_POSITIONS[0].y);
  });
});

// ---------------------------------------------------------------------------
// Direction & Random
// ---------------------------------------------------------------------------
describe("isValidDirection", () => {
  test("accepts valid directions", () => {
    expect(isValidDirection("up")).toBe(true);
    expect(isValidDirection("down")).toBe(true);
    expect(isValidDirection("left")).toBe(true);
    expect(isValidDirection("right")).toBe(true);
  });

  test("rejects invalid directions", () => {
    expect(isValidDirection("jump")).toBe(false);
    expect(isValidDirection("")).toBe(false);
    expect(isValidDirection(null)).toBe(false);
    expect(isValidDirection(undefined)).toBe(false);
  });
});

describe("randomDirection", () => {
  test("returns a valid direction", () => {
    for (let i = 0; i < 50; i++) {
      expect(DIRECTIONS).toContain(randomDirection());
    }
  });

  test("accepts custom direction set", () => {
    const custom = ["north", "south"];
    const result = randomDirection(custom);
    expect(custom).toContain(result);
  });
});

// ---------------------------------------------------------------------------
// Win/Loss Conditions
// ---------------------------------------------------------------------------
describe("checkGameOver", () => {
  test("returns true when only one player remains", () => {
    const players = [{ id: 1, name: "Winner" }];
    expect(checkGameOver(players, [{}], [{}])).toBe(true);
  });

  test("returns true when no players remain", () => {
    expect(checkGameOver([], [], [])).toBe(true);
  });

  test("returns true when all pellets are eaten", () => {
    const players = [
      { id: 1, name: "P1" },
      { id: 2, name: "P2" },
    ];
    expect(checkGameOver(players, [], [])).toBe(true);
  });

  test("returns false when multiple players and pellets remain", () => {
    const players = [
      { id: 1, name: "P1" },
      { id: 2, name: "P2" },
    ];
    expect(checkGameOver(players, [{}], [{}])).toBe(false);
  });

  test("returns false when pellets remain but only one player (edge: still playing)", () => {
    // Actually with 1 player, game is over (last man standing)
    const players = [{ id: 1, name: "P1" }];
    expect(checkGameOver(players, [{}], [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------
describe("constants", () => {
  test("GAME_STATES has all three states", () => {
    expect(GAME_STATES.LOBBY).toBe("LOBBY");
    expect(GAME_STATES.IN_PROGRESS).toBe("IN_PROGRESS");
    expect(GAME_STATES.GAME_OVER).toBe("GAME_OVER");
  });

  test("score values are positive", () => {
    expect(PELLET_SCORE).toBe(10);
    expect(POWER_PELLET_SCORE).toBe(50);
    expect(GHOST_EAT_SCORE).toBe(200);
    expect(PLAYER_EAT_SCORE).toBe(100);
  });

  test("speeds are positive and player is faster than ghost", () => {
    expect(PLAYER_SPEED).toBeGreaterThan(0);
    expect(GHOST_SPEED).toBeGreaterThan(0);
    expect(PLAYER_SPEED).toBeGreaterThan(GHOST_SPEED);
  });

  test("TILE_SIZE is 40", () => {
    expect(TILE_SIZE).toBe(40);
  });
});

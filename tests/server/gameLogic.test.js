const {
  MAZE,
  TILE_SIZE,
  PLAYER_SPEED,
  GHOST_SPEED,
  PELLET_SCORE,
  POWER_PELLET_SCORE,
  PLAYER_EAT_SCORE,
  GAME_STATES,
  STARTING_POSITIONS,
  isWall,
  extractPellets,
  createPlayersFromLobby,
  buildGameStatePayload,
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
// Pellet Extraction
// ---------------------------------------------------------------------------
describe("extractPellets", () => {
  test("extracts pellets and power pellets from the maze", () => {
    const { pellets } = extractPellets();
    expect(pellets.length).toBeGreaterThan(0);
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
// Regression: gameState payload must be JSON-serializable
// ---------------------------------------------------------------------------
describe("buildGameStatePayload JSON safety", () => {
  test("serializes without circular-reference errors (regression for Timeout crash)", () => {
    // Simulate a live game state with powered-up players (the bug was caused
    // by storing a setTimeout Timeout object on the player, which has circular
    // _idlePrev/_idleNext references).
    const players = [
      {
        id: 1,
        name: "Henry",
        x: 1.5,
        y: 1.5,
        color: "yellow",
        lives: 3,
        score: 100,
        direction: "left",
        poweredUp: true,
        poweredUpTicks: 480, // tick-based timer (plain number, serializable)
      },
      {
        id: 2,
        name: "Suzi",
        x: 18.5,
        y: 1.5,
        color: "lime",
        lives: 3,
        score: 50,
        direction: "right",
        poweredUp: false,
        poweredUpTicks: 0,
      },
    ];
    const ghosts = [
      { id: "blinky", name: "Blinky", x: 9.5, y: 8.5, color: "red", direction: "left", state: "chase", frightened: false, eaten: false, speed: 0.8 },
      { id: "pinky", name: "Pinky", x: 9.5, y: 9.5, color: "pink", direction: "down", state: "frightened", frightened: true, eaten: false, speed: 0.5 },
    ];
    const pellets = [{ x: 1, y: 1 }];
    const powerPellets = [{ x: 1, y: 3 }];

    const payload = buildGameStatePayload(
      MAZE,
      players,
      ghosts,
      pellets,
      powerPellets,
      GAME_STATES.IN_PROGRESS,
    );

    // This must not throw "Converting circular structure to JSON"
    expect(() => JSON.stringify(payload)).not.toThrow();

    // Round-trip check
    const roundTripped = JSON.parse(JSON.stringify(payload));
    expect(roundTripped.players[0].poweredUp).toBe(true);
    expect(roundTripped.ghosts[1].state).toBe("frightened");
    expect(roundTripped.currentGameState).toBe("IN_PROGRESS");
  });

  test("a player with a real Timeout object WOULD throw (documents the original bug)", () => {
    // Proves the test above actually catches the class of bug that crashed the server
    const playerWithTimeout = {
      id: 1,
      name: "Bug",
      x: 1.5,
      y: 1.5,
      color: "yellow",
      lives: 3,
      score: 0,
      direction: null,
      poweredUp: true,
      powerTimeout: setTimeout(() => {}, 1000), // circular!
    };
    const payload = buildGameStatePayload(
      MAZE,
      [playerWithTimeout],
      [],
      [],
      [],
      GAME_STATES.IN_PROGRESS,
    );
    expect(() => JSON.stringify(payload)).toThrow(TypeError);
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
// Constants sanity checks
// ---------------------------------------------------------------------------
describe("constants", () => {
  test("GAME_STATES has all four states", () => {
    expect(GAME_STATES.LOBBY).toBe("LOBBY");
    expect(GAME_STATES.IN_PROGRESS).toBe("IN_PROGRESS");
    expect(GAME_STATES.LEVEL_COMPLETE).toBe("LEVEL_COMPLETE");
    expect(GAME_STATES.GAME_OVER).toBe("GAME_OVER");
  });

  test("score values are positive", () => {
    expect(PELLET_SCORE).toBe(10);
    expect(POWER_PELLET_SCORE).toBe(50);
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

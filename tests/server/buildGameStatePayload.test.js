const {
  GAME_STATES,
  buildGameStatePayload,
} = require("../../src/gameLogic");

/**
 * Regression test for B-001:
 * The server's gameState broadcast must always include `currentGameState`
 * so the client can decide whether to render the lobby or the game board.
 * Previously the regular broadcast omitted it, causing a blank screen.
 */
describe("buildGameStatePayload", () => {
  const maze = [[1, 1], [1, 0]];
  const players = [{ id: 1, name: "P1" }];
  const ghosts = [{ id: 1, x: 1, y: 1 }];
  const pellets = [{ x: 1, y: 1 }];
  const powerPellets = [];

  test("includes currentGameState when IN_PROGRESS", () => {
    const payload = buildGameStatePayload(
      maze,
      players,
      ghosts,
      pellets,
      powerPellets,
      GAME_STATES.IN_PROGRESS,
    );
    expect(payload.currentGameState).toBe("IN_PROGRESS");
  });

  test("includes currentGameState when GAME_OVER", () => {
    const payload = buildGameStatePayload(
      maze,
      players,
      ghosts,
      pellets,
      powerPellets,
      GAME_STATES.GAME_OVER,
    );
    expect(payload.currentGameState).toBe("GAME_OVER");
  });

  test("includes currentGameState when LOBBY", () => {
    const payload = buildGameStatePayload(
      maze,
      players,
      ghosts,
      pellets,
      powerPellets,
      GAME_STATES.LOBBY,
    );
    expect(payload.currentGameState).toBe("LOBBY");
  });

  test("includes all entity arrays", () => {
    const payload = buildGameStatePayload(
      maze,
      players,
      ghosts,
      pellets,
      powerPellets,
      GAME_STATES.IN_PROGRESS,
    );
    expect(payload.maze).toBe(maze);
    expect(payload.players).toBe(players);
    expect(payload.ghosts).toBe(ghosts);
    expect(payload.pellets).toBe(pellets);
    expect(payload.powerPellets).toBe(powerPellets);
  });

  test("returns exactly the six expected keys", () => {
    const payload = buildGameStatePayload(
      maze,
      players,
      ghosts,
      pellets,
      powerPellets,
      GAME_STATES.IN_PROGRESS,
    );
    expect(Object.keys(payload).sort()).toEqual(
      ["currentGameState", "ghosts", "maze", "pellets", "players", "powerPellets"].sort(),
    );
  });
});

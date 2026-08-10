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

  test("returns exactly the expected keys", () => {
    const weapons = [{ x: 1, y: 1, type: 'pistol' }];
    const projectiles = [{ x: 1.5, y: 1.5, direction: 'right' }];
    const payload = buildGameStatePayload(
      maze,
      players,
      ghosts,
      pellets,
      powerPellets,
      GAME_STATES.IN_PROGRESS,
      1,
      weapons,
      projectiles,
    );
    expect(Object.keys(payload).sort()).toEqual(
      ["currentGameState", "ghosts", "level", "maze", "pellets", "players", "powerPellets", "weapons", "projectiles"].sort(),
    );
  });

  test("weapons and projectiles default to empty arrays", () => {
    const payload = buildGameStatePayload(
      maze,
      players,
      ghosts,
      pellets,
      powerPellets,
      GAME_STATES.IN_PROGRESS,
    );
    expect(payload.weapons).toEqual([]);
    expect(payload.projectiles).toEqual([]);
  });

  test("level defaults to 1 when omitted", () => {
    const payload = buildGameStatePayload(
      maze,
      players,
      ghosts,
      pellets,
      powerPellets,
      GAME_STATES.IN_PROGRESS,
    );
    expect(payload.level).toBe(1);
  });

  test("level reflects the provided value", () => {
    const payload = buildGameStatePayload(
      maze,
      players,
      ghosts,
      pellets,
      powerPellets,
      GAME_STATES.IN_PROGRESS,
      5,
    );
    expect(payload.level).toBe(5);
  });

  test("includes LEVEL_COMPLETE in supported states", () => {
    const payload = buildGameStatePayload(
      maze,
      players,
      ghosts,
      pellets,
      powerPellets,
      GAME_STATES.LEVEL_COMPLETE,
      2,
    );
    expect(payload.currentGameState).toBe("LEVEL_COMPLETE");
    expect(payload.level).toBe(2);
  });
});

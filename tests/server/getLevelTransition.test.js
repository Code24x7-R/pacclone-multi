/**
 * Tests for src/gameLogic.js — getLevelTransition pure function.
 *
 * Determines whether a level should continue, advance (all pellets eaten
 * with multiple players), or end the match (last man standing).
 */
const { getLevelTransition } = require('../../src/gameLogic');

describe('getLevelTransition', () => {
  test('returns null when pellets remain (level continues)', () => {
    const players = [{ id: 1 }, { id: 2 }];
    const pellets = [{ x: 1, y: 1 }];
    const powerPellets = [];
    expect(getLevelTransition(players, pellets, powerPellets)).toBeNull();
  });

  test('returns null when only power pellets remain', () => {
    const players = [{ id: 1 }, { id: 2 }];
    const pellets = [];
    const powerPellets = [{ x: 1, y: 1 }];
    expect(getLevelTransition(players, pellets, powerPellets)).toBeNull();
  });

  test('returns LEVEL_COMPLETE when all pellets eaten with 2 players', () => {
    const players = [{ id: 1 }, { id: 2 }];
    const pellets = [];
    const powerPellets = [];
    expect(getLevelTransition(players, pellets, powerPellets)).toBe(
      'LEVEL_COMPLETE',
    );
  });

  test('returns LEVEL_COMPLETE when all pellets eaten with 4 players', () => {
    const players = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const pellets = [];
    const powerPellets = [];
    expect(getLevelTransition(players, pellets, powerPellets)).toBe(
      'LEVEL_COMPLETE',
    );
  });

  test('returns GAME_OVER when only 1 player remains (last man standing)', () => {
    const players = [{ id: 1 }];
    const pellets = [];
    const powerPellets = [];
    expect(getLevelTransition(players, pellets, powerPellets)).toBe('GAME_OVER');
  });

  test('returns GAME_OVER when 0 players remain', () => {
    const players = [];
    const pellets = [];
    const powerPellets = [];
    expect(getLevelTransition(players, pellets, powerPellets)).toBe('GAME_OVER');
  });

  test('last man standing takes priority over all-pellets-eaten with 1 player', () => {
    // Even if pellets remain, a single player means the match is over.
    const players = [{ id: 1 }];
    const pellets = [{ x: 1, y: 1 }];
    const powerPellets = [];
    expect(getLevelTransition(players, pellets, powerPellets)).toBe('GAME_OVER');
  });

  test('handles large pellet counts correctly', () => {
    const players = [{ id: 1 }, { id: 2 }];
    const pellets = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 1 }));
    const powerPellets = [];
    expect(getLevelTransition(players, pellets, powerPellets)).toBeNull();
  });
});

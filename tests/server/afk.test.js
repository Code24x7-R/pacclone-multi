/**
 * Unit tests for the pure AFK detection helper findAfkPlayerIndices.
 *
 * The helper is the single source of truth for "is this player idle?" — the
 * server's periodic sweep consumes its output, so correctness here guarantees
 * the sweep behaves. We verify:
 *   - Players with no lastActivity are never flagged (treated as fresh).
 *   - Players within the timeout are not flagged.
 *   - Players past the timeout are flagged, in ascending index order.
 *   - The boundary (exactly at timeout) is NOT flagged (must be strictly >).
 *   - Empty input returns empty output.
 *   - Custom now / timeout arguments are honoured.
 */
const {
  findAfkPlayerIndices,
  AFK_TIMEOUT_MS,
} = require('../../src/gameLogic');

describe('findAfkPlayerIndices', () => {
  test('returns empty array for empty input', () => {
    expect(findAfkPlayerIndices([])).toEqual([]);
  });

  test('does not flag players without a lastActivity (fresh / unknown)', () => {
    const players = [
      { id: 'a', name: 'A' }, // no lastActivity
      { id: 'b', name: 'B', lastActivity: 0 }, // falsy → treated as fresh
    ];
    expect(findAfkPlayerIndices(players, 999999999999)).toEqual([]);
  });

  test('does not flag players within the timeout window', () => {
    const now = 1000000;
    const players = [
      { id: 'a', lastActivity: now - AFK_TIMEOUT_MS + 1 }, // 1ms inside
      { id: 'b', lastActivity: now }, // just active
    ];
    expect(findAfkPlayerIndices(players, now, AFK_TIMEOUT_MS)).toEqual([]);
  });

  test('flags players strictly past the timeout, ascending index order', () => {
    const now = 1000000;
    const timeout = 5000;
    const players = [
      { id: 'a', lastActivity: now - 1000 }, // active
      { id: 'b', lastActivity: now - 6000 }, // AFK (6000 > 5000)
      { id: 'c', lastActivity: now - 5001 }, // AFK (5001 > 5000)
      { id: 'd', lastActivity: now - 5000 }, // boundary: NOT afk (5000 !> 5000)
      { id: 'e', lastActivity: now - 9999 }, // AFK
    ];
    expect(findAfkPlayerIndices(players, now, timeout)).toEqual([1, 2, 4]);
  });

  test('honours a custom timeout', () => {
    const now = 50000;
    const players = [{ id: 'a', lastActivity: now - 250 }];
    // Default AFK_TIMEOUT_MS is 120000, so 250ms in is NOT afk by default.
    expect(findAfkPlayerIndices(players, now)).toEqual([]);
    // With a custom 100ms timeout, 250ms in IS afk.
    expect(findAfkPlayerIndices(players, now, 100)).toEqual([0]);
  });

  test('all-AFK returns every index', () => {
    const now = 0;
    const timeout = 1;
    const players = [
      { id: 'a', lastActivity: -100 },
      { id: 'b', lastActivity: -200 },
      { id: 'c', lastActivity: -300 },
    ];
    expect(findAfkPlayerIndices(players, now, timeout)).toEqual([0, 1, 2]);
  });

  test('all-active returns no indices', () => {
    const now = 100000;
    const players = [
      { id: 'a', lastActivity: now - 10 },
      { id: 'b', lastActivity: now - 20 },
    ];
    expect(findAfkPlayerIndices(players, now, 1000)).toEqual([]);
  });
});

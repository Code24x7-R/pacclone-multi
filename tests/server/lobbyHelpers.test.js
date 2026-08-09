const {
  rebuildLobbyFromMatch,
  areAllReady,
  togglePlayerReady,
  getCountdownTick,
  isWithinGracePeriod,
  COUNTDOWN_DURATION_MS,
  RECONNECT_GRACE_MS,
  GAME_STATES,
} = require('../../src/gameLogic');

describe('GAME_STATES', () => {
  test('includes COUNTDOWN', () => {
    expect(GAME_STATES.COUNTDOWN).toBe('COUNTDOWN');
  });
});

describe('rebuildLobbyFromMatch', () => {
  // Real game players carry `id` === their stable token (no separate token
  // field). The function carries id through as the token on rebuilt players.
  const matchPlayers = [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
    { id: 'p3', name: 'Cara' },
  ];

  test('places the winner first so they become the new host', () => {
    const lobby = rebuildLobbyFromMatch(matchPlayers, 'p2');
    expect(lobby[0]).toMatchObject({ id: 'p2', name: 'Bob' });
  });

  test('preserves relative order of non-winners', () => {
    const lobby = rebuildLobbyFromMatch(matchPlayers, 'p2');
    // p1 and p3 keep their original relative order after the winner.
    const ids = lobby.map((p) => p.id);
    expect(ids).toEqual(['p2', 'p1', 'p3']);
  });

  test('sets every player to ready: false', () => {
    const lobby = rebuildLobbyFromMatch(matchPlayers, 'p1');
    expect(lobby.every((p) => p.ready === false)).toBe(true);
  });

  test('carries the stable token onto each lobby player', () => {
    const lobby = rebuildLobbyFromMatch(matchPlayers, null);
    // The id IS the token, so rebuilt players carry id as their token.
    expect(lobby.map((p) => p.token)).toEqual(['p1', 'p2', 'p3']);
    expect(lobby.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  test('does not mutate the input array', () => {
    const snapshot = JSON.stringify(matchPlayers);
    rebuildLobbyFromMatch(matchPlayers, 'p3');
    expect(JSON.stringify(matchPlayers)).toBe(snapshot);
  });

  test('handles a null winner without crashing', () => {
    const lobby = rebuildLobbyFromMatch(matchPlayers, null);
    expect(lobby.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  test('handles an empty match', () => {
    expect(rebuildLobbyFromMatch([], null)).toEqual([]);
  });

  test('handles a winner id that is not in the list', () => {
    const lobby = rebuildLobbyFromMatch(matchPlayers, 'nonexistent');
    // No player matches, so order is unchanged.
    expect(lobby.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('areAllReady', () => {
  test('returns false for an empty lobby', () => {
    expect(areAllReady([])).toBe(false);
  });

  test('returns true when every player is ready', () => {
    const lobby = [
      { token: 'a', ready: true },
      { token: 'b', ready: true },
    ];
    expect(areAllReady(lobby)).toBe(true);
  });

  test('returns false when any player is not ready', () => {
    const lobby = [
      { token: 'a', ready: true },
      { token: 'b', ready: false },
    ];
    expect(areAllReady(lobby)).toBe(false);
  });

  test('returns false when no players are ready', () => {
    const lobby = [
      { token: 'a', ready: false },
      { token: 'b', ready: false },
    ];
    expect(areAllReady(lobby)).toBe(false);
  });
});

describe('togglePlayerReady', () => {
  // Real lobby players carry both id and token (id === token). The function
  // matches by id.
  const lobby = [
    { id: 'a', token: 'a', ready: false },
    { id: 'b', token: 'b', ready: true },
    { id: 'c', token: 'c', ready: false },
  ];

  test('toggles the matching player from false to true', () => {
    const next = togglePlayerReady(lobby, 'a');
    expect(next.find((p) => p.id === 'a').ready).toBe(true);
  });

  test('toggles the matching player from true to false', () => {
    const next = togglePlayerReady(lobby, 'b');
    expect(next.find((p) => p.id === 'b').ready).toBe(false);
  });

  test('does not change other players', () => {
    const next = togglePlayerReady(lobby, 'a');
    expect(next.find((p) => p.id === 'b').ready).toBe(true);
    expect(next.find((p) => p.id === 'c').ready).toBe(false);
  });

  test('returns a new array (does not mutate input)', () => {
    const snapshot = JSON.stringify(lobby);
    togglePlayerReady(lobby, 'a');
    expect(JSON.stringify(lobby)).toBe(snapshot);
  });

  test('is a no-op for an unknown token', () => {
    const next = togglePlayerReady(lobby, 'zzz');
    expect(next).toEqual(lobby);
  });
});

describe('getCountdownTick', () => {
  test('returns 3 during the first second', () => {
    expect(getCountdownTick(0)).toBe(3);
    expect(getCountdownTick(500)).toBe(3);
    expect(getCountdownTick(999)).toBe(3);
  });

  test('returns 2 during the second second', () => {
    expect(getCountdownTick(1000)).toBe(2);
    expect(getCountdownTick(1500)).toBe(2);
    expect(getCountdownTick(1999)).toBe(2);
  });

  test('returns 1 during the third second', () => {
    expect(getCountdownTick(2000)).toBe(1);
    expect(getCountdownTick(2500)).toBe(1);
    expect(getCountdownTick(2999)).toBe(1);
  });

  test('returns 0 once the countdown completes', () => {
    expect(getCountdownTick(COUNTDOWN_DURATION_MS)).toBe(0);
    expect(getCountdownTick(COUNTDOWN_DURATION_MS + 1000)).toBe(0);
  });
});

describe('isWithinGracePeriod', () => {
  const now = 1000000;

  test('returns true immediately after disconnect', () => {
    expect(isWithinGracePeriod(now, now)).toBe(true);
  });

  test('returns true just before the grace window closes', () => {
    expect(isWithinGracePeriod(now, now + RECONNECT_GRACE_MS - 1)).toBe(true);
  });

  test('returns false once the grace window has elapsed', () => {
    expect(isWithinGracePeriod(now, now + RECONNECT_GRACE_MS)).toBe(false);
    expect(isWithinGracePeriod(now, now + RECONNECT_GRACE_MS + 1)).toBe(false);
  });
});

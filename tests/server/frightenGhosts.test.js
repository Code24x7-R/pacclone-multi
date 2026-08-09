/**
 * frightenGhosts.test.js / revertFrightenedGhosts.test.js
 *
 * When a power pellet is eaten, EVERY non-eaten ghost must turn scared — including
 * ghosts still in the house or mid-exit. Before the fix, the code skipped
 * inHouse ghosts entirely (they never turned blue), and exitingHouse ghosts got
 * frightened=true but were never reverted when the timer expired (the reversion
 * check only looked at state === 'frightened').
 *
 * These helpers centralize that logic so it can be unit-tested in isolation.
 */

const { frightenGhosts, revertFrightenedGhosts } = require('../../src/gameLogic');

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const FRIGHTENED_SPEED = 0.5;
const NORMAL_SPEED = 0.8;

// Helper: a minimal ghost object mirroring the server's shape.
function makeGhost(overrides = {}) {
  return {
    id: 'blinky',
    state: 'chase',
    direction: 'left',
    frightened: false,
    flashing: false,
    speed: NORMAL_SPEED,
    ...overrides,
  };
}

describe('frightenGhosts', () => {
  test('sets frightened on active patrolling ghosts and switches state', () => {
    const ghosts = [
      makeGhost({ id: 'a', state: 'chase', direction: 'left' }),
      makeGhost({ id: 'b', state: 'scatter', direction: 'up' }),
    ];
    frightenGhosts(ghosts, FRIGHTENED_SPEED, OPPOSITE);

    expect(ghosts[0].frightened).toBe(true);
    expect(ghosts[0].state).toBe('frightened');
    expect(ghosts[0].speed).toBe(FRIGHTENED_SPEED);
    expect(ghosts[0].direction).toBe('right'); // reversed

    expect(ghosts[1].frightened).toBe(true);
    expect(ghosts[1].state).toBe('frightened');
    expect(ghosts[1].direction).toBe('down'); // reversed
  });

  test('frightens ghosts still in the house (the reported bug)', () => {
    const ghosts = [makeGhost({ id: 'inky', state: 'inHouse' })];
    frightenGhosts(ghosts, FRIGHTENED_SPEED, OPPOSITE);

    // Must turn blue, but keep its state so house bobbing/release continues.
    expect(ghosts[0].frightened).toBe(true);
    expect(ghosts[0].state).toBe('inHouse');
    expect(ghosts[0].speed).toBe(FRIGHTENED_SPEED);
  });

  test('frightens ghosts mid-exit without changing their state', () => {
    const ghosts = [makeGhost({ id: 'clyde', state: 'exitingHouse' })];
    frightenGhosts(ghosts, FRIGHTENED_SPEED, OPPOSITE);

    expect(ghosts[0].frightened).toBe(true);
    expect(ghosts[0].state).toBe('exitingHouse'); // preserved for house logic
    expect(ghosts[0].speed).toBe(FRIGHTENED_SPEED);
  });

  test('skips already-eaten ghosts (eyes returning to house)', () => {
    const ghosts = [makeGhost({ id: 'eaten', state: 'eaten', eaten: true })];
    frightenGhosts(ghosts, FRIGHTENED_SPEED, OPPOSITE);

    expect(ghosts[0].frightened).toBe(false);
    expect(ghosts[0].state).toBe('eaten');
  });

  test('frightens a mixed group correctly (the full reported scenario)', () => {
    const ghosts = [
      makeGhost({ id: 'blinky', state: 'chase' }),
      makeGhost({ id: 'pinky', state: 'scatter' }),
      makeGhost({ id: 'inky', state: 'inHouse' }),
      makeGhost({ id: 'clyde', state: 'exitingHouse' }),
    ];
    frightenGhosts(ghosts, FRIGHTENED_SPEED, OPPOSITE);

    // Every non-eaten ghost must be frightened.
    ghosts.forEach(g => expect(g.frightened).toBe(true));
    // Patrolling ghosts changed state; house ghosts kept theirs.
    expect(ghosts[0].state).toBe('frightened');
    expect(ghosts[1].state).toBe('frightened');
    expect(ghosts[2].state).toBe('inHouse');
    expect(ghosts[3].state).toBe('exitingHouse');
  });

  test('re-frightening an already-frightened ghost just refreshes it', () => {
    const ghosts = [makeGhost({ state: 'frightened', frightened: true, direction: 'up' })];
    frightenGhosts(ghosts, FRIGHTENED_SPEED, OPPOSITE);

    expect(ghosts[0].frightened).toBe(true);
    expect(ghosts[0].state).toBe('frightened');
    // State was already 'frightened' so the inner branch does not reverse again.
    expect(ghosts[0].direction).toBe('up');
  });
});

describe('revertFrightenedGhosts', () => {
  test('reverts patrolling ghosts back to the mode cycle', () => {
    const ghosts = [
      makeGhost({ id: 'a', state: 'frightened', frightened: true, flashing: true, speed: FRIGHTENED_SPEED }),
    ];
    revertFrightenedGhosts(ghosts, NORMAL_SPEED, 'scatter');

    expect(ghosts[0].frightened).toBe(false);
    expect(ghosts[0].flashing).toBe(false);
    expect(ghosts[0].speed).toBe(NORMAL_SPEED);
    expect(ghosts[0].state).toBe('scatter');
  });

  test('reverts house ghosts without changing their state (the related bug)', () => {
    // An exitingHouse ghost that was frightened must be cleared of the
    // frightened flag but KEEP exiting — otherwise the house logic stalls.
    const ghosts = [
      makeGhost({ id: 'inky', state: 'inHouse', frightened: true }),
      makeGhost({ id: 'clyde', state: 'exitingHouse', frightened: true }),
    ];
    revertFrightenedGhosts(ghosts, NORMAL_SPEED, 'scatter');

    expect(ghosts[0].frightened).toBe(false);
    expect(ghosts[0].state).toBe('inHouse');
    expect(ghosts[1].frightened).toBe(false);
    expect(ghosts[1].state).toBe('exitingHouse');
  });

  test('leaves non-frightened ghosts untouched', () => {
    const ghosts = [
      makeGhost({ id: 'a', state: 'chase', frightened: false }),
      makeGhost({ id: 'b', state: 'eaten', frightened: false, eaten: true }),
    ];
    revertFrightenedGhosts(ghosts, NORMAL_SPEED, 'scatter');

    expect(ghosts[0].state).toBe('chase');
    expect(ghosts[1].state).toBe('eaten');
  });

  test('handles a mix of frightened patrolling and house ghosts', () => {
    const ghosts = [
      makeGhost({ id: 'a', state: 'frightened', frightened: true }),
      makeGhost({ id: 'b', state: 'inHouse', frightened: true }),
      makeGhost({ id: 'c', state: 'scatter', frightened: false }),
    ];
    revertFrightenedGhosts(ghosts, NORMAL_SPEED, 'chase');

    expect(ghosts[0]).toMatchObject({ frightened: false, state: 'chase' });
    expect(ghosts[1]).toMatchObject({ frightened: false, state: 'inHouse' });
    expect(ghosts[2]).toMatchObject({ frightened: false, state: 'scatter' });
  });

  test('no mode cycle yet defaults to scatter', () => {
    const ghosts = [makeGhost({ state: 'frightened', frightened: true })];
    revertFrightenedGhosts(ghosts, NORMAL_SPEED, 'scatter');
    expect(ghosts[0].state).toBe('scatter');
  });
});

describe('frighten then revert round-trip', () => {
  test('returns all ghosts to a normal, non-frightened state', () => {
    const ghosts = [
      makeGhost({ id: 'blinky', state: 'chase', direction: 'left' }),
      makeGhost({ id: 'pinky', state: 'scatter', direction: 'up' }),
      makeGhost({ id: 'inky', state: 'inHouse' }),
      makeGhost({ id: 'clyde', state: 'exitingHouse' }),
    ];
    const snapshot = ghosts.map(g => ({ state: g.state, direction: g.direction }));

    frightenGhosts(ghosts, FRIGHTENED_SPEED, OPPOSITE);
    // All non-eaten ghosts are frightened now.
    ghosts.forEach(g => expect(g.frightened).toBe(true));

    revertFrightenedGhosts(ghosts, NORMAL_SPEED, 'scatter');
    // No ghost is frightened; house ghosts kept their state; patrolling
    // ghosts returned to the supplied mode cycle.
    ghosts.forEach(g => expect(g.frightened).toBe(false));
    expect(ghosts[0].state).toBe('scatter');
    expect(ghosts[1].state).toBe('scatter');
    expect(ghosts[2].state).toBe(snapshot[2].state); // inHouse preserved
    expect(ghosts[3].state).toBe(snapshot[3].state); // exitingHouse preserved
  });
});

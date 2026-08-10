/**
 * frightenGhosts.test.js / revertFrightenedGhosts.test.js
 *
 * When a power pellet is eaten, ghosts OUTSIDE the house turn scared.
 * Ghosts inside the house (inHouse/exitingHouse) are NOT frightened —
 * only ghosts outside the house turn blue. This matches classic Pac-Man
 * behavior where house ghosts are immune to the power-up until they exit.
 *
 * Ghosts that exit the house while a power-up is active will become
 * frightened via the house state transition logic.
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

  test('does NOT frighten ghosts still in the house', () => {
    const ghosts = [makeGhost({ id: 'inky', state: 'inHouse' })];
    frightenGhosts(ghosts, FRIGHTENED_SPEED, OPPOSITE);

    // House ghosts are NOT frightened — only ghosts outside the house turn blue.
    expect(ghosts[0].frightened).toBe(false);
    expect(ghosts[0].state).toBe('inHouse');
    expect(ghosts[0].speed).toBe(NORMAL_SPEED);
  });

  test('does NOT frighten ghosts mid-exit', () => {
    const ghosts = [makeGhost({ id: 'clyde', state: 'exitingHouse' })];
    frightenGhosts(ghosts, FRIGHTENED_SPEED, OPPOSITE);

    expect(ghosts[0].frightened).toBe(false);
    expect(ghosts[0].state).toBe('exitingHouse'); // preserved for house logic
    expect(ghosts[0].speed).toBe(NORMAL_SPEED);
  });

  test('skips already-eaten ghosts (eyes returning to house)', () => {
    const ghosts = [makeGhost({ id: 'eaten', state: 'eaten', eaten: true })];
    frightenGhosts(ghosts, FRIGHTENED_SPEED, OPPOSITE);

    expect(ghosts[0].frightened).toBe(false);
    expect(ghosts[0].state).toBe('eaten');
  });

  test('frightens only patrolling ghosts in a mixed group', () => {
    const ghosts = [
      makeGhost({ id: 'blinky', state: 'chase' }),
      makeGhost({ id: 'pinky', state: 'scatter' }),
      makeGhost({ id: 'inky', state: 'inHouse' }),
      makeGhost({ id: 'clyde', state: 'exitingHouse' }),
    ];
    frightenGhosts(ghosts, FRIGHTENED_SPEED, OPPOSITE);

    // Only patrolling ghosts are frightened; house ghosts are NOT.
    expect(ghosts[0].frightened).toBe(true);
    expect(ghosts[1].frightened).toBe(true);
    expect(ghosts[2].frightened).toBe(false);
    expect(ghosts[3].frightened).toBe(false);
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

  test('reverts house ghosts without changing their state', () => {
    // House ghosts that were frightened (e.g., from exiting during power-up)
    // must be cleared of the frightened flag but keep their state.
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
      makeGhost({ id: 'b', state: 'inHouse', frightened: false }), // house ghosts not frightened
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
    // Only patrolling ghosts are frightened; house ghosts are NOT.
    expect(ghosts[0].frightened).toBe(true);
    expect(ghosts[1].frightened).toBe(true);
    expect(ghosts[2].frightened).toBe(false);
    expect(ghosts[3].frightened).toBe(false);

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

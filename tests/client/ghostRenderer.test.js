/**
 * Client-side tests for ghost rendering (src/ghostRenderer.js).
 *
 * Uses a mock CanvasRenderingContext2D that records fillStyle and path-drawing
 * calls so we can assert on the visual state without a real canvas.
 */
const { drawGhost, drawGhostEyes } = require('../../src/ghostRenderer');

// ---------------------------------------------------------------------------
// Mock Canvas 2D context — records calls for assertions
// ---------------------------------------------------------------------------
function createMockCtx() {
  const calls = [];
  const handler = {
    get(_target, prop) {
      if (prop === '__calls') return calls;
      // Any method call gets recorded with its arguments
      if (['beginPath', 'arc', 'rect', 'fill', 'fillRect', 'clearRect', 'fillText'].includes(prop)) {
        return (...args) => calls.push({ method: prop, args });
      }
      // Property assignments (fillStyle, font, etc.) are handled via set trap
      return undefined;
    },
    set(_target, prop, value) {
      calls.push({ set: prop, value });
      return true;
    },
  };
  return new Proxy({}, handler);
}

// Helper: count how many times a given fillStyle value was set
function countFillStyle(ctx, color) {
  return ctx.__calls.filter((c) => c.set === 'fillStyle' && c.value === color).length;
}

// Helper: count arc calls
function countArcs(ctx) {
  return ctx.__calls.filter((c) => c.method === 'arc').length;
}

// ---------------------------------------------------------------------------
// drawGhostEyes tests
// ---------------------------------------------------------------------------
describe('drawGhostEyes', () => {
  test('draws two white sclera and two pupils', () => {
    const ctx = createMockCtx();
    drawGhostEyes(ctx, 100, 100, 16, 'right', false);
    // 2 sclera arcs + 2 pupil arcs = 4 arcs
    expect(countArcs(ctx)).toBe(4);
    // White sclera set once (both eyes share fillStyle)
    expect(countFillStyle(ctx, 'white')).toBe(1);
    // Dark blue pupils for non-eaten
    expect(countFillStyle(ctx, '#1010a0')).toBe(1);
  });

  test('eaten ghost has blue pupils', () => {
    const ctx = createMockCtx();
    drawGhostEyes(ctx, 100, 100, 16, 'left', true);
    expect(countFillStyle(ctx, 'blue')).toBe(1);
    expect(countFillStyle(ctx, '#1010a0')).toBe(0);
  });

  test('pupils offset right when direction is right', () => {
    const ctx = createMockCtx();
    drawGhostEyes(ctx, 100, 100, 16, 'right', false);
    const arcs = ctx.__calls.filter((c) => c.method === 'arc');
    // Pupil arcs are the 3rd and 4th arcs (after 2 sclera)
    const pupil1 = arcs[2].args;
    const pupil2 = arcs[3].args;
    // Eye centers are at cx - r/2 = 92 and cx + r/2 = 108.
    // Pupils shift right by r/4 = +4, so they should be at 96 and 112.
    expect(pupil1[0]).toBeGreaterThan(92); // left eye pupil shifted right
    expect(pupil2[0]).toBeGreaterThan(108); // right eye pupil shifted right
  });

  test('pupils offset up when direction is up', () => {
    const ctx = createMockCtx();
    drawGhostEyes(ctx, 100, 100, 16, 'up', false);
    const arcs = ctx.__calls.filter((c) => c.method === 'arc');
    const pupil1 = arcs[2].args;
    // Eye Y center is cy - r/2 = 92; pupil should be shifted up (-r/4 = -4)
    expect(pupil1[1]).toBeLessThan(92);
  });
});

// ---------------------------------------------------------------------------
// drawGhost tests — visual states
// ---------------------------------------------------------------------------
describe('drawGhost', () => {
  const TILE = 40;

  test('normal ghost draws body in its personality color', () => {
    const ctx = createMockCtx();
    drawGhost(ctx, {
      x: 5, y: 5, color: 'red', direction: 'left',
      frightened: false, eaten: false, flashing: false,
    }, TILE);
    expect(countFillStyle(ctx, 'red')).toBe(1);
    expect(countFillStyle(ctx, 'blue')).toBe(0);
    // Body + eyes: dome arc, 3 skirt arcs, 2 sclera, 2 pupils = 8 arcs
    expect(countArcs(ctx)).toBe(8);
  });

  test('frightened ghost draws blue body', () => {
    const ctx = createMockCtx();
    drawGhost(ctx, {
      x: 5, y: 5, color: 'red', direction: 'left',
      frightened: true, eaten: false, flashing: false,
    }, TILE);
    expect(countFillStyle(ctx, 'blue')).toBe(1);
    expect(countFillStyle(ctx, 'red')).toBe(0);
  });

  test('flashing frightened ghost draws white body', () => {
    const ctx = createMockCtx();
    drawGhost(ctx, {
      x: 5, y: 5, color: 'pink', direction: 'up',
      frightened: true, eaten: false, flashing: true,
    }, TILE);
    // White is set for the flashing body AND the sclera, so >= 1
    expect(countFillStyle(ctx, 'white')).toBeGreaterThanOrEqual(1);
    expect(countFillStyle(ctx, 'blue')).toBe(0);
    expect(countFillStyle(ctx, 'pink')).toBe(0);
  });

  test('eaten ghost draws only eyes (no body arcs)', () => {
    const ctx = createMockCtx();
    drawGhost(ctx, {
      x: 5, y: 5, color: 'cyan', direction: 'down',
      frightened: false, eaten: true, flashing: false,
    }, TILE);
    // Only eyes: 2 sclera + 2 pupils = 4 arcs (no dome/skirt)
    expect(countArcs(ctx)).toBe(4);
    // No body color fill — only white sclera + blue pupils
    expect(countFillStyle(ctx, 'cyan')).toBe(0);
    expect(countFillStyle(ctx, 'white')).toBe(1);
    expect(countFillStyle(ctx, 'blue')).toBe(1); // eaten pupils are blue
  });

  test('ghost position scales with tile coordinates', () => {
    const ctx = createMockCtx();
    drawGhost(ctx, {
      x: 3, y: 7, color: 'orange', direction: 'right',
      frightened: false, eaten: false, flashing: false,
    }, TILE);
    // Center should be at (3*40, 7*40) = (120, 280)
    // Dome arc is the first arc call: arc(cx, cy - r/2, r, ...)
    const domeArc = ctx.__calls.find((c) => c.method === 'arc');
    expect(domeArc.args[0]).toBe(120); // cx
    expect(domeArc.args[1]).toBeCloseTo(280 - 16 / 2); // cy - r/2
  });

  test('all four ghost colors render correctly', () => {
    ['red', 'pink', 'cyan', 'orange'].forEach((color) => {
      const ctx = createMockCtx();
      drawGhost(ctx, {
        x: 1, y: 1, color, direction: 'left',
        frightened: false, eaten: false, flashing: false,
      }, TILE);
      expect(countFillStyle(ctx, color)).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// shouldGhostFlash logic (server-side, but tested here for completeness)
// ---------------------------------------------------------------------------
describe('shouldGhostFlash (server logic)', () => {
  // Import the server module's flash helper indirectly via ghostAI
  const { shouldGhostFlash } = require('../../src/ghostAI');

  test('no flash when timer is above 1/3 of duration', () => {
    // FRIGHTENED_DURATION_MS = 8000, so 1/3 ≈ 2667
    expect(shouldGhostFlash(8000)).toBe(false);
    expect(shouldGhostFlash(5000)).toBe(false);
    expect(shouldGhostFlash(2667)).toBe(false);
  });

  test('flash toggles every 100ms in the last third', () => {
    // Just below 2667: floor(2600/100) = 26, 26 % 2 === 0 → true
    expect(shouldGhostFlash(2600)).toBe(true);
    // 2500: floor(2500/100) = 25, 25 % 2 === 1 → false
    expect(shouldGhostFlash(2500)).toBe(false);
    // 2400: floor(2400/100) = 24, 24 % 2 === 0 → true
    expect(shouldGhostFlash(2400)).toBe(true);
  });

  test('no flash when timer is 0 or negative', () => {
    expect(shouldGhostFlash(0)).toBe(false);
    expect(shouldGhostFlash(-100)).toBe(false);
  });

  test('flash scales with a shorter total duration', () => {
    // Simulate level 5: frightened duration scaled to 6000ms.
    // Flash starts at 1/3 = 2000ms.
    const total = 6000;
    expect(shouldGhostFlash(6000, total)).toBe(false);
    expect(shouldGhostFlash(2000, total)).toBe(false); // exactly at threshold
    expect(shouldGhostFlash(1900, total)).toBe(false); // below, odd toggle (floor(1900/100)=19)
    expect(shouldGhostFlash(1800, total)).toBe(true);  // below, even toggle (floor(1800/100)=18)
  });
});

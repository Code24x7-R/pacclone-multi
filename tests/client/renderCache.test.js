// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richard Robertson
/* global HTMLCanvasElement */
/**
 * Client-side tests for renderCache.js.
 *
 * Covers the offscreen-canvas caching helpers that power the maze, pellet,
 * and game-over panel layers in render(). The caching logic (hit/miss,
 * signature change detection, gradient-once) is unit-tested here so the hot
 * render path can be verified without a browser.
 */
const {
  computePelletSignature,
  drawMaze,
  drawPellets,
  drawGameOverPanel,
  hudScale,
  resetRenderCaches,
  _cacheStats,
} = require('../../src/renderCache');

// ---------------------------------------------------------------------------
// Mock canvas + 2D context that records drawing calls for assertions.
// ---------------------------------------------------------------------------
function createMockCtx() {
  const calls = [];
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const handler = {
    get(_target, prop) {
      if (prop === '__calls') return calls;
      if (prop === 'createLinearGradient') return () => { calls.push({ method: prop }); return gradient; };
      if (prop === 'createRadialGradient') return () => { calls.push({ method: prop }); return gradient; };
      if (prop === 'measureText') return () => ({ width: 100 });
      if (prop === 'canvas') return { width: 800, height: 520 };
      if (['fillRect', 'clearRect', 'beginPath', 'arc', 'fill', 'stroke',
        'save', 'restore', 'moveTo', 'lineTo', 'closePath', 'fillText',
        'setLineDash', 'translate', 'rotate', 'scale', 'roundRect',
        'quadraticCurveTo', 'drawImage', 'ellipse', 'rect'].includes(prop)) {
        return (...args) => calls.push({ method: prop, args });
      }
      // Property assignments handled by set trap.
      return undefined;
    },
    set(_target, prop, value) {
      calls.push({ set: prop, value });
      return true;
    },
  };
  return new Proxy({}, handler);
}

// jsdom does not implement canvas 2D, and its `document` cannot be shadowed
// by assignment. Instead we stub getContext on the prototype so that
// `document.createElement('canvas').getContext('2d')` returns our mock
// offscreen context. Saved once so afterEach can restore it.
const ORIGINAL_GETCONTEXT = HTMLCanvasElement.prototype.getContext;

function stubCanvasContext(ctx) {
  HTMLCanvasElement.prototype.getContext = () => ctx;
}

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = ORIGINAL_GETCONTEXT;
});

// ---------------------------------------------------------------------------
// computePelletSignature
// ---------------------------------------------------------------------------
describe('computePelletSignature', () => {
  test('returns a string keyed on pellet + power-pellet counts', () => {
    const sig = computePelletSignature([{ x: 1, y: 1 }], [{ x: 5, y: 5 }]);
    expect(sig).toBe('1:1');
  });

  test('changes when a pellet is eaten', () => {
    const before = computePelletSignature([{ x: 1, y: 1 }, { x: 2, y: 2 }], []);
    const after = computePelletSignature([{ x: 1, y: 1 }], []);
    expect(before).not.toBe(after);
  });

  test('changes when a power pellet is eaten', () => {
    const before = computePelletSignature([], [{ x: 5, y: 5 }]);
    const after = computePelletSignature([], []);
    expect(before).not.toBe(after);
  });

  test('is stable when nothing changes', () => {
    const pellets = [{ x: 1, y: 1 }, { x: 3, y: 4 }];
    expect(computePelletSignature(pellets, [])).toBe(computePelletSignature(pellets, []));
  });
});

// ---------------------------------------------------------------------------
// drawMaze (cached)
// ---------------------------------------------------------------------------
describe('drawMaze (cached)', () => {
  let ctx, offCtx;

  beforeEach(() => {
    ctx = createMockCtx();
    offCtx = createMockCtx();
    resetRenderCaches();
    stubCanvasContext(offCtx);
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = ORIGINAL_GETCONTEXT;
  });

  test('draws walls on first call (cache miss)', () => {
    const maze = [[1, 0], [0, 1]];
    drawMaze(ctx, 1, maze, 40);
    // The offscreen ctx should have received fillRect calls for the two walls.
    const fillRects = offCtx.__calls.filter((c) => c.method === 'fillRect');
    expect(fillRects.length).toBe(2);
    // And the main ctx should have drawImage'd the cached canvas.
    expect(ctx.__calls.filter((c) => c.method === 'drawImage').length).toBe(1);
  });

  test('reuses the cached canvas on a second call at the same level (hit)', () => {
    const maze = [[1, 0], [0, 1]];
    drawMaze(ctx, 1, maze, 40);
    const firstStats = _cacheStats();
    // Second call: main ctx drawImage called again, but offscreen NOT redrawn.
    drawMaze(ctx, 1, maze, 40);
    expect(_cacheStats().mazeLevel).toBe(firstStats.mazeLevel);
    // drawImage called twice total on main ctx (once per render() call).
    expect(ctx.__calls.filter((c) => c.method === 'drawImage').length).toBe(2);
    // offscreen fillRects remain at 2 (no rebuild).
    expect(offCtx.__calls.filter((c) => c.method === 'fillRect').length).toBe(2);
  });

  test('rebuilds when the level changes (miss)', () => {
    const maze = [[1, 0], [0, 1]];
    drawMaze(ctx, 1, maze, 40);
    drawMaze(ctx, 2, maze, 40);
    expect(_cacheStats().mazeLevel).toBe(2);
    // Rebuild means 4 fillRects across both builds.
    expect(offCtx.__calls.filter((c) => c.method === 'fillRect').length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// drawPellets (cached)
// ---------------------------------------------------------------------------
describe('drawPellets (cached)', () => {
  let ctx, offCtx;

  beforeEach(() => {
    ctx = createMockCtx();
    offCtx = createMockCtx();
    resetRenderCaches();
    stubCanvasContext(offCtx);
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = ORIGINAL_GETCONTEXT;
  });

  test('draws pellets on first call', () => {
    drawPellets(ctx, [{ x: 1, y: 1 }], [], 40);
    expect(offCtx.__calls.filter((c) => c.method === 'arc').length).toBe(1);
    expect(ctx.__calls.filter((c) => c.method === 'drawImage').length).toBe(1);
  });

  test('does not redraw when the signature is unchanged (hit)', () => {
    drawPellets(ctx, [{ x: 1, y: 1 }, { x: 2, y: 2 }], [], 40);
    const arcsAfterFirst = offCtx.__calls.filter((c) => c.method === 'arc').length;
    drawPellets(ctx, [{ x: 1, y: 1 }, { x: 2, y: 2 }], [], 40);
    expect(offCtx.__calls.filter((c) => c.method === 'arc').length).toBe(arcsAfterFirst);
  });

  test('redraws when a pellet is eaten (signature changed)', () => {
    drawPellets(ctx, [{ x: 1, y: 1 }, { x: 2, y: 2 }], [], 40);
    drawPellets(ctx, [{ x: 1, y: 1 }], [], 40);
    // Two builds: 2 arcs then 1 arc = 3.
    expect(offCtx.__calls.filter((c) => c.method === 'arc').length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// drawGameOverPanel (cached)
// ---------------------------------------------------------------------------
describe('drawGameOverPanel (cached)', () => {
  let ctx, offCtx;

  beforeEach(() => {
    ctx = createMockCtx();
    offCtx = createMockCtx();
    resetRenderCaches();
    stubCanvasContext(offCtx);
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = ORIGINAL_GETCONTEXT;
  });

  test('draws the panel on first call', () => {
    drawGameOverPanel(ctx, 'Game Over!', 800, 520);
    expect(offCtx.__calls.filter((c) => c.method === 'createLinearGradient').length).toBe(1);
    expect(ctx.__calls.filter((c) => c.method === 'drawImage').length).toBe(1);
  });

  test('builds the gradient only once across repeated calls (hit)', () => {
    drawGameOverPanel(ctx, 'Game Over!', 800, 520);
    drawGameOverPanel(ctx, 'Game Over!', 800, 520);
    drawGameOverPanel(ctx, 'Game Over!', 800, 520);
    // createLinearGradient is the expensive call we want to avoid per-frame.
    expect(offCtx.__calls.filter((c) => c.method === 'createLinearGradient').length).toBe(1);
    // main ctx drawImage still called once per render() invocation.
    expect(ctx.__calls.filter((c) => c.method === 'drawImage').length).toBe(3);
  });

  test('rebuilds when the heading text changes', () => {
    drawGameOverPanel(ctx, 'Game Over!', 800, 520);
    drawGameOverPanel(ctx, 'Game Over! Winner: Alice', 800, 520);
    expect(offCtx.__calls.filter((c) => c.method === 'createLinearGradient').length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// hudScale
// ---------------------------------------------------------------------------
describe('hudScale', () => {
  test('returns 1 for native backing width', () => {
    expect(hudScale(800)).toBe(1);
  });

  test('scales up on a narrow display so text stays legible', () => {
    expect(hudScale(400)).toBe(2);
    expect(hudScale(200)).toBe(4);
  });

  test('scales down on a wide display', () => {
    expect(hudScale(1600)).toBe(0.5);
  });

  test('defaults to 1 when display width is unknown/zero', () => {
    expect(hudScale(0)).toBe(1);
    expect(hudScale(-10)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resetRenderCaches
// ---------------------------------------------------------------------------
describe('resetRenderCaches', () => {
  let offCtx;
  beforeEach(() => {
    offCtx = createMockCtx();
    stubCanvasContext(offCtx);
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = ORIGINAL_GETCONTEXT;
  });

  test('clears all cached state', () => {
    drawMaze(createMockCtx(), 1, [[1, 0], [0, 1]], 40);
    expect(_cacheStats().mazeLevel).toBe(1);
    resetRenderCaches();
    expect(_cacheStats().mazeLevel).toBeNull();
  });
});

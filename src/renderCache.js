// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richard Robertson

/**
 * renderCache.js — Offscreen-canvas caching for static render layers.
 *
 * The 60 FPS render() path redraws the maze walls, pellets, and game-over
 * panel every frame even though they change rarely (maze per level, pellets
 * as eaten, panel not at all). On mobile GPUs that is wasted fill rate and
 * per-frame allocation (gradients, measureText, shadowBlur).
 *
 * This module caches each layer on its own offscreen canvas and only rebuilds
 * it when its input actually changes. render() then blits the cached canvas
 * with a single drawImage(). Pure helpers (signature, hudScale) live here too
 * so they are unit-testable in isolation.
 *
 * UMD pattern: `window.RenderCache` in the browser, `module.exports` in Jest.
 *
 * Browser usage:
 *   <script src="src/renderCache.js"></script>
 *   RenderCache.drawMaze(ctx, level, maze, TILE_SIZE);
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RenderCache = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Native backing-store dimensions. HUD scaling is relative to these.
  const NATIVE_W = 800;
  const NATIVE_H = 520;

  // Cache state, module-scoped so render() can reuse across frames.
  let mazeCache = { level: null, canvas: null };
  let pelletCache = { sig: null, canvas: null };
  let panelCache = { key: null, canvas: null };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Cheap signature for the pellet layer: just the counts. Eating any pellet
   * changes the count, which is all we need to detect a redraw. Avoids hashing
   * every coordinate each frame.
   * @param {Array} pellets
   * @param {Array} powerPellets
   * @returns {string}
   */
  function computePelletSignature(pellets, powerPellets) {
    return (pellets ? pellets.length : 0) + ':' + (powerPellets ? powerPellets.length : 0);
  }

  /**
   * HUD font scale factor for a given on-screen canvas width. The canvas
   * backing store is NATIVE_W px wide; when CSS scales it down on a phone the
   * text shrinks by the same ratio. Compensate so text stays legible.
   * @param {number} displayWidth - CSS display width of the canvas (px).
   * @returns {number} Multiplier (>=0.5 typically).
   */
  function hudScale(displayWidth) {
    if (!displayWidth || displayWidth <= 0) return 1;
    return NATIVE_W / displayWidth;
  }

  /**
   * Build an offscreen canvas of native size. Returns null if the
   * environment has no canvas 2D context (e.g. a headless test) so callers
   * can degrade gracefully.
   */
  function makeOffscreen() {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas');
    c.width = NATIVE_W;
    c.height = NATIVE_H;
    const ctx = c.getContext && c.getContext('2d');
    return ctx ? { canvas: c, ctx: ctx } : null;
  }

  // -------------------------------------------------------------------------
  // Cached layer blitters. Each checks its cache; on a miss it (re)draws the
  // layer onto an offscreen canvas, then blits that canvas onto `ctx`.
  // -------------------------------------------------------------------------

  /**
   * Blit the maze walls (static per level). Rebuilds only when `level`
   * changes. Tile values: 1 = wall, 6 = ghost-house gate.
   * @param {CanvasRenderingContext2D} ctx - Destination context.
   * @param {number} level - Current level (cache key).
   * @param {Array<number[]>} maze - 2D tile array.
   * @param {number} tileSize - Tile size in px (matches render()).
   */
  function drawMaze(ctx, level, maze, tileSize) {
    if (mazeCache.level !== level || !mazeCache.canvas) {
      const off = makeOffscreen();
      if (off) {
        drawMazeWalls(off.ctx, maze, tileSize);
        mazeCache = { level: level, canvas: off.canvas };
      }
    }
    if (mazeCache.canvas && ctx.drawImage) {
      ctx.drawImage(mazeCache.canvas, 0, 0);
    }
  }

  /**
   * Draw maze walls onto a context (walls + ghost-house gate). Extracted so the
   * cache builder can call it directly without re-blitting.
   */
  function drawMazeWalls(ctx, maze, tileSize) {
    for (let y = 0; y < maze.length; y++) {
      for (let x = 0; x < maze[y].length; x++) {
        if (maze[y][x] === 1) {
          ctx.fillStyle = 'blue';
          ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        } else if (maze[y][x] === 6) {
          ctx.fillStyle = '#ff4da6';
          ctx.fillRect(x * tileSize, y * tileSize + tileSize / 2 - 3, tileSize, 6);
        }
      }
    }
  }

  /**
   * Blit the pellets + power pellets. Rebuilds only when the pellet signature
   * changes (i.e. a pellet was eaten).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} pellets - [{x, y}] in tile coords.
   * @param {Array} powerPellets - [{x, y}] in tile coords.
   * @param {number} tileSize
   */
  function drawPellets(ctx, pellets, powerPellets, tileSize) {
    const sig = computePelletSignature(pellets, powerPellets);
    if (pelletCache.sig !== sig || !pelletCache.canvas) {
      const off = makeOffscreen();
      if (off) {
        drawPelletsLayer(off.ctx, pellets, powerPellets, tileSize);
        pelletCache = { sig: sig, canvas: off.canvas };
      }
    }
    if (pelletCache.canvas && ctx.drawImage) {
      ctx.drawImage(pelletCache.canvas, 0, 0);
    }
  }

  /** Draw pellets onto a context. */
  function drawPelletsLayer(ctx, pellets, powerPellets, tileSize) {
    ctx.fillStyle = 'white';
    (pellets || []).forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x * tileSize + tileSize / 2, p.y * tileSize + tileSize / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'orange';
    (powerPellets || []).forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x * tileSize + tileSize / 2, p.y * tileSize + tileSize / 2, 8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /**
   * Blit the game-over panel (decorative gradient + glow + heading text).
   * This is rebuilt only when the heading text or canvas size changes — it is
   * otherwise identical every frame, so caching removes per-frame
   * createLinearGradient / measureText / shadowBlur / roundRect work.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} heading - Panel heading text.
   * @param {number} width - Canvas width (px).
   * @param {number} height - Canvas height (px).
   */
  function drawGameOverPanel(ctx, heading, width, height) {
    const key = heading + '@' + width + 'x' + height;
    if (panelCache.key !== key || !panelCache.canvas) {
      const off = makeOffscreen();
      if (off) {
        paintGameOverPanel(off.ctx, heading, width, height);
        panelCache = { key: key, canvas: off.canvas };
      }
    }
    if (panelCache.canvas && ctx.drawImage) {
      ctx.drawImage(panelCache.canvas, 0, 0);
    }
  }

  /** Paint the full game-over panel onto a context (expensive, so cached). */
  function paintGameOverPanel(ctx, heading, width, height) {
    ctx.textAlign = 'center';
    ctx.font = '48px Arial';
    const textW = ctx.measureText(heading).width;
    const panelX = width / 2 - textW / 2 - 24;
    const panelY = height / 2 - 52;
    const panelW = textW + 48;
    const panelH = 72;

    // Decorative panel with gradient + outer glow.
    ctx.save();
    ctx.shadowColor = 'rgba(255,0,0,0.55)';
    ctx.shadowBlur = 28;
    const grad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
    grad.addColorStop(0, 'rgba(60,0,0,0.85)');
    grad.addColorStop(1, 'rgba(20,0,0,0.85)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, 14);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,80,80,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Heading with glow.
    ctx.save();
    ctx.shadowColor = 'rgba(255,60,60,0.8)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ff4444';
    ctx.fillText(heading, width / 2, height / 2);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  /**
   * Clear all caches (e.g. on reconnect / new connection so a stale canvas
   * from a prior game is never reused).
   */
  function resetRenderCaches() {
    mazeCache = { level: null, canvas: null };
    pelletCache = { sig: null, canvas: null };
    panelCache = { key: null, canvas: null };
  }

  /** Expose cache keys for unit tests (not for production use). */
  function _cacheStats() {
    return {
      mazeLevel: mazeCache.level,
      pelletSig: pelletCache.sig,
      panelKey: panelCache.key,
    };
  }

  return {
    computePelletSignature: computePelletSignature,
    hudScale: hudScale,
    drawMaze: drawMaze,
    drawPellets: drawPellets,
    drawGameOverPanel: drawGameOverPanel,
    resetRenderCaches: resetRenderCaches,
    _cacheStats: _cacheStats,
  };
});

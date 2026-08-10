// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richard Robertson

/**
 * Ghost rendering — pure drawing functions for the Canvas 2D context.
 *
 * Handles three visual states:
 * - Normal: ghost's personality color (red/pink/cyan/orange)
 * - Frightened: blue body, white flash in the last 1/3 of the power-up
 * - Eaten: eyes only, pupils looking toward the movement direction
 *
 * UMD pattern: works as a browser global (window.GhostRenderer) and as a
 * CommonJS module (module.exports) for Jest tests.
 */
(function (global) {
  'use strict';

  /**
   * Draw a single ghost at its tile position.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} g - Ghost object { x, y, color, direction, frightened, eaten, flashing }
   * @param {number} tileSize - Tile size in pixels.
   */
  function drawGhost(ctx, g, tileSize) {
    // Reference proportion: TILE_SIZE / 3. This keeps the ghost small enough
    // to sit centered within a tile corridor (a larger radius overflows the
    // tile and looks off-center due to the dome offset).
    const r = tileSize / 3;
    const cx = g.x * tileSize;
    const cy = g.y * tileSize;

    // Eaten ghost: draw only the eyes
    if (g.eaten) {
      drawGhostEyes(ctx, cx, cy, r, g.direction, true);
      return;
    }

    // Body color: blue when frightened, white when flashing, otherwise the ghost's color
    let bodyColor;
    if (g.frightened) {
      bodyColor = g.flashing ? 'white' : 'blue';
    } else {
      bodyColor = g.color;
    }

    // Ghost body: dome + rectangle + skirt scallops
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(cx, cy - r / 2, r, Math.PI, 0, false); // top dome
    ctx.rect(cx - r, cy - r / 2, r * 2, r * 1.5); // main body
    // Skirt (three scallops)
    ctx.arc(cx - r * 0.6, cy + r, r * 0.4, 0, Math.PI, true);
    ctx.arc(cx, cy + r, r * 0.4, 0, Math.PI, true);
    ctx.arc(cx + r * 0.6, cy + r, r * 0.4, 0, Math.PI, true);
    ctx.fill();

    // Eyes (drawn on top of body for normal + frightened states)
    drawGhostEyes(ctx, cx, cy, r, g.direction, false);
  }

  /**
   * Draw a ghost's eyes (white sclera + pupils offset toward movement direction).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx - Center X in pixels
   * @param {number} cy - Center Y in pixels
   * @param {number} r - Ghost radius
   * @param {string} direction - 'up' | 'down' | 'left' | 'right'
   * @param {boolean} eaten - True for eaten ghosts (blue pupils)
   */
  function drawGhostEyes(ctx, cx, cy, r, direction, eaten) {
    const eyeLeftX = cx - r / 2;
    const eyeRightX = cx + r / 2;
    const eyeY = cy - r / 2;
    const eyeRadius = r / 2;

    // Pupil offset based on movement direction
    let pupilXOffset = 0;
    let pupilYOffset = 0;
    if (direction === 'right') pupilXOffset = r / 4;
    else if (direction === 'left') pupilXOffset = -r / 4;
    else if (direction === 'down') pupilYOffset = r / 4;
    else if (direction === 'up') pupilYOffset = -r / 4;

    // White sclera
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(eyeLeftX, eyeY, eyeRadius, 0, Math.PI * 2);
    ctx.arc(eyeRightX, eyeY, eyeRadius, 0, Math.PI * 2);
    ctx.fill();

    // Pupils: blue for eaten ghosts, dark blue for normal/frightened
    ctx.fillStyle = eaten ? 'blue' : '#1010a0';
    ctx.beginPath();
    ctx.arc(eyeLeftX + pupilXOffset, eyeY + pupilYOffset, eyeRadius / 2, 0, Math.PI * 2);
    ctx.arc(eyeRightX + pupilXOffset, eyeY + pupilYOffset, eyeRadius / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  const api = { drawGhost, drawGhostEyes };

  // UMD: CommonJS for Node/Jest, browser global otherwise
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.GhostRenderer = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);

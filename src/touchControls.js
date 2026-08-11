// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richard Robertson

/**
 * touchControls.js — Pure helpers for the virtual joystick and touch input.
 *
 * Extracted from index.html so the joystick math is unit-testable in isolation
 * (deadzone, clamping, adaptive sizing). No DOM or canvas access — these are
 * pure functions. The browser event handlers in index.html call into these.
 *
 * UMD pattern: works as `window.TouchControls` in the browser (via <script
 * src>) and as `module.exports` in Jest (via require).
 *
 * Browser usage:
 *   <script src="src/touchControls.js"></script>
 *   const dir = TouchControls.joystickDirection(dx, dy, 0.3);
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TouchControls = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- Joystick geometry constants ---------------------------------------
  // Adaptive sizing clamps to this range (px). Chosen so the base is large
  // enough for precise thumb control on a phone yet never dominates a tablet.
  var JOY_MIN_SIZE = 90;
  var JOY_MAX_SIZE = 150;
  var JOY_VIEWPORT_FRACTION = 0.22; // fraction of viewport width in mid-range

  /**
   * Map a joystick knob displacement to a cardinal direction.
   *
   * @param {number} dx - Horizontal displacement from center (px, +right).
   * @param {number} dy - Vertical displacement from center (px, +down).
   * @param {number} radius - Base radius of the joystick (px). The deadzone
   *   is computed as radius * deadFraction so the deadband scales with the
   *   control's on-screen size.
   * @param {number} [deadFraction=0.3] - Fraction of the radius treated as a
   *   deadzone. E.g. 0.3 means pushes shorter than 30% of the radius return
   *   null (no movement). Tune up if the knob drifts, down if it feels dead.
   * @returns {'up'|'down'|'left'|'right'|null}
   */
  function joystickDirection(dx, dy, radius, deadFraction) {
    var dead = deadFraction == null ? 0.3 : deadFraction;
    var deadzone = radius * dead;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < deadzone) return null;
    // Dominant-axis rule: whichever axis has the larger absolute displacement
    // wins, matching the original behaviour (clean diagonals pick a cardinal).
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 'right' : 'left';
    }
    return dy > 0 ? 'down' : 'up';
  }

  /**
   * Clamp a knob displacement vector so it never exceeds the handle's travel
   * radius. Keeps the visible handle inside the joystick base.
   *
   * @param {number} dx - Raw horizontal displacement (px).
   * @param {number} dy - Raw vertical displacement (px).
   * @param {number} maxDistance - Maximum travel radius (px), i.e.
   *   (baseRadius - handleRadius).
   * @returns {{dx:number, dy:number, distance:number, maxDistance:number}}
   *   The (possibly clamped) displacement plus its resulting length.
   */
  function clampJoystick(dx, dy, maxDistance) {
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDistance && dist > 0) {
      var scale = maxDistance / dist;
      dx = dx * scale;
      dy = dy * scale;
      dist = maxDistance;
    }
    return { dx: dx, dy: dy, distance: dist, maxDistance: maxDistance };
  }

  /**
   * Pick a joystick base diameter (px) for a given viewport width.
   *
   * Scales with the viewport in the mid-range but clamps to [JOY_MIN_SIZE,
   * JOY_MAX_SIZE] so it stays a comfortable touch target on phones and
   * tablets alike.
   *
   * @param {number} viewportWidth - window.innerWidth (px).
   * @returns {number} Integer base diameter in px.
   */
  function adaptiveJoystickSize(viewportWidth) {
    var size = Math.round(viewportWidth * JOY_VIEWPORT_FRACTION);
    if (size < JOY_MIN_SIZE) return JOY_MIN_SIZE;
    if (size > JOY_MAX_SIZE) return JOY_MAX_SIZE;
    return size;
  }

  return {
    joystickDirection: joystickDirection,
    clampJoystick: clampJoystick,
    adaptiveJoystickSize: adaptiveJoystickSize,
  };
});

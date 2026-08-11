// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richard Robertson
/**
 * Client-side tests for touch controls (src/touchControls.js).
 *
 * Pure-function unit tests for the joystick direction math, clamping, and
 * adaptive sizing. No DOM or canvas required.
 */
const {
  joystickDirection,
  clampJoystick,
  adaptiveJoystickSize,
} = require('../../src/touchControls');

// ---------------------------------------------------------------------------
// joystickDirection(dx, dy, radius, deadFraction)
//
// Maps a joystick knob displacement (dx, dy) from center to a cardinal
// direction, returning null when the displacement is within the deadzone.
// The deadzone is radius * deadFraction (px) — a fraction of the base radius
// so the deadband scales with the joystick size.
// ---------------------------------------------------------------------------
describe('joystickDirection', () => {
  const R = 100; // base radius used for all tests below

  test('returns null for zero displacement (centered knob)', () => {
    expect(joystickDirection(0, 0, R, 0.3)).toBeNull();
  });

  test('returns null within the deadzone', () => {
    // deadzone radius = R * 0.3 = 30. (10,10) has distance ~14 < 30.
    expect(joystickDirection(10, 10, R, 0.3)).toBeNull();
  });

  test('returns direction just outside the deadzone', () => {
    // deadzone radius 30; distance 35 > 30, pointing right.
    expect(joystickDirection(35, 0, R, 0.3)).toBe('right');
  });

  test.each([
    ['right', 50, 0],
    ['left', -50, 0],
    ['up', 0, -50],
    ['down', 0, 50],
  ])('returns %s for pure cardinal input', (expected, dx, dy) => {
    expect(joystickDirection(dx, dy, R, 0.3)).toBe(expected);
  });

  test.each([
    ['right', 50, -10], // mostly right, slightly up -> right
    ['right', 50, 10],  // mostly right, slightly down -> right
    ['left', -50, -10],
    ['up', 10, -50],    // mostly up, slightly right -> up
    ['up', -10, -50],
    ['down', 10, 50],
  ])('returns %s when that axis dominates', (expected, dx, dy) => {
    expect(joystickDirection(dx, dy, R, 0.3)).toBe(expected);
  });

  test('obeys a larger deadzone', () => {
    // deadFraction 0.5 -> deadzone radius 50. distance 40 < 50 -> null.
    expect(joystickDirection(40, 0, R, 0.5)).toBeNull();
  });

  test('obeys a smaller deadzone', () => {
    // deadFraction 0.1 -> deadzone radius 10. distance 15 > 10 -> right.
    expect(joystickDirection(15, 0, R, 0.1)).toBe('right');
  });

  test('handles negative coordinates for up/left correctly', () => {
    expect(joystickDirection(-100, -10, R, 0.3)).toBe('left');
    expect(joystickDirection(-10, -100, R, 0.3)).toBe('up');
  });

  test('scales the deadzone with the radius', () => {
    // radius 50, deadFraction 0.3 -> deadzone 15. distance 20 > 15 -> right.
    expect(joystickDirection(20, 0, 50, 0.3)).toBe('right');
    // radius 200, deadFraction 0.3 -> deadzone 60. distance 20 < 60 -> null.
    expect(joystickDirection(20, 0, 200, 0.3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clampJoystick(dx, dy, maxDistance)
//
// Clamps a knob displacement vector so its length never exceeds maxDistance
// (the travel radius of the handle). Used to keep the handle visually
// inside the joystick base.
// ---------------------------------------------------------------------------
describe('clampJoystick', () => {
  test('leaves a within-range vector unchanged', () => {
    const r = clampJoystick(10, 10, 40);
    expect(r.dx).toBeCloseTo(10);
    expect(r.dy).toBeCloseTo(10);
    expect(r.distance).toBeCloseTo(Math.hypot(10, 10));
    expect(r.maxDistance).toBe(40);
  });

  test('clamps an out-of-range vector to maxDistance', () => {
    const r = clampJoystick(100, 0, 40);
    expect(r.dx).toBeCloseTo(40);
    expect(r.dy).toBeCloseTo(0);
    expect(r.distance).toBeCloseTo(40);
  });

  test('preserves direction when clamping a diagonal', () => {
    const r = clampJoystick(100, 100, 40);
    // equal components -> 45-degree line, length 40.
    expect(r.dx).toBeCloseTo(40 * Math.cos(Math.PI / 4));
    expect(r.dy).toBeCloseTo(40 * Math.sin(Math.PI / 4));
    expect(r.distance).toBeCloseTo(40);
  });

  test('handles zero vector', () => {
    const r = clampJoystick(0, 0, 40);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.distance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// adaptiveJoystickSize(viewportWidth)
//
// Returns a joystick base diameter (px) that scales with the viewport but
// stays within a comfortable touch range across phones and tablets.
// ---------------------------------------------------------------------------
describe('adaptiveJoystickSize', () => {
  test('clamps to the minimum on a narrow phone', () => {
    // 320px phone -> should floor at the min (90).
    expect(adaptiveJoystickSize(320)).toBe(90);
  });

  test('clamps to the maximum on a wide tablet', () => {
    // 1200px tablet -> should cap at the max (150).
    expect(adaptiveJoystickSize(1200)).toBe(150);
  });

  test('scales proportionally in the mid range', () => {
    // 500px wide: ~22% of 500 = 110, within [90, 150].
    const size = adaptiveJoystickSize(500);
    expect(size).toBeGreaterThanOrEqual(90);
    expect(size).toBeLessThanOrEqual(150);
    expect(size).toBe(110);
  });

  test('returns an integer', () => {
    expect(Number.isInteger(adaptiveJoystickSize(375))).toBe(true);
  });
});

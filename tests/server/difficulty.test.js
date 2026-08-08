/**
 * Tests for src/difficulty.js — pure difficulty scaling functions.
 */
const {
  ghostSpeedForLevel,
  frightenedDurationForLevel,
  FRIGHTENED_DURATION_BASE_MS,
  GHOST_BASE_SPEED,
} = require('../../src/difficulty');

describe('ghostSpeedForLevel', () => {
  test('level 1 returns base speed', () => {
    expect(ghostSpeedForLevel(1)).toBeCloseTo(0.08, 5);
  });

  test('speed increases 10% per level', () => {
    expect(ghostSpeedForLevel(2)).toBeCloseTo(0.088, 5); // 0.08 * 1.1
    expect(ghostSpeedForLevel(3)).toBeCloseTo(0.096, 5); // 0.08 * 1.2
    expect(ghostSpeedForLevel(4)).toBeCloseTo(0.104, 5); // 0.08 * 1.3
  });

  test('speed is capped at 2x base', () => {
    // 1.0 + (level-1)*0.1 >= 2.0 when level >= 11
    expect(ghostSpeedForLevel(11)).toBeCloseTo(0.16, 5); // 0.08 * 2.0
    expect(ghostSpeedForLevel(15)).toBeCloseTo(0.16, 5); // still capped
    expect(ghostSpeedForLevel(100)).toBeCloseTo(0.16, 5); // still capped
  });

  test('returns a positive number for all valid levels', () => {
    for (let level = 1; level <= 20; level++) {
      expect(ghostSpeedForLevel(level)).toBeGreaterThan(0);
    }
  });
});

describe('frightenedDurationForLevel', () => {
  test('level 1 returns base duration', () => {
    expect(frightenedDurationForLevel(1)).toBe(8000);
  });

  test('duration decreases 500ms per level', () => {
    expect(frightenedDurationForLevel(2)).toBe(7500);
    expect(frightenedDurationForLevel(3)).toBe(7000);
    expect(frightenedDurationForLevel(4)).toBe(6500);
  });

  test('duration is floored at 3000ms', () => {
    // 8000 - (level-1)*500 <= 3000 when level >= 11
    expect(frightenedDurationForLevel(11)).toBe(3000);
    expect(frightenedDurationForLevel(15)).toBe(3000);
    expect(frightenedDurationForLevel(100)).toBe(3000);
  });

  test('returns at least the floor for all valid levels', () => {
    for (let level = 1; level <= 20; level++) {
      expect(frightenedDurationForLevel(level)).toBeGreaterThanOrEqual(3000);
    }
  });
});

describe('constants', () => {
  test('base duration is 8000ms', () => {
    expect(FRIGHTENED_DURATION_BASE_MS).toBe(8000);
  });

  test('base ghost speed is 0.08', () => {
    expect(GHOST_BASE_SPEED).toBe(0.08);
  });
});

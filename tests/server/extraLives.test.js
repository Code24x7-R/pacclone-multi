/**
 * Tests for src/gameLogic.js — extraLivesEarned.
 *
 * Classic arcade style: one extra life per EXTRA_LIFE_THRESHOLD (10000) points.
 */
const { extraLivesEarned, EXTRA_LIFE_THRESHOLD } = require('../../src/gameLogic');

describe('extraLivesEarned', () => {
  test('returns 0 when score is below threshold', () => {
    expect(extraLivesEarned(0)).toBe(0);
    expect(extraLivesEarned(100)).toBe(0);
    expect(extraLivesEarned(EXTRA_LIFE_THRESHOLD - 1)).toBe(0);
  });

  test('returns 1 when score reaches threshold', () => {
    expect(extraLivesEarned(EXTRA_LIFE_THRESHOLD)).toBe(1);
  });

  test('returns 1 when score is between threshold and 2x', () => {
    expect(extraLivesEarned(EXTRA_LIFE_THRESHOLD + 1)).toBe(1);
    expect(extraLivesEarned(EXTRA_LIFE_THRESHOLD * 2 - 1)).toBe(1);
  });

  test('returns 2 when score reaches 2x threshold', () => {
    expect(extraLivesEarned(EXTRA_LIFE_THRESHOLD * 2)).toBe(2);
  });

  test('scales linearly with score', () => {
    expect(extraLivesEarned(EXTRA_LIFE_THRESHOLD * 5)).toBe(5);
  });

  test('supports custom threshold', () => {
    expect(extraLivesEarned(500, 500)).toBe(1);
    expect(extraLivesEarned(999, 500)).toBe(1);
    expect(extraLivesEarned(1000, 500)).toBe(2);
    expect(extraLivesEarned(499, 500)).toBe(0);
  });
});

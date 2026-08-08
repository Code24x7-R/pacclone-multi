/**
 * Tests for src/highScores.js — client-side high score persistence.
 *
 * Uses the actual module via require. The UMD wrapper exports the same
 * functions that window.HighScores exposes in the browser.
 */
const HighScores = require('../../src/highScores');

describe('HighScores.escapeHtml', () => {
  test('escapes all HTML special characters', () => {
    expect(HighScores.escapeHtml('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  test('escapes ampersand and apostrophe', () => {
    expect(HighScores.escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
  });

  test('leaves plain text unchanged', () => {
    expect(HighScores.escapeHtml('Alice')).toBe('Alice');
  });

  test('coerces non-string input', () => {
    expect(HighScores.escapeHtml(123)).toBe('123');
  });
});

describe('HighScores.loadHighScores', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('returns empty array when no scores stored', () => {
    expect(HighScores.loadHighScores()).toEqual([]);
  });

  test('loads previously saved scores', () => {
    HighScores.insertHighScore('Alice', 5000);
    const scores = HighScores.loadHighScores();
    expect(scores).toHaveLength(1);
    expect(scores[0].name).toBe('Alice');
    expect(scores[0].score).toBe(5000);
  });

  test('returns empty array on corrupted JSON', () => {
    localStorage.setItem(HighScores.HIGH_SCORES_KEY, 'not valid json{{{');
    expect(HighScores.loadHighScores()).toEqual([]);
  });

  test('returns empty array on non-array JSON', () => {
    localStorage.setItem(HighScores.HIGH_SCORES_KEY, JSON.stringify({ foo: 'bar' }));
    expect(HighScores.loadHighScores()).toEqual([]);
  });
});

describe('HighScores.insertHighScore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('inserts a score and persists to localStorage', () => {
    const scores = HighScores.insertHighScore('Bob', 3000);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({ name: 'Bob', score: 3000 });
    expect(HighScores.loadHighScores()).toHaveLength(1);
  });

  test('sorts scores in descending order', () => {
    HighScores.insertHighScore('Low', 1000);
    HighScores.insertHighScore('High', 9000);
    HighScores.insertHighScore('Mid', 5000);
    const scores = HighScores.loadHighScores();
    expect(scores.map(s => s.score)).toEqual([9000, 5000, 1000]);
  });

  test('caps at MAX_HIGH_SCORES entries', () => {
    for (let i = 0; i < 15; i++) {
      HighScores.insertHighScore(`P${i}`, i * 100);
    }
    const scores = HighScores.loadHighScores();
    expect(scores.length).toBe(HighScores.MAX_HIGH_SCORES);
    expect(scores[0].score).toBe(1400);
  });

  test('truncates long names to 20 characters', () => {
    const longName = 'A'.repeat(50);
    const scores = HighScores.insertHighScore(longName, 1000);
    expect(scores[0].name.length).toBe(20);
  });

  test('defaults empty name to "Player"', () => {
    const scores = HighScores.insertHighScore('', 1000);
    expect(scores[0].name).toBe('Player');
  });

  test('coerces score to integer', () => {
    const scores = HighScores.insertHighScore('Frac', 1234.56);
    expect(scores[0].score).toBe(1234);
  });

  test('includes a date timestamp', () => {
    const before = Date.now();
    const scores = HighScores.insertHighScore('Timed', 1000);
    expect(scores[0].date).toBeGreaterThanOrEqual(before);
    expect(scores[0].date).toBeLessThanOrEqual(Date.now());
  });

  test('handles multiple scores from the same player', () => {
    HighScores.insertHighScore('Twin', 2000);
    HighScores.insertHighScore('Twin', 8000);
    const scores = HighScores.loadHighScores();
    expect(scores).toHaveLength(2);
    expect(scores[0].score).toBe(8000);
    expect(scores[1].score).toBe(2000);
  });
});

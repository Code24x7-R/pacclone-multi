/**
 * Tests for src/leaderboard.js — server-side leaderboard logic.
 *
 * Pure functions for managing a persistent high-score table. The module is
 * UMD so it runs under Jest (require) and in the browser (window.Leaderboard).
 *
 * These tests cover the data layer only; persistence (disk I/O) and the
 * WebSocket wiring live in server.js and are covered by integration tests.
 */
const Leaderboard = require('../../src/leaderboard');

describe('Leaderboard.createEntry', () => {
  test('creates an entry with name, score, and a timestamp', () => {
    const before = Date.now();
    const e = Leaderboard.createEntry('Alice', 5000);
    const after = Date.now();
    expect(e.name).toBe('Alice');
    expect(e.score).toBe(5000);
    expect(e.date).toBeGreaterThanOrEqual(before);
    expect(e.date).toBeLessThanOrEqual(after);
  });

  test('truncates long names to 20 characters', () => {
    const e = Leaderboard.createEntry('A'.repeat(50), 100);
    expect(e.name.length).toBe(20);
  });

  test('defaults empty/blank name to "Player"', () => {
    expect(Leaderboard.createEntry('', 100).name).toBe('Player');
    expect(Leaderboard.createEntry('   ', 100).name).toBe('Player');
    expect(Leaderboard.createEntry(null, 100).name).toBe('Player');
  });

  test('coerces score to a non-negative integer', () => {
    expect(Leaderboard.createEntry('A', 1234.56).score).toBe(1234);
    expect(Leaderboard.createEntry('A', -50).score).toBe(0);
    expect(Leaderboard.createEntry('A', '77').score).toBe(77);
    expect(Leaderboard.createEntry('A', NaN).score).toBe(0);
  });
});

describe('Leaderboard.insertScore', () => {
  test('returns a new array (does not mutate the input)', () => {
    const original = [];
    const result = Leaderboard.insertScore(original, 'Bob', 1000);
    expect(result).not.toBe(original);
    expect(original).toEqual([]);
  });

  test('inserts a score into an empty board', () => {
    const result = Leaderboard.insertScore([], 'Bob', 1000);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'Bob', score: 1000 });
  });

  test('sorts entries in descending score order', () => {
    let board = [];
    board = Leaderboard.insertScore(board, 'Low', 1000);
    board = Leaderboard.insertScore(board, 'High', 9000);
    board = Leaderboard.insertScore(board, 'Mid', 5000);
    expect(board.map(e => e.score)).toEqual([9000, 5000, 1000]);
  });

  test('caps the board at MAX_ENTRIES, dropping the lowest score', () => {
    let board = [];
    for (let i = 0; i < 15; i++) {
      board = Leaderboard.insertScore(board, `P${i}`, i * 100);
    }
    expect(board.length).toBe(Leaderboard.MAX_ENTRIES);
    // Highest score first.
    expect(board[0].score).toBe(1400);
    // Lowest surviving score is 500 (entries 5..14).
    expect(board[board.length - 1].score).toBe(500);
  });

  test('allows multiple entries from the same player', () => {
    let board = [];
    board = Leaderboard.insertScore(board, 'Twin', 2000);
    board = Leaderboard.insertScore(board, 'Twin', 8000);
    expect(board).toHaveLength(2);
    expect(board[0].score).toBe(8000);
    expect(board[1].score).toBe(2000);
  });

  test('stable-ish: equal scores keep most-recent handling deterministic', () => {
    let board = [];
    board = Leaderboard.insertScore(board, 'A', 5000);
    board = Leaderboard.insertScore(board, 'B', 5000);
    // Both present, sorted by score desc; tie broken by name asc for stability.
    expect(board.map(e => e.score)).toEqual([5000, 5000]);
    expect(board.map(e => e.name).join(',')).toBe('A,B');
  });
});

describe('Leaderboard.resetLeaderboard', () => {
  test('returns an empty array', () => {
    expect(Leaderboard.resetLeaderboard()).toEqual([]);
  });
});

describe('Leaderboard.sanitizeEntries', () => {
  test('returns empty array for non-array input', () => {
    expect(Leaderboard.sanitizeEntries(null)).toEqual([]);
    expect(Leaderboard.sanitizeEntries('foo')).toEqual([]);
    expect(Leaderboard.sanitizeEntries(123)).toEqual([]);
    expect(Leaderboard.sanitizeEntries({})).toEqual([]);
  });

  test('keeps well-formed entries', () => {
    const raw = [{ name: 'Alice', score: 5000, date: 1000 }];
    const out = Leaderboard.sanitizeEntries(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ name: 'Alice', score: 5000, date: 1000 });
  });

  test('drops entries with missing or invalid fields', () => {
    const raw = [
      { name: 'Good', score: 100, date: 1 },
      { name: 'NoScore', date: 2 },
      { score: 50, date: 3 },
      { name: 'BadScore', score: 'high', date: 4 },
      { name: 'Neg', score: -10, date: 5 },
      null,
      'garbage',
    ];
    const out = Leaderboard.sanitizeEntries(raw);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Good');
  });

  test('coerces fractional and truncates long names on load', () => {
    const raw = [{ name: 'A'.repeat(40), score: 99.9, date: 1 }];
    const out = Leaderboard.sanitizeEntries(raw);
    expect(out[0].name.length).toBe(20);
    expect(out[0].score).toBe(99);
  });

  test('caps the result at MAX_ENTRIES and sorts desc', () => {
    const raw = [];
    for (let i = 0; i < 25; i++) raw.push({ name: `P${i}`, score: i * 10, date: i });
    const out = Leaderboard.sanitizeEntries(raw);
    expect(out.length).toBe(Leaderboard.MAX_ENTRIES);
    expect(out[0].score).toBe(240);
  });
});

describe('Leaderboard.MAX_ENTRIES', () => {
  test('is 10', () => {
    expect(Leaderboard.MAX_ENTRIES).toBe(10);
  });
});

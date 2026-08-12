// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richard Robertson

/**
 * leaderboard.js — server-side high-score logic (pure functions).
 *
 * Owns the rules for the persistent leaderboard: how entries are created,
 * validated, inserted, sorted, and capped. It has NO persistence of its own
 * (no disk I/O, no localStorage) — the caller (server.js) loads the JSON
 * file, calls `sanitizeEntries` on boot, and hands entries to `insertScore`
 * / `resetLeaderboard`, writing the result back. Keeping I/O out of here makes
 * the rules trivially unit-testable.
 *
 * UMD pattern: works as `window.Leaderboard` in the browser (via <script src>)
 * and as `module.exports` in Jest (via require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Leaderboard = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_ENTRIES = 10;
  var MAX_NAME_LEN = 20;

  /**
   * Coerce an arbitrary value to a non-negative integer score.
   * @param {*} v
   * @returns {number}
   */
  function coerceScore(v) {
    var n = Math.floor(Number(v));
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }

  /**
   * Normalize a player name: trim, default blank to "Player", cap length.
   * @param {*} name
   * @returns {string}
   */
  function normalizeName(name) {
    var s = (name == null) ? '' : String(name).trim();
    if (!s) s = 'Player';
    return s.slice(0, MAX_NAME_LEN);
  }

  /**
   * Create a single, fully-validated leaderboard entry.
   * @param {string} name - Player name.
   * @param {number} score - Raw score (coerced to non-negative int).
   * @returns {{name: string, score: number, date: number}}
   */
  function createEntry(name, score) {
    return {
      name: normalizeName(name),
      score: coerceScore(score),
      date: Date.now(),
    };
  }

  /**
   * Pure insert: return a NEW sorted + capped board with the entry added.
   * Does not mutate the input array.
   * @param {Array} entries - Existing entries (sorted desc by score assumed).
   * @param {string} name
   * @param {number} score
   * @returns {Array} New board.
   */
  function insertScore(entries, name, score) {
    var entry = createEntry(name, score);
    var next = (entries || []).concat([entry]);
    next.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      // Stable tie-break: alphabetical by name so equal scores are
      // deterministic regardless of insertion order.
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return next.slice(0, MAX_ENTRIES);
  }

  /**
   * Return a fresh, empty board (used by reset).
   * @returns {Array}
   */
  function resetLeaderboard() {
    return [];
  }

  /**
   * Validate + coerce a parsed JSON array (e.g. loaded from disk). Drops any
   * entry that lacks a string name or a finite non-negative numeric score, and
   * returns a sorted, capped board safe to use.
   * @param {*} raw
   * @returns {Array}
   */
  function sanitizeEntries(raw) {
    if (!Array.isArray(raw)) return [];
    var clean = [];
    for (var i = 0; i < raw.length; i++) {
      var e = raw[i];
      if (!e || typeof e !== 'object') continue;
      if (typeof e.name !== 'string') continue;
      if (typeof e.score !== 'number' || !isFinite(e.score) || e.score < 0) continue;
      clean.push({
        name: normalizeName(e.name),
        score: Math.floor(e.score),
        date: (typeof e.date === 'number') ? e.date : 0,
      });
    }
    clean.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return clean.slice(0, MAX_ENTRIES);
  }

  return {
    MAX_ENTRIES: MAX_ENTRIES,
    createEntry: createEntry,
    insertScore: insertScore,
    resetLeaderboard: resetLeaderboard,
    sanitizeEntries: sanitizeEntries,
  };
});

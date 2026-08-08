/**
 * highScores.js — Client-side high score persistence.
 *
 * Pure functions for managing a local high-score table in localStorage.
 * No server involvement; this is a cosmetic/UI feature.
 *
 * UMD pattern: works as `window.HighScores` in the browser (via <script src>)
 * and as `module.exports` in Jest (via require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HighScores = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HIGH_SCORES_KEY = 'paccloneHighScores';
  var MAX_HIGH_SCORES = 10;

  /**
   * Load high scores from localStorage.
   * @returns {Array<{name: string, score: number, date: number}>} Sorted desc by score.
   */
  function loadHighScores() {
    try {
      var raw = localStorage.getItem(HIGH_SCORES_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (e) { return e && typeof e.score === 'number'; }).slice(0, MAX_HIGH_SCORES);
    } catch (e) {
      return [];
    }
  }

  /**
   * Persist high scores to localStorage.
   * @param {Array} scores
   */
  function saveHighScores(scores) {
    try {
      localStorage.setItem(HIGH_SCORES_KEY, JSON.stringify(scores.slice(0, MAX_HIGH_SCORES)));
    } catch (e) {
      // localStorage unavailable (private mode); ignore.
    }
  }

  /**
   * Insert a score into the high score list, sort, cap, and persist.
   * @param {string} name - Player name.
   * @param {number} score - Final score.
   * @returns {Array} The updated, sorted, capped list.
   */
  function insertHighScore(name, score) {
    var entry = {
      name: (name || 'Player').slice(0, 20),
      score: score | 0,
      date: Date.now(),
    };
    var current = loadHighScores();
    var updated = current.concat([entry]).sort(function (a, b) { return b.score - a.score; }).slice(0, MAX_HIGH_SCORES);
    saveHighScores(updated);
    return updated;
  }

  /**
   * Escape HTML special characters to prevent XSS in rendered score names.
   * @param {*} str
   * @returns {string}
   */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  return {
    HIGH_SCORES_KEY: HIGH_SCORES_KEY,
    MAX_HIGH_SCORES: MAX_HIGH_SCORES,
    loadHighScores: loadHighScores,
    saveHighScores: saveHighScores,
    insertHighScore: insertHighScore,
    escapeHtml: escapeHtml,
  };
});

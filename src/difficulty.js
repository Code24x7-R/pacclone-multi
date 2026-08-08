/**
 * difficulty.js — Pure difficulty scaling for level progression.
 *
 * Computes per-level ghost speed and frightened duration. No I/O — fully
 * deterministic and unit-testable.
 */

const FRIGHTENED_DURATION_BASE_MS = 8000;
const GHOST_BASE_SPEED = 0.08;

/**
 * Compute the ghost base speed for a given level.
 * Grows 10% per level, capped at 2x the base.
 * @param {number} level - Current level (1-based).
 * @returns {number} Scaled ghost base speed in tiles/tick.
 */
function ghostSpeedForLevel(level) {
  const speedMultiplier = Math.min(1.0 + (level - 1) * 0.1, 2.0);
  return GHOST_BASE_SPEED * speedMultiplier;
}

/**
 * Compute the frightened duration for a given level.
 * Shrinks 500ms per level, floored at 3s.
 * @param {number} level - Current level (1-based).
 * @returns {number} Frightened duration in ms.
 */
function frightenedDurationForLevel(level) {
  return Math.max(FRIGHTENED_DURATION_BASE_MS - (level - 1) * 500, 3000);
}

module.exports = {
  ghostSpeedForLevel,
  frightenedDurationForLevel,
  FRIGHTENED_DURATION_BASE_MS,
  GHOST_BASE_SPEED,
};

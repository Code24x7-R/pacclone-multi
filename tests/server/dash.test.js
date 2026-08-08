/**
 * Tests for src/gameLogic.js — updateDashState & dashSpeedMultiplier.
 *
 * Dash cycle: idle → (trigger) → active for DASH_DURATION_TICKS →
 * cooldown for DASH_COOLDOWN_TICKS → idle.
 */
const {
  updateDashState,
  dashSpeedMultiplier,
  DASH_DURATION_TICKS,
  DASH_COOLDOWN_TICKS,
  DASH_SPEED_MULTIPLIER,
} = require('../../src/gameLogic');

describe('updateDashState', () => {
  test('idle player stays idle with no trigger', () => {
    const result = updateDashState({ dashActiveTicks: 0, dashCooldownTicks: 0 }, false);
    expect(result).toEqual({ dashActiveTicks: 0, dashCooldownTicks: 0, dashing: false });
  });

  test('triggering from idle starts the dash', () => {
    const result = updateDashState({ dashActiveTicks: 0, dashCooldownTicks: 0 }, true);
    // Trigger tick counts as tick 1, so active decrements from N to N-1.
    expect(result.dashing).toBe(true);
    expect(result.dashActiveTicks).toBe(DASH_DURATION_TICKS - 1);
    expect(result.dashCooldownTicks).toBe(0);
  });

  test('dash runs for exactly DASH_DURATION_TICKS', () => {
    let state = { dashActiveTicks: 0, dashCooldownTicks: 0 };
    // Trigger.
    state = { ...state, ...updateDashState(state, true) };
    // The trigger tick counts as tick 1 of dashing.
    let ticksActive = state.dashing ? 1 : 0;

    // Keep ticking without triggering until dash ends.
    // A tick is "dashing" if the state at the START of the tick was dashing
    // (prev.dashing), because the player moves at dash speed during that tick.
    while (true) {
      const prev = state;
      state = { ...state, ...updateDashState(state, false) };
      if (prev.dashing) {
        ticksActive++;
      } else {
        break; // cooldown started last tick, no more dashing
      }
      // Safety: don't infinite loop.
      if (ticksActive > DASH_DURATION_TICKS + 10) break;
    }

    expect(ticksActive).toBe(DASH_DURATION_TICKS);
  });

  test('after dash ends, cooldown begins', () => {
    let state = { dashActiveTicks: 0, dashCooldownTicks: 0 };
    state = { ...state, ...updateDashState(state, true) };
    // Run to end of active.
    while (state.dashing) {
      state = { ...state, ...updateDashState(state, false) };
    }
    // Now cooldown should be set.
    expect(state.dashActiveTicks).toBe(0);
    expect(state.dashCooldownTicks).toBe(DASH_COOLDOWN_TICKS);
    expect(state.dashing).toBe(false);
  });

  test('cooldown ticks down to zero', () => {
    let state = { dashActiveTicks: 0, dashCooldownTicks: DASH_COOLDOWN_TICKS };
    let ticks = 0;
    while (state.dashCooldownTicks > 0) {
      state = { ...state, ...updateDashState(state, false) };
      ticks++;
      if (ticks > DASH_COOLDOWN_TICKS + 10) break;
    }
    expect(state.dashCooldownTicks).toBe(0);
    expect(state.dashing).toBe(false);
  });

  test('cannot trigger during active dash', () => {
    let state = { dashActiveTicks: 0, dashCooldownTicks: 0 };
    state = { ...state, ...updateDashState(state, true) }; // start dash
    const before = state.dashActiveTicks;
    // Try to trigger again mid-dash.
    const result = updateDashState(state, true);
    // Should ignore the trigger and continue ticking down.
    expect(result.dashActiveTicks).toBe(before - 1);
  });

  test('cannot trigger during cooldown', () => {
    const state = { dashActiveTicks: 0, dashCooldownTicks: 10 };
    const result = updateDashState(state, true);
    // Cooldown ticks down, no dash starts.
    expect(result.dashing).toBe(false);
    expect(result.dashCooldownTicks).toBe(9);
  });

  test('can trigger immediately after cooldown expires', () => {
    let state = { dashActiveTicks: 0, dashCooldownTicks: 1 };
    state = { ...state, ...updateDashState(state, false) }; // cooldown → 0
    expect(state.dashCooldownTicks).toBe(0);
    const result = updateDashState(state, true);
    expect(result.dashing).toBe(true);
  });
});

describe('dashSpeedMultiplier', () => {
  test('returns 1.0 when not dashing', () => {
    expect(dashSpeedMultiplier({ dashing: false })).toBe(1.0);
  });

  test('returns multiplier when dashing', () => {
    expect(dashSpeedMultiplier({ dashing: true })).toBe(DASH_SPEED_MULTIPLIER);
  });
});

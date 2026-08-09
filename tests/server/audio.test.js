/**
 * Tests for src/audio.js — chiptune sound effects module.
 *
 * The module depends on the Web Audio API (AudioContext), which is not present
 * in Node. We provide a lightweight mock so we can verify:
 *   - the module loads and exports all sound functions
 *   - when unmuted, each sound schedules oscillator + gain nodes
 *   - when muted, sounds are silent (no nodes scheduled)
 *   - mute toggle / getter work
 */

// --- Mock Web Audio API ------------------------------------------------------

var AudioFX; // re-required in beforeEach so each test gets a fresh module

function makeMockCtx() {
  var nodes = [];
  function track(node) {
    nodes.push(node);
    return node;
  }
  return {
    currentTime: 0,
    sampleRate: 44100,
    state: 'running',
    destination: { connect: jest.fn() },
    resume: jest.fn(),
    createOscillator: jest.fn(function () {
      return track({
        type: 'sine',
        frequency: { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
      });
    }),
    createGain: jest.fn(function () {
      return track({
        gain: { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
        connect: jest.fn(),
      });
    }),
    createBuffer: jest.fn(function (channels, length) {
      return {
        getChannelData: jest.fn(function () {
          var arr = new Float32Array(length);
          for (var i = 0; i < length; i++) arr[i] = 0.5;
          return arr;
        }),
      };
    }),
    createBufferSource: jest.fn(function () {
      return track({
        buffer: null,
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
      });
    }),
    // Test helper: how many nodes were created since last check.
    _nodeCount: function () {
      var n = nodes.length;
      nodes.length = 0;
      return n;
    },
  };
}

describe('AudioFX', () => {
  var mockCtx;

  beforeEach(function () {
    mockCtx = makeMockCtx();
    global.AudioContext = jest.fn(function () { return mockCtx; });
    global.window = { AudioContext: global.AudioContext };
    // Re-require so the module starts fresh (no cached AudioContext/mute state).
    jest.resetModules();
    AudioFX = require('../../src/audio');
  });

  test('exports all sound functions and controls', () => {
    expect(typeof AudioFX.init).toBe('function');
    expect(typeof AudioFX.toggleMute).toBe('function');
    expect(typeof AudioFX.getMuted).toBe('function');
    expect(typeof AudioFX.setMuted).toBe('function');
    expect(typeof AudioFX.playChomp).toBe('function');
    expect(typeof AudioFX.playMove).toBe('function');
    expect(typeof AudioFX.playPowerup).toBe('function');
    expect(typeof AudioFX.playEatGhost).toBe('function');
    expect(typeof AudioFX.playDeath).toBe('function');
    expect(typeof AudioFX.playGameOver).toBe('function');
    expect(typeof AudioFX.playDash).toBe('function');
    expect(typeof AudioFX.playCelebrate).toBe('function');
    expect(typeof AudioFX.playExtraLife).toBe('function');
    expect(typeof AudioFX.playHighScore).toBe('function');
    expect(typeof AudioFX.playStart).toBe('function');
  });

  test('mute controls toggle and persist', () => {
    expect(AudioFX.getMuted()).toBe(false);
    expect(AudioFX.toggleMute()).toBe(true);
    expect(AudioFX.getMuted()).toBe(true);
    AudioFX.setMuted(false);
    expect(AudioFX.getMuted()).toBe(false);
  });

  test('muted sounds schedule no audio nodes', () => {
    AudioFX.setMuted(true);
    AudioFX.init();
    mockCtx._nodeCount(); // clear init's nodes

    AudioFX.playChomp();
    AudioFX.playPowerup();
    AudioFX.playDeath();
    expect(mockCtx._nodeCount()).toBe(0);
  });

  test('unmuted chomp schedules an oscillator and gain', () => {
    AudioFX.setMuted(false);
    AudioFX.init();
    mockCtx._nodeCount();

    AudioFX.playChomp();
    // oscillator + gain = 2 nodes
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
    expect(mockCtx.createGain).toHaveBeenCalledTimes(1);
  });

  test('powerup uses an LFO (extra oscillator + gain)', () => {
    AudioFX.setMuted(false);
    AudioFX.init();
    mockCtx._nodeCount();

    AudioFX.playPowerup();
    // main osc + main gain + lfo osc + lfo gain = 4
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
    expect(mockCtx.createGain).toHaveBeenCalledTimes(2);
  });

  test('dash schedules a noise buffer source in addition to the sweep', () => {
    AudioFX.setMuted(false);
    AudioFX.init();
    mockCtx._nodeCount();

    AudioFX.playDash();
    expect(mockCtx.createBuffer).toHaveBeenCalledTimes(1);
    expect(mockCtx.createBufferSource).toHaveBeenCalledTimes(1);
  });

  test('game-over schedules five notes (5 oscillators)', () => {
    AudioFX.setMuted(false);
    AudioFX.init();
    mockCtx._nodeCount();

    AudioFX.playGameOver();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(5);
  });

  test('playStart handles rests (freq 0) without scheduling an oscillator', () => {
    AudioFX.setMuted(false);
    AudioFX.init();
    mockCtx._nodeCount();

    // Should not throw even though the note array contains rests.
    expect(() => AudioFX.playStart()).not.toThrow();
    // 16 notes in the array, 3 are rests -> 13 oscillators.
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(13);
  });

  // --- Verify every sound function runs without throwing and schedules audio ---

  test('playMove schedules a short subdued blip', () => {
    AudioFX.setMuted(false);
    AudioFX.init();
    mockCtx._nodeCount();
    expect(() => AudioFX.playMove()).not.toThrow();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
    expect(mockCtx.createGain).toHaveBeenCalledTimes(1);
  });

  test('playEatGhost schedules an upward frequency sweep', () => {
    AudioFX.setMuted(false);
    AudioFX.init();
    mockCtx._nodeCount();
    expect(() => AudioFX.playEatGhost()).not.toThrow();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
    // The sweep uses exponentialRampToValueAtTime on frequency.
    var osc = mockCtx.createOscillator.mock.results[0].value;
    expect(osc.frequency.exponentialRampToValueAtTime).toHaveBeenCalledTimes(1);
  });

  test('playDeath schedules a downward sawtooth sweep', () => {
    AudioFX.setMuted(false);
    AudioFX.init();
    mockCtx._nodeCount();
    expect(() => AudioFX.playDeath()).not.toThrow();
    var osc = mockCtx.createOscillator.mock.results[0].value;
    expect(osc.type).toBe('sawtooth');
    expect(osc.frequency.exponentialRampToValueAtTime).toHaveBeenCalledTimes(1);
  });

  test('playCelebrate schedules four ascending notes', () => {
    AudioFX.setMuted(false);
    AudioFX.init();
    mockCtx._nodeCount();
    expect(() => AudioFX.playCelebrate()).not.toThrow();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(4);
  });

  test('playExtraLife schedules four 1-UP notes', () => {
    AudioFX.setMuted(false);
    AudioFX.init();
    mockCtx._nodeCount();
    expect(() => AudioFX.playExtraLife()).not.toThrow();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(4);
  });

  test('playHighScore schedules a seven-note jingle', () => {
    AudioFX.setMuted(false);
    AudioFX.init();
    mockCtx._nodeCount();
    expect(() => AudioFX.playHighScore()).not.toThrow();
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(7);
  });

  // --- verify getContext guards against missing AudioContext -----------------------

  test('sounds are no-ops when AudioContext is unavailable', () => {
    // Remove the mock AudioContext so getContext() returns null.
    delete global.AudioContext;
    delete global.window;
    jest.resetModules();
    var AudioFX2 = require('../../src/audio');
    // init() and all sounds should silently do nothing (no throw).
    expect(() => {
      AudioFX2.init();
      AudioFX2.playChomp();
      AudioFX2.playDash();
      AudioFX2.playGameOver();
    }).not.toThrow();
  });
});

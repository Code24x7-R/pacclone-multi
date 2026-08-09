/**
 * audio.js — Chiptune sound effects for pacclone-multi.
 *
 * Ported from the single-player pacclone reference. All sounds are synthesized
 * live with the Web Audio API (no asset files). Each sound uses a short
 * oscillator + gain envelope; some add LFO modulation, frequency sweeps, or
 * filtered noise for texture.
 *
 * UMD pattern: works as `window.AudioFX` in the browser (via <script src>) and
 * as `module.exports` in Jest (via require).
 *
 * Browser usage:
 *   <script src="src/audio.js"></script>
 *   AudioFX.init();                       // call on a user gesture
 *   AudioFX.playChomp();
 *   AudioFX.toggleMute();
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AudioFX = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var audioContext = null;
  var isMuted = false;

  function getContext() {
    if (!audioContext) {
      var Ctx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
      if (!Ctx) return null;
      audioContext = new Ctx();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    return audioContext;
  }

  // Some sounds need a user gesture to unlock audio. Call this on the first
  // click/keypress so the AudioContext is ready when gameplay starts.
  function init() {
    getContext();
  }

  function setMuted(muted) {
    isMuted = !!muted;
  }

  function toggleMute() {
    isMuted = !isMuted;
    return isMuted;
  }

  function getMuted() {
    return isMuted;
  }

  // ---------------------------------------------------------------------------
  // Sound effects
  // ---------------------------------------------------------------------------

  /**
   * Pellet chomp — short square-wave "blip" with slight random pitch variation
   * so rapid chomping does not sound monotonous.
   */
  function playChomp() {
    if (isMuted) return;
    var ctx = getContext();
    if (!ctx) return;
    var now = ctx.currentTime;
    var duration = 0.05;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'square';
    osc.frequency.setValueAtTime(300 + (Math.random() * 50 - 25), now);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.start(now);
    osc.stop(now + duration);
  }

  /**
   * Continuous movement — very low, subdued hum. Call sparingly (e.g. on tile
   * change) so it does not become annoying.
   */
  function playMove() {
    if (isMuted) return;
    var ctx = getContext();
    if (!ctx) return;
    var now = ctx.currentTime;
    var duration = 0.15;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'square';
    osc.frequency.setValueAtTime(30 + (Math.random() * 20 - 10), now);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.005, now + duration);

    osc.start(now);
    osc.stop(now + duration);
  }

  /**
   * Power-up collected — triangle wave with an LFO wobble for a rising,
   * energetic feel.
   */
  function playPowerup() {
    if (isMuted) return;
    var ctx = getContext();
    if (!ctx) return;
    var now = ctx.currentTime;
    var duration = 0.4;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var lfo = ctx.createOscillator();
    var lfoGain = ctx.createGain();

    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(10, now);
    lfoGain.gain.setValueAtTime(50, now);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    lfo.start(now);
    lfo.stop(now + duration);
    osc.start(now);
    osc.stop(now + duration);
  }

  /**
   * Ghost eaten — rapid upward frequency sweep, celebratory "zap".
   */
  function playEatGhost() {
    if (isMuted) return;
    var ctx = getContext();
    if (!ctx) return;
    var now = ctx.currentTime;
    var duration = 0.2;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'square';
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + duration);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.start(now);
    osc.stop(now + duration);
  }

  /**
   * Player death — harsh downward sawtooth sweep, like a machine powering down.
   */
  function playDeath() {
    if (isMuted) return;
    var ctx = getContext();
    if (!ctx) return;
    var now = ctx.currentTime;
    var duration = 0.9;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + duration);

    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.start(now);
    osc.stop(now + duration);
  }

  /**
   * Game over — descending five-note arpeggio.
   */
  function playGameOver() {
    if (isMuted) return;
    var ctx = getContext();
    if (!ctx) return;
    var now = ctx.currentTime;
    var noteDur = 0.25;
    var notes = [330, 220, 165, 110, 55];

    notes.forEach(function (freq, i) {
      var start = now + i * noteDur;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.4, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + noteDur);

      osc.start(start);
      osc.stop(start + noteDur);
    });
  }

  /**
   * Dash — high sawtooth "whoosh" sweeping down, plus a burst of white noise.
   */
  function playDash() {
    if (isMuted) return;
    var ctx = getContext();
    if (!ctx) return;
    var now = ctx.currentTime;
    var duration = 0.4;

    // Tonal sweep.
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(2500, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + duration);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.start(now);
    osc.stop(now + duration);

    // Noise burst.
    var bufferSize = Math.floor(ctx.sampleRate * duration);
    var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    var output = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    var noise = ctx.createBufferSource();
    noise.buffer = buffer;
    var noiseGain = ctx.createGain();
    noise.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(0.15, now + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.start(now);
    noise.stop(now + duration);
  }

  /**
   * Level complete celebration — ascending C major arpeggio (C-E-G-C).
   */
  function playCelebrate() {
    if (isMuted) return;
    var ctx = getContext();
    if (!ctx) return;
    var now = ctx.currentTime;
    var noteDur = 0.1;
    var notes = [261.63, 329.63, 392.0, 523.25];

    notes.forEach(function (freq, i) {
      var start = now + i * noteDur;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.35, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + noteDur);

      osc.start(start);
      osc.stop(start + noteDur);
    });
  }

  /**
   * Extra life earned — quick ascending 1-UP figure.
   */
  function playExtraLife() {
    if (isMuted) return;
    var ctx = getContext();
    if (!ctx) return;
    var now = ctx.currentTime;
    var noteDur = 0.09;
    var notes = [523.25, 659.25, 783.99, 1046.5];

    notes.forEach(function (freq, i) {
      var start = now + i * noteDur;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.4, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + noteDur);

      osc.start(start);
      osc.stop(start + noteDur);
    });
  }

  /**
   * High score achieved — Pac-Man style jingle.
   */
  function playHighScore() {
    if (isMuted) return;
    var ctx = getContext();
    if (!ctx) return;
    var now = ctx.currentTime;
    var noteDur = 0.08;
    var gap = 0.02;
    var start = now + 0.1;
    var notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 523.25];

    notes.forEach(function (freq, i) {
      var noteStart = start + i * (noteDur + gap);
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, noteStart);

      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(0.35, noteStart + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, noteStart + noteDur);

      osc.start(noteStart);
      osc.stop(noteStart + noteDur);
    });
  }

  /**
   * Game start — bright arcade jingle.
   */
  function playStart() {
    if (isMuted) return;
    var ctx = getContext();
    if (!ctx) return;
    var now = ctx.currentTime;
    var tempo = 180;
    var eighth = 60 / tempo / 2;
    var start = now + 0.1;

    var notes = [
      { freq: 932.33, dur: eighth },
      { freq: 0, dur: eighth / 2 },
      { freq: 932.33, dur: eighth },
      { freq: 783.99, dur: eighth },
      { freq: 698.46, dur: eighth },
      { freq: 622.25, dur: eighth },
      { freq: 0, dur: eighth / 2 },
      { freq: 698.46, dur: eighth },
      { freq: 622.25, dur: eighth },
      { freq: 523.25, dur: eighth },
      { freq: 466.16, dur: eighth },
      { freq: 0, dur: eighth / 2 },
      { freq: 523.25, dur: eighth },
      { freq: 466.16, dur: eighth },
      { freq: 392.0, dur: eighth },
      { freq: 523.25, dur: eighth * 8 }
    ];

    var cumulative = start;
    notes.forEach(function (n) {
      if (n.freq > 0) {
        var noteStart = cumulative;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'square';
        osc.frequency.setValueAtTime(n.freq, noteStart);

        gain.gain.setValueAtTime(0, noteStart);
        gain.gain.linearRampToValueAtTime(0.35, noteStart + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + n.dur);

        osc.start(noteStart);
        osc.stop(noteStart + n.dur);
      }
      cumulative += n.dur;
    });
  }

  return {
    init: init,
    getContext: getContext,
    setMuted: setMuted,
    toggleMute: toggleMute,
    getMuted: getMuted,
    playChomp: playChomp,
    playMove: playMove,
    playPowerup: playPowerup,
    playEatGhost: playEatGhost,
    playDeath: playDeath,
    playGameOver: playGameOver,
    playDash: playDash,
    playCelebrate: playCelebrate,
    playExtraLife: playExtraLife,
    playHighScore: playHighScore,
    playStart: playStart,
  };
});

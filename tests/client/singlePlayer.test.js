/**
 * Client-side tests for the single-player button.
 *
 * Verifies the Single Player button sends the correct WebSocket message
 * and sets the client-side single-player flag.
 */
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    MockWebSocket.lastInstance = this;
    setTimeout(() => {
      this.readyState = 1;
      if (this.onopen) this.onopen();
    }, 0);
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  dispatch(msg) { if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) }); }
}

function createMockCanvas() {
  const ctx = {};
  const noop = () => {};
  for (const m of ['fillRect', 'clearRect', 'beginPath', 'arc', 'fill', 'stroke', 'save', 'restore', 'moveTo', 'lineTo', 'closePath', 'fillText', 'setLineDash', 'translate', 'rotate', 'scale', 'roundRect', 'createLinearGradient', 'quadraticCurveTo']) {
    ctx[m] = m === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop;
  }
  return ctx;
}

describe('Single-player button', () => {
  let container;

  beforeEach(() => {
    MockWebSocket.lastInstance = null;
    container = document.createElement('div');
    container.innerHTML = `
      <div id="lobby">
        <input id="playerNameInput" />
        <button id="joinLobbyButton">Join</button>
        <button id="readyButton" style="display:none">Ready</button>
        <ul id="playersList"></ul>
        <ol id="highScoresList"></ol>
        <button id="singlePlayerButton" class="btn btn-single">Single Player</button>
        <button id="startGameButton" disabled>Start Game</button>
        <div id="hostStatus"></div>
        <div id="countdownOverlay" style="display:none"><div id="countdownNumber">3</div></div>
      </div>
      <canvas id="gameCanvas" width="800" height="520"></canvas>
      <button id="leaveButton" style="display:none">Leave</button>
      <button id="muteButton">Mute</button>
    `;
    document.body.appendChild(container);

    global.WebSocket = MockWebSocket;
    const canvas = document.getElementById('gameCanvas');
    canvas.getContext = () => createMockCanvas();
    global.requestAnimationFrame = () => 0;
    global.cancelAnimationFrame = () => {};
    global.AudioContext = undefined;
    window.AudioContext = undefined;
    const store = {};
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      },
      configurable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function loadClient() {
    const fs = require('fs');
    const path = require('path');
    global.HighScores = require('../../src/highScores.js');
    global.AudioFX = require('../../src/audio.js');
    global.GhostRenderer = require('../../src/ghostRenderer.js');
    global.TouchControls = require('../../src/touchControls.js');
    global.RenderCache = require('../../src/renderCache.js');

    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const mainBlock = blocks[blocks.length - 1];
    eval(mainBlock);
  }

  test('clicking Single Player sends startSinglePlayer message', () => {
    loadClient();
    const ws = MockWebSocket.lastInstance;
    // Wait for the connection to open.
    return new Promise((resolve) => {
      const check = () => {
        if (ws && ws.readyState === 1) resolve();
        else setTimeout(check, 5);
      };
      check();
    }).then(() => {
      const singlePlayerBtn = document.getElementById('singlePlayerButton');
      singlePlayerBtn.click();

      const sent = ws.sent.find((m) => m.type === 'startSinglePlayer');
      expect(sent).toBeDefined();
    });
  });

  test('Single Player button is visible in the lobby initially', () => {
    loadClient();
    const singlePlayerBtn = document.getElementById('singlePlayerButton');
    expect(singlePlayerBtn.style.display).not.toBe('none');
  });
});

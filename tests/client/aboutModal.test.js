/**
 * Client-side tests for the About modal.
 *
 * Verifies the About modal opens, renders content, and closes via
 * button, backdrop click, and Escape key.
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

describe('About modal', () => {
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
      <button id="aboutButton">About</button>
      <div id="aboutBackdrop" class="about-backdrop">
        <div class="about-modal">
          <div class="about-header">
            <span id="aboutTitle" class="about-title">About Pacclone Multi</span>
            <span id="aboutVersion" class="about-version">v0.0.1</span>
            <button id="aboutCloseBtn" class="about-close">✕</button>
          </div>
          <div class="about-body" id="aboutBody"></div>
          <div class="about-footer">
            <span id="aboutBuild" class="about-build"></span>
            <button id="aboutCloseBtn2" class="btn btn-cyan">Close</button>
          </div>
        </div>
      </div>
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

    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const mainBlock = blocks[blocks.length - 1];
    eval(mainBlock);
  }

  test('modal is hidden initially', () => {
    loadClient();
    const backdrop = document.getElementById('aboutBackdrop');
    expect(backdrop.classList.contains('open')).toBe(false);
  });

  test('clicking About button opens the modal and renders content', () => {
    loadClient();
    const aboutBtn = document.getElementById('aboutButton');
    const backdrop = document.getElementById('aboutBackdrop');
    const body = document.getElementById('aboutBody');

    aboutBtn.click();

    expect(backdrop.classList.contains('open')).toBe(true);
    expect(body.querySelector('h1').textContent).toBe('Pacclone Multi');
    expect(body.querySelector('.about-tagline').textContent).toBe('Last player standing wins');
    // Sections rendered
    expect(body.querySelectorAll('h2').length).toBeGreaterThan(0);
    // Features list present
    expect(body.innerHTML).toContain('Multiplayer');
    // Controls table present
    expect(body.innerHTML).toContain('Dash');
  });

  test('close button (X) closes the modal', () => {
    loadClient();
    document.getElementById('aboutButton').click();
    const backdrop = document.getElementById('aboutBackdrop');
    expect(backdrop.classList.contains('open')).toBe(true);

    document.getElementById('aboutCloseBtn').click();
    expect(backdrop.classList.contains('open')).toBe(false);
  });

  test('footer Close button closes the modal', () => {
    loadClient();
    document.getElementById('aboutButton').click();
    const backdrop = document.getElementById('aboutBackdrop');
    expect(backdrop.classList.contains('open')).toBe(true);

    document.getElementById('aboutCloseBtn2').click();
    expect(backdrop.classList.contains('open')).toBe(false);
  });

  test('clicking the backdrop outside the modal closes it', () => {
    loadClient();
    document.getElementById('aboutButton').click();
    const backdrop = document.getElementById('aboutBackdrop');
    expect(backdrop.classList.contains('open')).toBe(true);

    // Click on the backdrop itself (not the modal content).
    backdrop.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(backdrop.classList.contains('open')).toBe(false);
  });

  test('clicking inside the modal does NOT close it', () => {
    loadClient();
    document.getElementById('aboutButton').click();
    const backdrop = document.getElementById('aboutBackdrop');
    const modal = backdrop.querySelector('.about-modal');
    expect(backdrop.classList.contains('open')).toBe(true);

    // Click inside the modal content — should stay open.
    modal.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(backdrop.classList.contains('open')).toBe(true);
  });

  test('Escape key closes the modal', () => {
    loadClient();
    document.getElementById('aboutButton').click();
    const backdrop = document.getElementById('aboutBackdrop');
    expect(backdrop.classList.contains('open')).toBe(true);

    const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);
    expect(backdrop.classList.contains('open')).toBe(false);
  });

  test('build info is displayed in the footer', () => {
    loadClient();
    document.getElementById('aboutButton').click();
    const build = document.getElementById('aboutBuild');
    expect(build.textContent).toContain('v0.0.1');
  });
});

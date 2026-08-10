/**
 * Integration test: AFK lobby sweep.
 *
 * Verifies the server autonomously removes idle lobby players and promotes the
 * next player to host when the host goes AFK. Uses short AFK env-driven
 * timings so the periodic sweep runs on a deterministic, fast cycle.
 *
 *   - AFK_TIMEOUT_MS: how long a player can be silent before removal.
 *   - AFK_CHECK_INTERVAL_MS: how often the sweep runs.
 *
 * Both are read by src/gameLogic.js at require time, so they MUST be set
 * before requiring ../../server.js.
 */
process.env.AFK_TIMEOUT_MS = '200';
process.env.AFK_CHECK_INTERVAL_MS = '100';

const WebSocket = require('ws');

const { server } = require('../../server.js');

let url = '';
const activeClients = [];

function track(ws) {
  activeClients.push(ws);
  ws.on('close', () => {
    const i = activeClients.indexOf(ws);
    if (i !== -1) activeClients.splice(i, 1);
  });
  return ws;
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = track(new WebSocket(url));
    const buffer = [];
    ws.on('message', (data) => buffer.push(JSON.parse(data.toString())));
    ws.on('open', () => resolve({ ws, buffer }));
    ws.on('error', reject);
  });
}

function waitFor(ctx, type, timeout = 3000) {
  const already = ctx.buffer.find((m) => m.type === type);
  if (already) return Promise.resolve(already);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${type}"`)),
      timeout,
    );
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ctx.ws.off('message', handler);
        resolve(msg);
      }
    };
    ctx.ws.on('message', handler);
  });
}

function send(ctx, obj) {
  ctx.ws.send(JSON.stringify(obj));
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wait until a message arrives in the buffer that satisfies a predicate.
 * Resolves with the first matching message, or rejects on timeout. Unlike
 * waitFor (which matches on type only), this lets a test wait for a specific
 * lobbyState shape — essential when the AFK sweep interval is tight and a
 * fixed delay would race the next sweep.
 */
function waitForPredicate(ctx, predicate, timeout = 3000) {
  const already = ctx.buffer.find(predicate);
  if (already) return Promise.resolve(already);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for predicate')),
      timeout,
    );
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ctx.ws.off('message', handler);
        resolve(msg);
      }
    };
    ctx.ws.on('message', handler);
  });
}

beforeAll((done) => {
  server.listen(0, () => {
    url = `ws://localhost:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

afterEach((done) => {
  const pending = activeClients.filter((ws) => ws.readyState === WebSocket.OPEN);
  if (pending.length === 0) {
    setTimeout(done, 50);
    return;
  }
  let closed = 0;
  pending.forEach((ws) => {
    ws.close();
    ws.once('close', () => {
      closed += 1;
      if (closed === pending.length) setTimeout(done, 50);
    });
  });
});

describe('AFK lobby sweep', () => {
  test('a silent lobby player is removed after the AFK timeout', async () => {
    const alice = await connect();
    await waitFor(alice, 'welcome');
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');

    // Alice never sends another message. After ~2 AFK_CHECK_INTERVAL_MS cycles
    // (200ms timeout, 100ms interval), the sweep should remove her and send a
    // `kicked` notification to her still-open socket.
    const kicked = await waitFor(alice, 'kicked', 3000);
    expect(kicked.message).toMatch(/inactivity/);
  });

  test('AFK host removal promotes the next player to host', async () => {
    const alice = await connect();
    const bob = await connect();

    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    // Alice (host, joined first) and Bob both join.
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');

    // Give both a lobbyState so they know the roster.
    await waitFor(alice, 'lobbyState');
    await waitFor(bob, 'lobbyState');

    // Bob stays active: a keepalive timer sends periodic chat so his
    // lastActivity never ages past the AFK timeout. Alice goes silent.
    const keepalive = setInterval(() => {
      if (bob.ws.readyState === WebSocket.OPEN) {
        send(bob, { type: 'chat', text: 'still here' });
      }
    }, 50);

    // The sweep that kicks Alice also broadcasts the updated lobbyState in the
    // same tick — wait for BOTH so the assertions land before the next sweep.
    try {
      const [aliceKicked, bobSolo] = await Promise.all([
        waitFor(alice, 'kicked', 3000),
        // Wait for a lobbyState where Bob is the ONLY remaining player — not
        // the stale length-1 state from when only Alice had joined.
        waitForPredicate(
          bob,
          (m) => m.type === 'lobbyState' && m.lobbyPlayers && m.lobbyPlayers.length === 1 && m.lobbyPlayers[0].name === 'Bob',
          3000,
        ),
      ]);
      expect(aliceKicked.message).toMatch(/inactivity/);
      // Bob is now the only player and therefore the host.
      expect(bobSolo.lobbyPlayers[0].name).toBe('Bob');
    } finally {
      clearInterval(keepalive);
    }
  });

  test('an active player is NOT removed by the AFK sweep', async () => {
    const alice = await connect();
    await waitFor(alice, 'welcome');
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    await waitFor(alice, 'lobbyState');

    // Stay active: chat every 50ms for ~600ms (well beyond the 200ms timeout).
    for (let i = 0; i < 6; i += 1) {
      send(alice, { type: 'chat', text: `ping ${i}` });
      await wait(100);
    }

    // Alice should NOT have been kicked. Inspect the buffer directly.
    const kicked = alice.buffer.find((m) => m.type === 'kicked');
    expect(kicked).toBeUndefined();
    // And she should still be in the lobby.
    const latestLobby = alice.buffer
      .filter((m) => m.type === 'lobbyState')
      .pop();
    expect(latestLobby.lobbyPlayers).toHaveLength(1);
    expect(latestLobby.lobbyPlayers[0].name).toBe('Alice');
  });

  test('an AFK player is removed from an active single-player match', async () => {
    const alice = await connect();
    await waitFor(alice, 'welcome');
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    await waitFor(alice, 'lobbyState');

    // Start a single-player match.
    send(alice, { type: 'startSinglePlayer' });
    const gameStart = await waitFor(alice, 'gameState', 3000);
    expect(gameStart.gameState.currentGameState).toBe('IN_PROGRESS');

    // Alice goes silent. The in-game AFK sweep should remove her from the
    // match and end it (0 players left). She receives `kicked`, and the
    // server broadcasts a gameState with GAME_OVER synchronously via endMatch.
    const [kicked, gameOver] = await Promise.all([
      waitFor(alice, 'kicked', 3000),
      waitForPredicate(
        alice,
        (m) => m.type === 'gameState' && m.gameState && m.gameState.currentGameState === 'GAME_OVER',
        3000,
      ),
    ]);
    expect(kicked.message).toMatch(/inactivity/);
    // The game-over payload should have zero players (Alice was swept).
    expect(gameOver.gameState.players).toHaveLength(0);

    // Wait out the server's post-match lobby-reset timer (single-player
    // rebuilds the lobby from singlePlayerInfo) so the timer fires while the
    // server is still alive — avoids a teardown warning from the 5s timer.
    await waitForPredicate(
      alice,
      (m) => m.type === 'lobbyState' && m.lobbyPlayers && m.lobbyPlayers.length === 1,
      8000,
    );
  });
});

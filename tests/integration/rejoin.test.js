/**
 * Integration test: player rejoin flow across multiple games.
 *
 * Verifies the fix for the "cannot play after rejoining" bug:
 *   1. Players join lobby, game starts (playerAssigned sent).
 *   2. A player disconnects → last-man-standing ends the game.
 *   3. Game resets to LOBBY (5s production delay).
 *   4. Player rejoins, new game starts.
 *   5. The client receives playerAssigned again so myPlayerId is restored
 *      and it can send input.
 *
 * Also verifies duplicate lobby joins are deduped.
 *
 * NOTE: These tests use a real server bound to an OS-assigned port (port 0).
 * They exercise the actual WebSocket message flow including the 5s
 * game-over → lobby reset delay, so timeouts are generous.
 */
const WebSocket = require('ws');

const { server } = require('../../server.js');

let url = '';

// Track all clients so we can close them cleanly in afterEach, avoiding
// "Cannot log after tests are done" warnings from the server's disconnect
// handler firing after Jest has finished the test.
const activeClients = [];

/**
 * Wrap a WebSocket so it auto-removes itself from activeClients once closed,
 * preventing double-close and stale references.
 */
function track(ws) {
  activeClients.push(ws);
  ws.on('close', () => {
    const i = activeClients.indexOf(ws);
    if (i !== -1) activeClients.splice(i, 1);
  });
  return ws;
}

/**
 * Connection context: wraps a WebSocket plus a message buffer so we never
 * miss early messages (e.g. 'welcome') that arrive before test code attaches
 * its listener.
 */
function connect() {
  return new Promise((resolve, reject) => {
    const ws = track(new WebSocket(url));
    const buffer = [];
    ws.on('message', (data) => buffer.push(JSON.parse(data.toString())));
    ws.on('open', () => resolve({ ws, buffer }));
    ws.on('error', reject);
  });
}

/**
 * Wait for a message of `type`, scanning the buffer first so already-received
 * messages are returned immediately.
 */
function waitFor(ctx, type, timeout = 3000) {
  const already = ctx.buffer.find((m) => m.type === type);
  if (already) return Promise.resolve(already);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${type}"`)), timeout);
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

/** Collect all messages of `type` received during a time window. */
function collectMessages(ctx, type, duration) {
  return new Promise((resolve) => {
    const collected = [];
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) collected.push(msg);
    };
    ctx.ws.on('message', handler);
    setTimeout(() => {
      ctx.ws.off('message', handler);
      resolve(collected);
    }, duration);
  });
}

function send(ctx, obj) {
  ctx.ws.send(JSON.stringify(obj));
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

// Close any clients that are still open and wait for the close to propagate.
// This ensures the server's disconnect handler runs while the test is still
// active, avoiding "Cannot log after tests are done" warnings.
afterEach((done) => {
  const pending = activeClients.filter((ws) => ws.readyState === WebSocket.OPEN);
  if (pending.length === 0) {
    // Give the event loop a tick so any in-flight close handlers resolve.
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

describe('Player rejoin across games', () => {
  test('players receive playerAssigned on each new game start with the same ID', async () => {
    const alice = await connect();
    const bob = await connect();

    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    // Both join the lobby.
    send(alice, { type: 'joinLobby', name: 'Alice' });
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(alice, 'lobbyState');
    await waitFor(bob, 'lobbyState');

    // Alice starts the game.
    send(alice, { type: 'startGame' });

    // Both must receive playerAssigned with distinct, positive IDs.
    const aliceAssigned = await waitFor(alice, 'playerAssigned');
    const bobAssigned = await waitFor(bob, 'playerAssigned');
    expect(aliceAssigned.playerId).toBeGreaterThan(0);
    expect(bobAssigned.playerId).toBeGreaterThan(0);
    expect(aliceAssigned.playerId).not.toBe(bobAssigned.playerId);

    const aliceId = aliceAssigned.playerId;

    // Confirm the game is broadcasting state.
    await waitFor(alice, 'gameState');
    await new Promise((r) => setTimeout(r, 200));

    // Disconnect Bob → last-man-standing ends the match.
    bob.ws.close();

    // The server resets to LOBBY 5s after game over. Wait for that broadcast.
    const resetLobby = await waitFor(alice, 'lobbyState', 8000);
    expect(resetLobby.currentGameState).toBe('LOBBY');

    // Alice rejoins and starts a new game.
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyState');
    send(alice, { type: 'startGame' });

    // Alice MUST get playerAssigned again with the same ID. Before the fix
    // the client nulled myPlayerId on spectator mode and never restored it,
    // so it could not send input in the new game.
    const aliceReassigned = await waitFor(alice, 'playerAssigned');
    expect(aliceReassigned.playerId).toBe(aliceId);

    // Alice must appear in the new game's players list.
    const gs = await waitFor(alice, 'gameState');
    expect(gs.gameState.currentGameState).toBe('IN_PROGRESS');
    const alicePlayer = gs.gameState.players.find((p) => p.id === aliceId);
    expect(alicePlayer).toBeDefined();

    alice.ws.close();
  }, 20000);

  test('duplicate joinLobby from the same connection is deduped', async () => {
    const ctx = await connect();
    await waitFor(ctx, 'welcome');

    // Simulate rapid double-clicks of "Join Lobby".
    send(ctx, { type: 'joinLobby', name: 'Twin' });
    send(ctx, { type: 'joinLobby', name: 'Twin' });
    send(ctx, { type: 'joinLobby', name: 'Twin' });

    const lobbies = await collectMessages(ctx, 'lobbyState', 500);

    // Every broadcast must list exactly one player — no duplicates.
    expect(lobbies.length).toBeGreaterThan(0);
    lobbies.forEach((msg) => {
      expect(msg.lobbyPlayers).toHaveLength(1);
      expect(msg.lobbyPlayers[0].name).toBe('Twin');
    });

    ctx.ws.close();
  }, 10000);
});

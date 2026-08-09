/**
 * Integration test: single-player mode.
 *
 * Verifies the single-player flow:
 *   1. A player can start a solo game from the lobby (no ready-up/countdown).
 *   2. The match starts immediately with one player.
 *   3. Other lobby players are NOT pulled into the game (they stay in lobby).
 *   4. After the match ends (player leaves), the single player returns to the
 *      lobby.
 *
 * Test isolation: each test ends by sending `leaveGame` to return the server
 * to the LOBBY state. A dangling single-player match (e.g. a disconnected
 * client) keeps the server in IN_PROGRESS via the grace period and would block
 * the next test from joining the lobby.
 *
 * NOTE: These tests use a real server bound to an OS-assigned port (port 0).
 * They exercise the actual WebSocket message flow including the 5s game-over
 * → lobby reset delay, so timeouts are generous.
 */
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
      timeout
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

/** Drain all pending messages so waitFor sees a clean slate. */
function drain(ctx, duration = 150) {
  return new Promise((r) => setTimeout(r, duration));
}

/** Clear the message buffer so waitFor only matches FRESH messages. */
function clearBuffer(ctx) {
  ctx.buffer.length = 0;
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

describe('Single-player mode', () => {
  test('starts immediately with one player, no countdown', async () => {
    const alice = await connect();

    await waitFor(alice, 'welcome');
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    await drain(alice);

    // Start single-player: should get playerAssigned immediately (no countdown).
    send(alice, { type: 'startSinglePlayer' });
    const assigned = await waitFor(alice, 'playerAssigned', 3000);
    expect(assigned.playerId).toBeDefined();

    // The game state should be IN_PROGRESS right away (no COUNTDOWN state).
    const gameState = await waitFor(alice, 'gameState', 3000);
    expect(gameState.gameState.currentGameState).toBe('IN_PROGRESS');
    // Exactly one player — the single player.
    expect(gameState.gameState.players.length).toBe(1);
    expect(gameState.gameState.players[0].name).toBe('Alice');

    // Clean up: leave the game so the server returns to LOBBY.
    clearBuffer(alice);
    send(alice, { type: 'leaveGame' });
    await waitFor(alice, 'returnToLobby', 3000);
  });

  test('other lobby players stay in the lobby during single-player game', async () => {
    const alice = await connect();
    const bob = await connect();

    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    // Both join the lobby.
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    await drain(alice);
    await drain(bob);

    // Alice starts single-player.
    send(alice, { type: 'startSinglePlayer' });
    await waitFor(alice, 'playerAssigned', 3000);

    // Bob (still in lobby) receives a lobbyState that no longer lists Alice
    // (she left the lobby to play), but Bob himself remains.
    await drain(bob);
    const bobLobby = bob.buffer.filter((m) => m.type === 'lobbyState').pop();
    expect(bobLobby).toBeDefined();
    // Alice is gone from the lobby list.
    expect(bobLobby.lobbyPlayers.find((p) => p.name === 'Alice')).toBeUndefined();
    // Bob is still in the lobby.
    expect(bobLobby.lobbyPlayers.find((p) => p.name === 'Bob')).toBeDefined();

    // Clean up: Alice leaves her single-player game.
    clearBuffer(alice);
    send(alice, { type: 'leaveGame' });
    await waitFor(alice, 'returnToLobby', 3000);
  });

  test('single player returns to lobby after the match ends', async () => {
    const alice = await connect();

    await waitFor(alice, 'welcome');
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    await drain(alice);
    const aliceToken = alice.buffer.find((m) => m.type === 'lobbyJoined').token;

    // Start single-player.
    send(alice, { type: 'startSinglePlayer' });
    await waitFor(alice, 'playerAssigned', 3000);
    await waitFor(alice, 'gameState', 3000);

    // Force-end the match by sending leaveGame (simulates the player quitting).
    // This triggers endMatch → 5s later the lobby rebuilds with Alice.
    clearBuffer(alice);
    send(alice, { type: 'leaveGame' });

    // Alice should get returnToLobby (from handleLeaveGame).
    const returnMsg = await waitFor(alice, 'returnToLobby', 3000);
    expect(returnMsg.lobbyPlayers.find((p) => p.id === aliceToken)).toBeDefined();

    // After the 5s game-over reset, Alice is back in the lobby as the host.
    await drain(alice, 6000);
    const finalLobby = alice.buffer.filter((m) => m.type === 'lobbyState').pop();
    expect(finalLobby).toBeDefined();
    expect(finalLobby.currentGameState).toBe('LOBBY');
    expect(finalLobby.lobbyPlayers.find((p) => p.id === aliceToken)).toBeDefined();
  }, 15000);
});

/**
 * Integration test: lobby spectate flow.
 *
 * Verifies that players waiting in the lobby can see that a match is in
 * progress (and whether it is single-player or multiplayer) and choose to
 * spectate it. Covers:
 *   1. lobbyState carries inProgressMatch during a running game.
 *   2. inProgressMatch is null in the LOBBY state.
 *   3. A lobby player can spectate the in-progress match (spectateGame).
 *   4. A spectator receives the ongoing gameState stream.
 *   5. A spectator can leave and return to the lobby.
 *
 * Test isolation: each test ends by closing clients. A dangling in-progress
 * match keeps the server in IN_PROGRESS, so single-player tests use leaveGame
 * to return the server to LOBBY before closing.
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

/** Drain all pending messages so waitFor sees a clean slate. */
function drain(ctx, duration = 150) {
  return new Promise((r) => setTimeout(r, duration));
}

/** Clear the message buffer so waitFor only matches FRESH messages. */
function clearBuffer(ctx) {
  ctx.buffer.length = 0;
}

/** Return the most recent message of a type from the buffer (without clearing). */
function lastOfType(ctx, type) {
  return ctx.buffer.filter((m) => m.type === type).pop();
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

describe('Lobby spectate flow', () => {
  test('lobbyState reports an in-progress single-player match with participants', async () => {
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

    // Alice starts single-player. Bob stays in the lobby.
    send(alice, { type: 'startSinglePlayer' });
    await waitFor(alice, 'playerAssigned', 3000);

    // Bob (still in lobby) should see an in-progress match in lobbyState.
    await drain(bob);
    const lobbyState = lastOfType(bob, 'lobbyState');
    expect(lobbyState).toBeDefined();
    expect(lobbyState.currentGameState).toBe('IN_PROGRESS');
    expect(lobbyState.inProgressMatch).toBeDefined();
    expect(lobbyState.inProgressMatch.isSinglePlayer).toBe(true);
    expect(lobbyState.inProgressMatch.playerCount).toBe(1);
    expect(lobbyState.inProgressMatch.players[0].name).toBe('Alice');

    // Clean up: Alice leaves her single-player game.
    clearBuffer(alice);
    send(alice, { type: 'leaveGame' });
    await waitFor(alice, 'returnToLobby', 3000);
  });

  test('lobbyState reports an in-progress multiplayer match', async () => {
    const alice = await connect();
    const bob = await connect();

    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    await drain(alice);
    await drain(bob);

    // Alice starts single-player; Bob waits in the lobby and then spectates.
    send(alice, { type: 'startSinglePlayer' });
    await waitFor(alice, 'playerAssigned', 3000);

    clearBuffer(bob);
    send(bob, { type: 'spectateGame' });

    // Bob should get a spectatorMode ack (voluntary, not eaten).
    const specMode = await waitFor(bob, 'spectatorMode', 3000);
    expect(specMode.voluntary).toBe(true);

    // And an immediate gameState snapshot of the match.
    const snap = await waitFor(bob, 'gameState', 3000);
    expect(snap.gameState.currentGameState).toBe('IN_PROGRESS');
    expect(snap.gameState.players.length).toBe(1);
    expect(snap.gameState.players[0].name).toBe('Alice');

    // Clean up: Alice leaves her single-player game.
    clearBuffer(alice);
    send(alice, { type: 'leaveGame' });
    await waitFor(alice, 'returnToLobby', 3000);
  });

  test('inProgressMatch is null when the server is in the LOBBY state', async () => {
    const alice = await connect();

    await waitFor(alice, 'welcome');
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    await drain(alice);

    const lobbyState = lastOfType(alice, 'lobbyState');
    expect(lobbyState).toBeDefined();
    expect(lobbyState.currentGameState).toBe('LOBBY');
    expect(lobbyState.inProgressMatch).toBeNull();
  });

  test('spectator receives the ongoing gameState stream and can leave', async () => {
    const alice = await connect();
    const bob = await connect();

    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    await drain(alice);
    await drain(bob);

    // Alice starts single-player.
    send(alice, { type: 'startSinglePlayer' });
    await waitFor(alice, 'playerAssigned', 3000);

    // Bob spectates.
    send(bob, { type: 'spectateGame' });
    await waitFor(bob, 'spectatorMode', 3000);
    await waitFor(bob, 'gameState', 3000);

    // Bob should keep receiving gameState broadcasts (the game loop ticks at
    // 60 FPS). Wait a bit and confirm more than one gameState arrived.
    const before = bob.buffer.filter((m) => m.type === 'gameState').length;
    await drain(bob, 250);
    const after = bob.buffer.filter((m) => m.type === 'gameState').length;
    expect(after).toBeGreaterThan(before);

    // Bob leaves spectating → returns to the lobby.
    clearBuffer(bob);
    send(bob, { type: 'leaveGame' });
    const returned = await waitFor(bob, 'returnToLobby', 3000);
    expect(returned.type).toBe('returnToLobby');
    const bobInLobby = returned.lobbyPlayers.find((p) => p.name === 'Bob');
    expect(bobInLobby).toBeDefined();

    // Clean up: Alice leaves her single-player game.
    clearBuffer(alice);
    send(alice, { type: 'leaveGame' });
    await waitFor(alice, 'returnToLobby', 3000);
  });

  test('spectateGame is rejected when no game is in progress', async () => {
    const alice = await connect();

    await waitFor(alice, 'welcome');
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    await drain(alice);

    // No game running — spectate should be rejected with an error.
    clearBuffer(alice);
    send(alice, { type: 'spectateGame' });
    const err = await waitFor(alice, 'error', 3000);
    expect(err.message).toMatch(/no game in progress/i);
  });
});

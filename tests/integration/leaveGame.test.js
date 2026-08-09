/**
 * Integration test: player leave-game flow.
 *
 * Verifies the return-to-lobby feature:
 *   1. An active player can leave a game in progress and return to the lobby.
 *   2. A player can leave (returning to lobby) while still active.
 *   3. When the last active player leaves, the match ends.
 *   4. The leaving player is re-added to the lobby with their name preserved.
 *   5. A leaving player can rejoin and start a new game (warm rejoin).
 *
 * NOTE: These tests use a real server bound to an OS-assigned port (port 0).
 * They exercise the actual WebSocket message flow including the 3s start
 * countdown and the 5s game-over → lobby reset delay, so timeouts are generous.
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

/**
 * Wait for a message of `type` that satisfies `pred`, scanning only messages
 * arriving AFTER this call (ignores the stale buffer).
 */
function waitForFresh(ctx, type, pred = () => true, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for fresh "${type}"`)),
      timeout
    );
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type && pred(msg)) {
        clearTimeout(timer);
        ctx.ws.off('message', handler);
        resolve(msg);
      }
    };
    ctx.ws.on('message', handler);
  });
}

/**
 * Wait until a lobbyState broadcast lists only ready players (and at least
 * one). The client must wait for this before startGame or the server rejects
 * the request with "Not all players are ready."
 */
function waitForAllReady(ctx, timeout = 5000) {
  const already = ctx.buffer.find(
    (m) =>
      m.type === 'lobbyState' &&
      m.lobbyPlayers.length > 0 &&
      m.lobbyPlayers.every((p) => p.ready)
  );
  if (already) return Promise.resolve(already);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for all ready')), timeout);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (
        msg.type === 'lobbyState' &&
        msg.lobbyPlayers.length > 0 &&
        msg.lobbyPlayers.every((p) => p.ready)
      ) {
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

describe('Player leave-game flow', () => {
  test('active player can leave mid-game and return to lobby', async () => {
    const alice = await connect();
    const bob = await connect();

    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    // Join the lobby (capture Alice's stable token for identity checks).
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    await waitFor(alice, 'lobbyState');
    await drain(alice);
    await drain(bob);

    // Both ready up, then start (3s countdown before the match begins).
    send(alice, { type: 'toggleReady' });
    send(bob, { type: 'toggleReady' });
    await waitForAllReady(alice);
    send(alice, { type: 'startGame' });
    const aliceAssigned = await waitFor(alice, 'playerAssigned', 8000);
    await waitFor(bob, 'playerAssigned', 8000);
    const aliceId = aliceAssigned.playerId;

    // Alice leaves the game.
    send(alice, { type: 'leaveGame' });

    // Alice must receive returnToLobby with her name in the lobby list.
    const returned = await waitFor(alice, 'returnToLobby');
    expect(returned.type).toBe('returnToLobby');
    expect(returned.lobbyPlayers).toBeDefined();
    const aliceInLobby = returned.lobbyPlayers.find((p) => p.id === aliceId);
    expect(aliceInLobby).toBeDefined();
    expect(aliceInLobby.name).toBe('Alice');

    // Alice's leave dropped the player count below 2 → endMatch (Bob wins).
    // Bob gets GAME_OVER then, after the 5s delay, the LOBBY reset.
    await waitFor(bob, 'gameState', 3000);
    const resetLobby = await waitFor(bob, 'lobbyState', 8000);
    expect(resetLobby.currentGameState).toBe('LOBBY');

    alice.ws.close();
    bob.ws.close();
  }, 25000);

  test('player can leave mid-game and return to lobby as a non-spectator', async () => {
    const alice = await connect();
    const bob = await connect();

    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    await waitFor(alice, 'lobbyState');
    await drain(alice);
    await drain(bob);

    // Ready up and start.
    send(alice, { type: 'toggleReady' });
    send(bob, { type: 'toggleReady' });
    await waitForAllReady(alice);
    send(alice, { type: 'startGame' });
    await waitFor(alice, 'playerAssigned', 8000);
    const bobAssigned = await waitFor(bob, 'playerAssigned', 8000);
    const bobId = bobAssigned.playerId;

    // Bob sends leaveGame while still an active player → removed from players[]
    // and returned to the lobby with his identity preserved.
    send(bob, { type: 'leaveGame' });

    const returned = await waitFor(bob, 'returnToLobby');
    expect(returned.type).toBe('returnToLobby');
    const bobInLobby = returned.lobbyPlayers.find((p) => p.id === bobId);
    expect(bobInLobby).toBeDefined();
    expect(bobInLobby.name).toBe('Bob');

    alice.ws.close();
    bob.ws.close();
  }, 25000);

  test('leaving player can rejoin and start a new game (warm rejoin)', async () => {
    const alice = await connect();
    const bob = await connect();

    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    send(alice, { type: 'joinLobby', name: 'Alice' });
    const aliceJoined = await waitFor(alice, 'lobbyJoined');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    const bobJoined = await waitFor(bob, 'lobbyJoined');
    await waitFor(alice, 'lobbyState');
    await drain(alice);
    await drain(bob);

    // Ready up and start.
    send(alice, { type: 'toggleReady' });
    send(bob, { type: 'toggleReady' });
    await waitForAllReady(alice);
    send(alice, { type: 'startGame' });
    await waitFor(alice, 'playerAssigned', 8000);
    await waitFor(bob, 'playerAssigned', 8000);

    // Alice leaves → endMatch (Bob = last man standing). The game runs its 5s
    // GAME_OVER celebration before resetting to LOBBY.
    send(alice, { type: 'leaveGame' });
    await waitFor(alice, 'returnToLobby');

    // Wait for the full game-over → LOBBY reset cycle.
    clearBuffer(alice);
    clearBuffer(bob);
    const resetLobby = await waitForFresh(
      alice,
      'lobbyState',
      (m) => m.currentGameState === 'LOBBY',
      8000
    );
    expect(resetLobby.currentGameState).toBe('LOBBY');

    // Bob also waits for the lobby reset (he won the previous match).
    const bobResetLobby = await waitForFresh(
      bob,
      'lobbyState',
      (m) => m.currentGameState === 'LOBBY',
      2000
    );
    expect(bobResetLobby.currentGameState).toBe('LOBBY');

    // Both players rejoin the lobby presenting their stable tokens (warm
    // rejoin, feature A). The rebuilt lobby preserves their identities.
    clearBuffer(alice);
    send(alice, { type: 'joinLobby', name: 'Alice', token: aliceJoined.token });
    send(bob, { type: 'joinLobby', name: 'Bob', token: bobJoined.token });
    // Wait until Alice sees a lobby with BOTH players before starting.
    const bothJoined = await waitForFresh(
      alice,
      'lobbyState',
      (m) => m.lobbyPlayers && m.lobbyPlayers.length >= 2,
      3000
    );
    expect(bothJoined.lobbyPlayers.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);

    // Ready up. After the warm rejoin, the winner (Bob) is placed first in
    // the rebuilt lobby and becomes the new host — so Bob must start.
    send(alice, { type: 'toggleReady' });
    send(bob, { type: 'toggleReady' });
    await waitForAllReady(alice);
    send(bob, { type: 'startGame' });
    const reassigned = await waitFor(alice, 'playerAssigned', 8000);
    expect(reassigned.playerId).toBeTruthy();

    // The new game is in progress.
    const gs = await waitFor(alice, 'gameState');
    expect(gs.gameState.currentGameState).toBe('IN_PROGRESS');

    alice.ws.close();
    bob.ws.close();
  }, 25000);
});

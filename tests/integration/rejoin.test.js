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

/**
 * End the current match cleanly and wait for the server to reset to LOBBY.
 * The player leaves the game (leaveGame ends the match immediately — no grace
 * period), which after the 5s game-over delay resets the lobby. Waiting for
 * the LOBBY broadcast guarantees the server is in a clean state before the
 * test closes its sockets, so no grace-period timer leaks into the next test.
 */
function endMatchAndResetToLobby(ctx) {
  send(ctx, { type: 'leaveGame' });
  // The leaver gets returnToLobby; the 5s reset lands as a LOBBY broadcast.
  return waitFor(ctx, 'lobbyState', 8000).then((m) =>
    m.currentGameState === 'LOBBY'
      ? m
      : new Promise((resolve) => {
          const timer = setTimeout(resolve, 6000);
          const handler = (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'lobbyState' && msg.currentGameState === 'LOBBY') {
              clearTimeout(timer);
              ctx.ws.off('message', handler);
              resolve(msg);
            }
          };
          ctx.ws.on('message', handler);
        })
  );
}

/**
 * Wait for a lobbyState broadcast where every listed player is ready.
 * The client sends toggleReady for each player individually, so the host must
 * wait for the server to confirm ALL are ready before starting — otherwise
 * the server rejects startGame with 'Not all players are ready.'
 */
function waitForAllReady(ctx, timeout = 5000) {
  const already = ctx.buffer.find(
    (m) => m.type === 'lobbyState' && m.lobbyPlayers.length > 0 && m.lobbyPlayers.every((p) => p.ready)
  );
  if (already) return Promise.resolve(already);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for all players ready')), timeout);
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

    // Both join the lobby. The server echoes a stable token via 'lobbyJoined'
    // which the client stores for future reconnects.
    send(alice, { type: 'joinLobby', name: 'Alice' });
    const aliceJoined = await waitFor(alice, 'lobbyJoined');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    await waitFor(alice, 'lobbyState');
    await waitFor(bob, 'lobbyState');

    // Both players must ready up before the host can start. Wait until the
    // server confirms BOTH are ready — otherwise startGame is rejected.
    send(alice, { type: 'toggleReady' });
    send(bob, { type: 'toggleReady' });
    await waitForAllReady(alice);

    // Alice (host) starts the game. This triggers a 3s countdown before the
    // match actually begins, so playerAssigned arrives after the countdown.
    send(alice, { type: 'startGame' });

    // Both must receive playerAssigned with distinct, non-empty IDs.
    // Timeout accounts for the 3s countdown.
    const aliceAssigned = await waitFor(alice, 'playerAssigned', 8000);
    const bobAssigned = await waitFor(bob, 'playerAssigned', 8000);
    expect(aliceAssigned.playerId).toBeTruthy();
    expect(bobAssigned.playerId).toBeTruthy();
    expect(aliceAssigned.playerId).not.toBe(bobAssigned.playerId);

    const aliceId = aliceAssigned.playerId;

    // Confirm the game is broadcasting state.
    await waitFor(alice, 'gameState');
    await new Promise((r) => setTimeout(r, 200));

    // End the match cleanly: Bob leaves the game (leaveGame ends the match
    // immediately — no grace period) and after the 5s game-over delay the
    // server resets to LOBBY. Waiting for this LOBBY broadcast guarantees the
    // server is in a clean state. This exercises warm rejoin (feature A): the
    // rebuilt lobby preserves Alice's stable token/ID.
    send(bob, { type: 'leaveGame' });
    await waitFor(bob, 'returnToLobby', 3000);
    const resetLobby = await waitFor(alice, 'lobbyState', 8000);
    expect(resetLobby.currentGameState).toBe('LOBBY');

    // Alice rejoins (presenting her token) and the rebuilt lobby should still
    // carry her stable ID. She readies up and starts a new game.
    send(alice, { type: 'joinLobby', name: 'Alice', token: aliceJoined.token });
    await waitFor(alice, 'lobbyState');
    send(alice, { type: 'toggleReady' });
    await waitFor(alice, 'lobbyState');
    send(alice, { type: 'startGame' });

    // Alice MUST get playerAssigned again with the same ID. Before the fix
    // the client nulled myPlayerId on spectator mode and never restored it,
    // so it could not send input in the new game.
    const aliceReassigned = await waitFor(alice, 'playerAssigned', 8000);
    expect(aliceReassigned.playerId).toBe(aliceId);

    // Alice must appear in the new game's players list.
    const gs = await waitFor(alice, 'gameState');
    expect(gs.gameState.currentGameState).toBe('IN_PROGRESS');
    const alicePlayer = gs.gameState.players.find((p) => p.id === aliceId);
    expect(alicePlayer).toBeDefined();

    // Clean up: leave the game and wait for the LOBBY reset so we don't leak
    // a grace period into the next test.
    await endMatchAndResetToLobby(alice);
    alice.ws.close();
    bob.ws.close();
  }, 30000);

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

  test('disconnected player can reconnect to the in-progress match within the grace period', async () => {
    const alice = await connect();
    const bob = await connect();

    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    const bobJoined = await waitFor(bob, 'lobbyJoined');
    await waitFor(alice, 'lobbyState');

    // Ready up and start.
    send(alice, { type: 'toggleReady' });
    send(bob, { type: 'toggleReady' });
    await waitForAllReady(alice);
    send(alice, { type: 'startGame' });
    await waitFor(alice, 'playerAssigned', 8000);
    const bobAssigned = await waitFor(bob, 'playerAssigned', 8000);
    const bobId = bobAssigned.playerId;

    // Bob disconnects mid-match. A 15s grace period starts — his slot is held.
    bob.ws.close();
    await new Promise((r) => setTimeout(r, 300));

    // Bob reconnects on a NEW socket, presenting his stored token. The server
    // should restore his slot (not create a new player) and resend state.
    const bob2 = await connect();
    await waitFor(bob2, 'welcome');
    send(bob2, { type: 'joinLobby', name: 'Bob', token: bobJoined.token });

    // The reconnecting client gets playerAssigned (same ID) + a gameState snapshot.
    const bob2Assigned = await waitFor(bob2, 'playerAssigned', 3000);
    expect(bob2Assigned.playerId).toBe(bobId);
    await waitFor(bob2, 'gameState', 3000);

    // Bob's restored player must be in the active players list (not a duplicate).
    const gs = await waitFor(bob2, 'gameState', 3000);
    const bobPlayers = gs.gameState.players.filter((p) => p.id === bobId);
    expect(bobPlayers).toHaveLength(1);

    // Clean up.
    await endMatchAndResetToLobby(alice);
    alice.ws.close();
    bob2.ws.close();
  }, 20000);
});

/**
 * Integration test: moderator role + leaderboard reset.
 *
 * Verifies the moderator role and its admin actions:
 *   1. The first player to join an empty lobby becomes the moderator.
 *   2. The moderator is identified in the lobbyState payload (moderatorId).
 *   3. When the moderator leaves, the role transfers to the next player.
 *   4. A moderator can reset the leaderboard via the `/resetleaderboard`
 *      chat command; a non-moderator issuing it is treated as normal chat.
 *   5. A moderator can reset via the explicit resetLeaderboard message; a
 *      non-moderator is rejected with an error.
 *   6. A reset clears the board and announces it in chat.
 *
 * Uses a real server on an OS-assigned port. The leaderboard file is pointed
 * at a temp path so the repo's data/ dir is not polluted.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const TMP_LEADERBOARD = path.join(os.tmpdir(), `pacclone-mod-${process.pid}.json`);
process.env.PACCLONE_LEADERBOARD_FILE = TMP_LEADERBOARD;

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

function drain(ctx, duration = 150) {
  return new Promise((r) => setTimeout(r, duration));
}

function clearBuffer(ctx) {
  ctx.buffer.length = 0;
}

/** Most recent message of a type from the buffer. */
function lastOfType(ctx, type) {
  return ctx.buffer.filter((m) => m.type === type).pop();
}

beforeAll((done) => {
  try { fs.unlinkSync(TMP_LEADERBOARD); } catch { /* ignore */ }
  server.listen(0, () => {
    url = `ws://localhost:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  try { fs.unlinkSync(TMP_LEADERBOARD); } catch { /* ignore */ }
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

describe('Moderator role', () => {
  test('first player to join becomes the moderator', async () => {
    const alice = await connect();
    await waitFor(alice, 'welcome');
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    await drain(alice);

    const lobby = lastOfType(alice, 'lobbyState');
    expect(lobby).toBeDefined();
    expect(lobby.moderatorId).toBeDefined();
    // Alice is the only player, so she is the moderator.
    const aliceEntry = lobby.lobbyPlayers.find((p) => p.name === 'Alice');
    expect(lobby.moderatorId).toBe(aliceEntry.id);
  });

  test('moderator transfers to the next player when the moderator leaves', async () => {
    const alice = await connect();
    const bob = await connect();
    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    // Alice joins first -> moderator.
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    // Bob joins second.
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    await drain(alice);
    await drain(bob);

    let lobby = lastOfType(alice, 'lobbyState');
    const aliceId = lobby.lobbyPlayers.find((p) => p.name === 'Alice').id;
    const bobId = lobby.lobbyPlayers.find((p) => p.name === 'Bob').id;
    expect(lobby.moderatorId).toBe(aliceId);

    // Alice (moderator) disconnects. Bob should become moderator.
    clearBuffer(alice);
    clearBuffer(bob);
    alice.ws.close();
    await new Promise((r) => alice.ws.once('close', r));
    await drain(bob, 300);

    lobby = lastOfType(bob, 'lobbyState');
    expect(lobby).toBeDefined();
    // Only Bob remains.
    expect(lobby.lobbyPlayers).toHaveLength(1);
    expect(lobby.lobbyPlayers[0].name).toBe('Bob');
    expect(lobby.moderatorId).toBe(bobId);
  });

  test('non-moderator is not flagged as moderator', async () => {
    const alice = await connect();
    const bob = await connect();
    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    await drain(bob);

    const lobby = lastOfType(bob, 'lobbyState');
    const bobId = lobby.lobbyPlayers.find((p) => p.name === 'Bob').id;
    // Bob joined second, so he is NOT the moderator.
    expect(lobby.moderatorId).not.toBe(bobId);
  });
});

describe('Leaderboard reset', () => {
  // Wait until the lobby state reports LOBBY (i.e. the post-match 5s
  // GAME_OVER reset has completed). Scans the buffer first.
  async function waitForLobbyReady(ctx, timeout = 8000) {
    const found = ctx.buffer.find(
      (m) => m.type === 'lobbyState' && m.currentGameState === 'LOBBY',
    );
    if (found) return found;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for LOBBY state')),
        timeout,
      );
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'lobbyState' && msg.currentGameState === 'LOBBY') {
          clearTimeout(timer);
          ctx.ws.off('message', handler);
          resolve(msg);
        }
      };
      ctx.ws.on('message', handler);
    });
  }

  // Helper: seed the leaderboard by playing + finishing a single-player game,
  // so there is something to reset. Returns the client context, guaranteed to
  // be sitting in a LOBBY state (post-match reset completed).
  async function seedScore(name) {
    const ctx = await connect();
    await waitFor(ctx, 'welcome');
    send(ctx, { type: 'joinLobby', name });
    await waitFor(ctx, 'lobbyJoined');
    await waitFor(ctx, 'leaderboard');
    await drain(ctx);
    send(ctx, { type: 'startSinglePlayer' });
    await waitFor(ctx, 'playerAssigned', 3000);
    await waitFor(ctx, 'gameState', 3000);
    clearBuffer(ctx);
    send(ctx, { type: 'leaveGame' });
    await waitFor(ctx, 'returnToLobby', 3000);
    await waitFor(ctx, 'leaderboard', 3000);
    await drain(ctx, 300);
    // The match end triggers a 5s GAME_OVER -> LOBBY reset; wait it out so the
    // next player can join the lobby.
    await waitForLobbyReady(ctx, 8000);
    clearBuffer(ctx);
    return ctx;
  }

  test('moderator can reset via the /resetleaderboard chat command', async () => {
    // Alice (moderator) seeds a score, then resets via chat command.
    const alice = await seedScore('Alice');
    // Bob joins so we can observe the reset announcement + broadcast.
    const bob = await connect();
    await waitFor(bob, 'welcome');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    await drain(alice);
    await drain(bob);

    clearBuffer(alice);
    clearBuffer(bob);
    send(alice, { type: 'chat', text: '/resetleaderboard' });

    // Both clients should receive an empty leaderboard.
    const aliceLb = await waitFor(alice, 'leaderboard', 3000);
    expect(aliceLb.entries).toEqual([]);
    const bobLb = await waitFor(bob, 'leaderboard', 3000);
    expect(bobLb.entries).toEqual([]);

    // A system chat notice should announce the reset to everyone.
    const notice = await waitFor(bob, 'chatMessage', 3000);
    expect(notice.message.name).toBe('System');
    expect(notice.message.text).toContain('Alice');
    expect(notice.message.text).toContain('reset the leaderboard');

    // The command itself must NOT appear as a normal chat message.
    const cmdLeak = bob.buffer.filter(
      (m) => m.type === 'chatMessage' && m.message.text === '/resetleaderboard',
    );
    expect(cmdLeak).toHaveLength(0);

    fs.unlinkSync(TMP_LEADERBOARD);
  }, 20000);

  test('non-moderator /resetleaderboard is treated as plain chat', async () => {
    // Alice (moderator) seeds a score.
    await seedScore('Alice');
    // Bob joins (non-moderator).
    const bob = await connect();
    await waitFor(bob, 'welcome');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    await drain(bob);

    clearBuffer(bob);
    send(bob, { type: 'chat', text: '/resetleaderboard' });

    // Bob's message should pass through as normal chat (not a command), since
    // he is not the moderator. The server does not broadcast a leaderboard
    // reset, and no error is sent for an unknown-to-them command.
    const chat = await waitFor(bob, 'chatMessage', 3000);
    expect(chat.message.name).toBe('Bob');
    expect(chat.message.text).toBe('/resetleaderboard');

    // No leaderboard reset broadcast should have fired. Request the board
    // fresh to confirm it still holds Alice's seeded entry (no reset happened).
    clearBuffer(bob);
    send(bob, { type: 'getLeaderboard' });
    const lb = await waitFor(bob, 'leaderboard', 3000);
    expect(lb.entries.some((e) => e.name === 'Alice')).toBe(true);

    fs.unlinkSync(TMP_LEADERBOARD);
  }, 20000);

  test('moderator can reset via the resetLeaderboard message; non-mod is rejected', async () => {
    const alice = await seedScore('Alice');
    const bob = await connect();
    await waitFor(bob, 'welcome');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    await drain(alice);
    await drain(bob);

    // Bob (non-moderator) tries the explicit reset message -> error.
    clearBuffer(bob);
    send(bob, { type: 'resetLeaderboard' });
    const err = await waitFor(bob, 'error', 3000);
    expect(err.message).toContain('moderator');

    // Alice (moderator) resets via the explicit message.
    clearBuffer(alice);
    clearBuffer(bob);
    send(alice, { type: 'resetLeaderboard' });
    const lb = await waitFor(bob, 'leaderboard', 3000);
    expect(lb.entries).toEqual([]);

    fs.unlinkSync(TMP_LEADERBOARD);
  }, 20000);
});

/**
 * Integration test: server-side persistent leaderboard.
 *
 * Verifies the leaderboard that lives on the server:
 *   1. A fresh server starts with an empty board.
 *   2. getLeaderboard returns the current board.
 *   3. A new joiner receives the board on join.
 *   4. Scores recorded at game over are broadcast and persisted to disk.
 *
 * Uses a real server on an OS-assigned port. The leaderboard file is pointed
 * at a temp path (PACCLONE_LEADERBOARD_FILE) so the repo's data/ dir is not
 * polluted; it is removed in afterAll.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

// Point the leaderboard at a temp file BEFORE requiring server.js (the path
// is resolved at module load).
const TMP_LEADERBOARD = path.join(os.tmpdir(), `pacclone-lb-${process.pid}.json`);
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

beforeAll((done) => {
  // Ensure no stale temp file from a prior run.
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

describe('Server leaderboard', () => {
  test('fresh server starts with an empty leaderboard', async () => {
    const ctx = await connect();
    await waitFor(ctx, 'welcome');
    clearBuffer(ctx);
    send(ctx, { type: 'getLeaderboard' });
    const msg = await waitFor(ctx, 'leaderboard', 3000);
    expect(msg.entries).toBeDefined();
    expect(msg.entries).toEqual([]);
  });

  test('a new joiner receives the leaderboard on join', async () => {
    const ctx = await connect();
    await waitFor(ctx, 'welcome');
    send(ctx, { type: 'joinLobby', name: 'Alice' });
    await waitFor(ctx, 'lobbyJoined');
    const lb = await waitFor(ctx, 'leaderboard', 3000);
    expect(lb.entries).toBeDefined();
    expect(Array.isArray(lb.entries)).toBe(true);
  });

  test('playing and finishing a game records and persists the score', async () => {
    const ctx = await connect();
    await waitFor(ctx, 'welcome');
    send(ctx, { type: 'joinLobby', name: 'Alice' });
    await waitFor(ctx, 'lobbyJoined');
    await waitFor(ctx, 'leaderboard');
    await drain(ctx);

    // Start a single-player game.
    send(ctx, { type: 'startSinglePlayer' });
    await waitFor(ctx, 'playerAssigned', 3000);
    await waitFor(ctx, 'gameState', 3000);

    // Leave the game: handleLeaveGame triggers endMatch (players.length < 2),
    // which records the player's final score and broadcasts the board.
    clearBuffer(ctx);
    send(ctx, { type: 'leaveGame' });
    await waitFor(ctx, 'returnToLobby', 3000);

    // A leaderboard broadcast should follow with Alice's entry. The exact
    // score depends on pellets eaten; we only assert the entry is recorded.
    const lb = await waitFor(ctx, 'leaderboard', 3000);
    expect(lb.entries.length).toBeGreaterThanOrEqual(1);
    expect(lb.entries.some((e) => e.name === 'Alice')).toBe(true);

    // Give the async file write a moment, then assert it was persisted.
    await drain(ctx, 300);
    expect(fs.existsSync(TMP_LEADERBOARD)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(TMP_LEADERBOARD, 'utf8'));
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.some((e) => e.name === 'Alice')).toBe(true);

    // Clean up the file so the next test starts fresh.
    fs.unlinkSync(TMP_LEADERBOARD);
  }, 15000);
});

/**
 * Integration test: lobby chat.
 *
 * Verifies that players who have joined the lobby can exchange messages that
 * persist in server history and are delivered to all lobby members. Covers:
 *   1. A message sent by one player is received by another (real-time).
 *   2. History is delivered to a late joiner (getChatHistory on join).
 *   3. A player not in the lobby cannot chat (message is dropped).
 *   4. Empty / whitespace messages are ignored.
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

function drain(ctx, duration = 150) {
  return new Promise((r) => setTimeout(r, duration));
}

/** Return the most recent message of a type from the buffer without clearing. */
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

describe('Lobby chat', () => {
  test('a message sent by one player is received by another', async () => {
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

    // Alice chats. Both clients should receive the broadcast.
    clearBuffer(alice);
    clearBuffer(bob);
    send(alice, { type: 'chat', text: 'hello bob' });

    const aliceMsg = await waitFor(alice, 'chatMessage', 3000);
    expect(aliceMsg.message.name).toBe('Alice');
    expect(aliceMsg.message.text).toBe('hello bob');

    const bobMsg = await waitFor(bob, 'chatMessage', 3000);
    expect(bobMsg.message.name).toBe('Alice');
    expect(bobMsg.message.text).toBe('hello bob');
  });

  test('a late joiner receives chat history on join', async () => {
    const alice = await connect();
    const bob = await connect();

    await waitFor(alice, 'welcome');
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    await drain(alice);

    // Alice sends a message while she's alone in the lobby.
    send(alice, { type: 'chat', text: 'first message' });
    await waitFor(alice, 'chatMessage', 3000);

    // Bob joins late. The client requests history on join (getChatHistory);
    // here we simulate that to assert the server returns the persisted log.
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    clearBuffer(bob);
    send(bob, { type: 'getChatHistory' });

    const history = await waitFor(bob, 'chatHistory', 3000);
    expect(history.messages).toBeDefined();
    const texts = history.messages.map((m) => m.text);
    expect(texts).toContain('first message');
  });

  test('a player not in the lobby cannot chat', async () => {
    const alice = await connect();
    const bob = await connect();

    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    // Only Alice joins. Bob stays unconnected to the lobby.
    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    await drain(alice);

    // Bob (not in lobby) tries to chat — server must drop it.
    clearBuffer(alice);
    send(bob, { type: 'chat', text: 'sneaky' });

    // Alice should NOT receive it. Give it a moment to (not) arrive.
    await drain(alice, 300);
    const leaked = lastOfType(alice, 'chatMessage');
    expect(leaked).toBeUndefined();
  });

  test('empty and whitespace-only messages are ignored', async () => {
    const alice = await connect();
    const bob = await connect();

    await waitFor(alice, 'welcome');
    await waitFor(bob, 'welcome');

    send(alice, { type: 'joinLobby', name: 'Alice' });
    await waitFor(alice, 'lobbyJoined');
    send(bob, { type: 'joinLobby', name: 'Bob' });
    await waitFor(bob, 'lobbyJoined');
    await drain(alice);

    clearBuffer(alice);
    send(alice, { type: 'chat', text: '' });
    send(alice, { type: 'chat', text: '   ' });
    await drain(alice, 300);

    const leaked = lastOfType(alice, 'chatMessage');
    expect(leaked).toBeUndefined();
  });
});

/** Clear the message buffer so waitFor only matches FRESH messages. */
function clearBuffer(ctx) {
  ctx.buffer.length = 0;
}

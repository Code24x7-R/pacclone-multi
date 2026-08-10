/**
 * Integration test: server reports its git commit in the welcome message.
 *
 * The server resolves the current git commit hash at startup (via
 * `git rev-parse --short HEAD`) and includes it as `commit` in the `welcome`
 * message sent to every connecting client. The client renders it in the
 * About dialog. This test verifies the server side end-to-end.
 */
const WebSocket = require('ws');
const { execSync } = require('child_process');

const { server } = require('../../server.js');

let url = '';

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
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
  // No persistent clients to close between tests in this suite.
  setTimeout(done, 50);
});

describe('Server commit in welcome message', () => {
  test('welcome message includes a commit field', async () => {
    const ctx = await connect();
    const welcome = await waitFor(ctx, 'welcome', 3000);
    expect(welcome.commit).toBeDefined();
    expect(typeof welcome.commit).toBe('string');
    expect(welcome.commit.length).toBeGreaterThan(0);
    ctx.ws.close();
  });

  test('commit matches the current git HEAD', async () => {
    const ctx = await connect();
    const welcome = await waitFor(ctx, 'welcome', 3000);
    let expected;
    try {
      expected = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch (e) {
      // If git is somehow unavailable, the server falls back to 'unknown'.
      expected = 'unknown';
    }
    expect(welcome.commit).toBe(expected);
    ctx.ws.close();
  });
});

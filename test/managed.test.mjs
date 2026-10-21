import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../src/server.mjs';

test('managed terminal authenticates HTTP and WebSocket with the extension token', async t => {
  const token = 'managed-token-'.repeat(4);
  const server = createApp({ token, managedToken: token, cwd: '/tmp' });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => { server.shutdownTerminals(); server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const auth = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
  for (const path of ['/', '/ui', '/health', '/api/info']) assert.equal((await fetch(origin + path)).status, 401);
  const ui = await (await fetch(origin + '/ui', { headers: auth })).text();
  let destination;
  vm.runInNewContext(ui.match(/<script>(.*?)<\/script>/s)[1], {URL, location: {href: 'https://host.test/api/extensions/xangi-terminal/ui', replace: value => {destination = new URL(value, 'https://host.test/api/extensions/xangi-terminal/service/').href;}}});
  assert.equal(destination, 'https://host.test/api/extensions/xangi-terminal/service/');
  assert.match(ui, /new URL\("\.\/service\/", location.href\)/); assert.ok(!ui.includes(token));
  const html = await (await fetch(origin + '/', { headers: auth })).text();
  assert.match(html, /src="\.\/app.js"/);
  const login = await fetch(origin + '/api/login', { method: 'POST', headers: auth, body: '{}' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const refused = new WebSocket(origin.replace('http:', 'ws:') + '/api/terminal', { origin, headers: { cookie } });
  assert.match((await new Promise(done => refused.once('error', done))).message, /403/);
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/terminal', { origin, headers: { cookie, authorization: auth.authorization } });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  const output = new Promise((done, reject) => {
    const timer = setTimeout(() => reject(Error('PTY echo timed out')), 5000);
    ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'data' && m.data.includes('SHARED_PORT_OK')) { clearTimeout(timer); done(); } });
  });
  ws.send(JSON.stringify({ type: 'input', data: "printf 'SHARED_PORT_OK\\n'\r" }));
  await output; ws.close(); await once(ws, 'close');
});

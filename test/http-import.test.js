'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { createServer, loadService } = require('../src/server');
const { importFile } = require('../scripts/import');
const { scanEntries } = require('../scripts/scan-staged');
const { harness, organizer, asOf } = require('./helpers');
async function listen(t, service) {
  const server = createServer(service); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return server.address().port;
}
function request(port, route, input, { raw, split = false, method = 'POST' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers: { 'Content-Type': 'application/json' } }, res => {
      const chunks = []; res.on('data', d => chunks.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (method === 'GET') { req.end(); return; }
    const bytes = Buffer.from(raw === undefined ? JSON.stringify(input) : raw);
    if (split) { for (const byte of bytes) req.write(Buffer.from([byte])); req.end(); } else req.end(bytes);
  });
}
test('HTTP JSON and SSE use the actual service; fragmented Chinese requests work', async t => {
  const calls = [], { service } = harness(t, { provider: organizer(calls) }); const port = await listen(t, service);
  const json = await request(port, '/ask', { question: '番茄多少钱及怎么保存', asOf }, { split: true });
  assert.equal(json.status, 200); assert.equal(JSON.parse(json.text).mode, 'model-organized');
  const stream = await request(port, '/ask/stream', { question: '番茄多少钱及怎么保存', asOf });
  assert.match(stream.headers['content-type'], /text\/event-stream/);
  assert.match(stream.text, /event: meta/); assert.match(stream.text, /event: progress/); assert.match(stream.text, /event: answer/); assert.match(stream.text, /event: done/);
  assert.match(stream.text, /12\.00/); assert.equal(calls.length, 2);
});
test('HTTP validates malformed, oversized and invalid-date requests', async t => {
  const port = await listen(t, harness(t).service);
  assert.equal((await request(port, '/ask', {}, { raw: '{bad' })).status, 400);
  assert.equal((await request(port, '/ask', { question: '番茄', asOf: 'bad' })).status, 400);
  assert.equal((await request(port, '/ask', {}, { raw: 'x'.repeat(9000) })).status, 413);
  assert.equal((await request(port, '/absent', {})).status, 404);
});
test('HTTP disconnect aborts an in-flight provider', async t => {
  let resolveAbort;
  const aborted = new Promise(resolve => resolveAbort = resolve);
  const { service } = harness(t, { provider: { streamChat: async (_, { signal }) => {
    return new Promise((_, reject) => signal.addEventListener('abort', () => { resolveAbort(signal.reason); reject(Error('abort')); }, { once: true }));
  } } });
  const port = await listen(t, service);
  const req = http.request({ hostname: '127.0.0.1', port, path: '/ask/stream', method: 'POST' }, res => res.once('data', () => { res.destroy(); req.destroy(); }));
  req.on('error', () => {}); req.end(JSON.stringify({ question: '番茄保存', asOf }));
  assert.equal(await aborted, 'cancelled');
});
test('imports persist SQLite and knowledge; duplicate import leaves existing data intact', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agriculture-cli-'));
  let service;
  t.after(() => { service?.catalog.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const cat = path.join(__dirname, 'fixtures', 'catalog.json'), kb = path.join(__dirname, 'fixtures', 'knowledge.json');
  importFile('catalog', cat, dir); importFile('knowledge', kb, dir);
  assert.throws(() => importFile('catalog', cat, dir)); assert.throws(() => importFile('knowledge', kb, dir));
  service = loadService({ DATA_DIR: dir });
  assert.equal(service.catalog.lookup(service.catalog.identify('番茄')[0], asOf).version, 'v2');
  assert.equal(service.knowledge.cards.length, 7);
});
test('real CLI import commands run offline', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agriculture-cli-command-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const kind of ['catalog', 'knowledge']) {
    const output = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'import.js'), kind, path.join(__dirname, 'fixtures', kind + '.json')], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
    assert.match(output, /Import complete/);
  }
});
test('real server entrypoint starts with empty directories and no model config', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agriculture-start-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Entry point chooses a port; use health through exported server for API checks,
  // and this child verifies actual process startup and signal shutdown.
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env: { ...process.env, DATA_DIR: dir, PORT: '0', MODEL_API_KEY: '', MODEL_BASE_URL: '', MODEL_NAME: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const ready = await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw Error('Startup exited'); })]);
  assert.match(ready[0].toString(), /API ready/);
  assert.ok(fs.existsSync(path.join(dir, 'catalog.sqlite')));
  child.kill(); await once(child, 'exit');
});
test('empty-data HTTP health and explicit insufficiency', async t => {
  const port = await listen(t, harness(t, { empty: true }).service);
  assert.equal((await request(port, '/health', {}, { method: 'GET' })).status, 200);
  const r = await request(port, '/ask', { question: '番茄多少钱及怎么保存', asOf });
  assert.equal(r.status, 200); assert.match(JSON.parse(r.text).answer, /资料不足/);
});
test('data and credential scanner catches fixtures without declaration and private paths', () => {
  assert.ok(scanEntries([{ filename: 'data/catalog/live.json', content: '{}' }]).length);
  assert.ok(scanEntries([{ filename: 'test/fixtures/bad.json', content: '{}' }]).length);
  assert.ok(scanEntries([{ filename: 'src/bad.js', content: ['C:', 'Users', 'person', 'private'].join('\\') }]).length);
  assert.ok(scanEntries([{ filename: '.env', content: 'fake' }]).length);
  assert.ok(scanEntries([{ filename: 'src/bad.js', content: 'sk-' + 'a'.repeat(30) }]).length);
  assert.deepEqual(scanEntries([{ filename: 'data/catalog/.gitkeep', content: '' }, { filename: '.env.example', content: 'MODEL_API_KEY=' }]), []);
});

'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Catalog } = require('../src/catalog');
const { Knowledge } = require('../src/knowledge');
const { ConsultationService } = require('../src/service');
const catalogFixture = require('./fixtures/catalog.json');
const knowledgeFixture = require('./fixtures/knowledge.json');
const asOf = '2030-06-01';
function harness(t, { provider = null, timeoutMs = 1000, empty = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agriculture-test-'));
  const catalog = new Catalog(path.join(dir, 'catalog.sqlite'));
  fs.mkdirSync(path.join(dir, 'knowledge'));
  if (!empty) { catalog.import(catalogFixture); fs.writeFileSync(path.join(dir, 'knowledge', 'fixture.json'), JSON.stringify(knowledgeFixture)); }
  const knowledge = new Knowledge(path.join(dir, 'knowledge'), catalog);
  const service = new ConsultationService({ catalog, knowledge, provider, timeoutMs });
  t.after(() => { catalog.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, catalog, knowledge, service };
}
function sse(tokens, { finish = true, split = false } = {}) {
  const encoded = new TextEncoder().encode(tokens.map(token => 'data: ' + JSON.stringify({ choices: [{ delta: { content: token } }] }) + '\r\n\r\n').join('') + (finish ? 'data: [DONE]\r\n\r\n' : ''));
  return { body: new ReadableStream({ start(c) { if (split) for (const byte of encoded) c.enqueue(new Uint8Array([byte])); else c.enqueue(encoded); c.close(); } }) };
}
function organizer(calls, transform = ids => ids.reverse()) {
  return { async streamChat(messages, opts) {
    calls.push({ messages, opts });
    const ids = [...messages[0].content.matchAll(/"id":"([a-zA-Z0-9_-]+)"/g)].map(m => m[1]);
    const value = JSON.stringify({ evidenceIds: transform(ids) });
    return sse([value.slice(0, 8), value.slice(8)], { split: true });
  } };
}
module.exports = { harness, sse, organizer, asOf, catalogFixture, knowledgeFixture };

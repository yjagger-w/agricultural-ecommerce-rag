'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Knowledge } = require('../src/knowledge');
const { harness, asOf, catalogFixture, knowledgeFixture } = require('./helpers');
test('aliases and longest-name isolation', t => {
  const { catalog } = harness(t);
  assert.equal(catalog.identify('西红柿多少钱')[0].id, 'tomato');
  assert.equal(catalog.identify('ＴＯＭＡＴＯ price')[0].id, 'tomato');
  assert.deepEqual(catalog.identify('tomatool price'), []);
  assert.deepEqual(catalog.identify('黄番茄退货').map(p => p.id), ['yellow-tomato']);
});
test('real SQLite schema, effective versions and exclusive end boundary', t => {
  const { catalog } = harness(t);
  const tables = catalog.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.deepEqual(tables.sort(), ['aliases', 'products', 'versions']);
  const p = catalog.identify('番茄')[0];
  assert.equal(catalog.lookup(p, '2030-05-31').priceMinor, 800);
  assert.equal(catalog.lookup(p, asOf).priceMinor, 1200);
  assert.equal(catalog.lookup(p, '2031-01-01').status, 'expired');
  assert.equal(catalog.lookup(p, '2029-01-01').status, 'missing');
});
test('import rejects overlapping intervals and rolls back the entire transaction', t => {
  const { catalog } = harness(t, { empty: true });
  const data = structuredClone(catalogFixture);
  data.versions[1].validFrom = '2030-05-01';
  assert.throws(() => catalog.import(data), /Overlapping/);
  assert.equal(catalog.db.prepare('SELECT count(*) n FROM products').get().n, 0);
});
test('duplicate cross-product aliases, invalid dates and dangling references are rejected', t => {
  for (const modify of [d => d.products[1].aliases.push('番茄'), d => d.versions[0].validFrom = '2030-02-30', d => d.versions[0].productId = 'absent']) {
    const { catalog } = harness(t, { empty: true }); const data = structuredClone(catalogFixture); modify(data); assert.throws(() => catalog.import(data));
  }
});
test('expired price is never returned as a current quote', async t => {
  const { service } = harness(t);
  const r = await service.answer('胡萝卜多少钱', { asOf });
  assert.match(r.answer, /已过期/); assert.doesNotMatch(r.answer, /9\.00|300g/);
  assert.equal(r.facts[0].priceMinor, undefined);
});
test('unavailable products cannot be promised for purchase', async t => {
  const r = await harness(t).service.answer('白菜多少钱，有货吗', { asOf });
  assert.match(r.answer, /不可售/); assert.doesNotMatch(r.answer, /15\.00/);
});
test('no knowledge evidence gives an explicit insufficiency response', async t => {
  const r = await harness(t).service.answer('胡萝卜怎么保存', { asOf });
  assert.match(r.answer, /资料不足/); assert.deepEqual(r.evidence[0].cards, []);
});
test('mixed questions merge catalog facts and separate knowledge sources', async t => {
  const r = await harness(t).service.answer('西红柿多少钱及怎么保存', { asOf });
  assert.equal(r.route, 'mixed'); assert.match(r.answer, /12\.00 CNY/); assert.match(r.answer, /fictional-storage-a/);
  assert.equal(r.facts[0].source.id, 'fictional-catalog-v2');
  assert.equal(r.metrics.retrievals, 1); assert.equal(r.metrics.providerCalls, 0);
});
test('confirmed, draft and expired policies are isolated by product', async t => {
  const { service } = harness(t);
  const a = await service.answer('番茄怎么退货', { asOf }); assert.match(a.answer, /测试条件 A/);
  const b = await service.answer('白菜怎么退货', { asOf }); assert.match(b.answer, /政策未确认/); assert.doesNotMatch(b.answer, /测试条件 A|fictional-policy-a/);
  const y = await service.answer('黄番茄怎么退货', { asOf }); assert.match(y.answer, /政策未确认/); assert.doesNotMatch(y.answer, /fictional-policy-a/);
  const expired = await service.answer('番茄配送政策', { asOf }); assert.deepEqual(expired.evidence[0].cards, []); assert.match(expired.answer, /政策未确认/);
});
test('multi-product clauses do not spread storage intent into another product policy', async t => {
  const r = await harness(t).service.answer('番茄多少钱及怎么保存，白菜退货政策', { asOf });
  assert.equal(r.route, 'mixed');
  assert.deepEqual(r.evidence.map(g => [g.productId, g.facet]), [['tomato', 'storage'], ['cabbage', 'return']]);
  assert.deepEqual(r.evidence[1].cards, []);
  assert.doesNotMatch(r.answer, /测试条件 A|测试容器 B/);
});
test('global FAQ cannot substitute for a named product policy or storage card', async t => {
  const { service } = harness(t);
  const global = await service.answer('蔬菜怎么保存', { asOf }); assert.match(global.answer, /fictional-global/);
  const named = await service.answer('胡萝卜怎么保存', { asOf }); assert.doesNotMatch(named.answer, /fictional-global/);
});
test('ambiguous multi-product mixed clause asks for clarification without leaking policies', async t => {
  const r = await harness(t).service.answer('番茄保存和白菜退货', { asOf });
  assert.match(r.answer, /对应关系不明确/); assert.doesNotMatch(r.answer, /测试条件|测试容器/);
  assert.equal(r.metrics.providerCalls, 0);
});
test('an unknown product in a later clause never inherits the known product evidence', async t => {
  let calls = 0;
  const { service } = harness(t, { provider: { streamChat() { calls++; throw Error('must not call'); } } });
  const r = await service.answer('番茄多少钱，菠菜冷藏', { asOf });
  assert.match(r.answer, /12\.00 CNY/); assert.match(r.answer, /商品未识别/);
  assert.deepEqual(r.evidence, []); assert.doesNotMatch(r.answer, /fictional-storage|测试容器/); assert.equal(calls, 0);
});
test('a subject-free single-product follow-up retains its scope', async t => {
  const { service } = harness(t);
  const r = await service.answer('番茄多少钱，怎么保存', { asOf });
  assert.equal(r.route, 'mixed'); assert.equal(r.evidence[0].productId, 'tomato'); assert.match(r.answer, /fictional-storage-a/);
});
test('a follow-up with several possible products asks for an explicit subject', async t => {
  const r = await harness(t).service.answer('番茄多少钱，白菜有货吗，怎么保存', { asOf });
  assert.match(r.answer, /归属不明确/); assert.deepEqual(r.evidence, []);
  assert.doesNotMatch(r.answer, /fictional-storage/);
});
test('empty and missing data directories start and answer without a model call', async t => {
  const { service, catalog, dir } = harness(t, { empty: true, provider: { streamChat() { throw Error('must not call'); } } });
  fs.rmdirSync(path.join(dir, 'knowledge'));
  service.knowledge = new Knowledge(path.join(dir, 'knowledge'), catalog);
  const r = await service.answer('番茄多少钱，怎么保存', { asOf });
  assert.match(r.answer, /资料不足/); assert.equal(r.metrics.providerCalls, 0);
});
test('invalid knowledge identity, dates and sensitive-looking text fail closed', t => {
  const { catalog, dir } = harness(t);
  const file = path.join(dir, 'knowledge', 'fixture.json');
  for (const change of [d => d.cards[0].productId = 'absent', d => d.cards[0].validTo = '2030-02-30', d => d.cards[0].content = 'Authorization: Bearer fake', d => d.cards.push(d.cards[0])]) {
    const data = structuredClone(knowledgeFixture); change(data); fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => new Knowledge(path.dirname(file), catalog));
  }
});

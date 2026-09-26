'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, sse, organizer, asOf } = require('./helpers');
const { parseStream } = require('../src/providers/sse');
const { createStreamingLLM } = require('../src/providers/compatible');

test('one retrieval and one provider request with structured evidence organization', async t => {
  const calls = [], events = [], { service, knowledge } = harness(t, { provider: organizer(calls) });
  let retrievals = 0; const retrieve = knowledge.retrieve.bind(knowledge);
  knowledge.retrieve = (...args) => { retrievals++; return retrieve(...args); };
  const q = '西红柿多少钱及怎么保存';
  const r = await service.answer(q, { asOf, onEvent: e => events.push(e) });
  assert.equal(r.mode, 'model-organized'); assert.equal(calls.length, 1); assert.equal(retrievals, 1);
  assert.deepEqual([r.metrics.retrievals, r.metrics.providerCalls], [1, 1]);
  assert.equal(calls[0].messages.length, 2);
  assert.equal(JSON.stringify(calls[0].messages).split(q).length - 1, 1);
  assert.doesNotMatch(calls[0].messages[0].content, /12\.00|500g|image_url/);
  assert.ok(r.answer.indexOf('测试标签 A') < r.answer.indexOf('测试容器 A'));
  assert.match(r.answer, /12\.00 CNY/);
  assert.ok(events.some(e => e.type === 'progress'));
  assert.equal(events.at(-1).type, 'done');
  assert.ok(events.filter(e => e.type === 'answer').length >= 3);
});
test('hallucinated price/spec, wrong-product ID and missing evidence IDs never become prose', async t => {
  for (const raw of [JSON.stringify({ answer: '价格999元，规格10kg' }), JSON.stringify({ evidenceIds: ['cabbage-return'] }), JSON.stringify({ evidenceIds: [] })]) {
    let calls = 0;
    const { service } = harness(t, { provider: { streamChat: async () => { calls++; return sse([raw]); } } });
    const r = await service.answer('番茄多少钱及怎么保存', { asOf });
    assert.equal(r.mode, 'fallback'); assert.equal(calls, 1);
    assert.match(r.answer, /12\.00/); assert.doesNotMatch(r.answer, /999|10kg|cabbage-return/);
  }
});
test('provider failure gives safe local fallback without retries or echoed credentials', async t => {
  let calls = 0;
  const { service } = harness(t, { provider: { streamChat: async () => { calls++; throw Error('Authorization: Bearer private-credential and customer text'); } } });
  const r = await service.answer('番茄保存', { asOf });
  assert.equal(calls, 1); assert.equal(r.mode, 'fallback'); assert.match(r.answer, /本地证据/);
  assert.doesNotMatch(JSON.stringify(r), /private-credential|customer text|Authorization/);
});
test('request timeout aborts the provider and falls back', async t => {
  let aborted = false, calls = 0;
  const { service } = harness(t, { timeoutMs: 20, provider: { streamChat: async (_, { signal }) => {
    calls++; return new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('abort')); }, { once: true }));
  } } });
  const r = await service.answer('番茄保存', { asOf });
  assert.equal(r.reason, 'timeout'); assert.equal(aborted, true); assert.equal(calls, 1); assert.match(r.answer, /超时/);
});
test('stream timeout cancels a blocked reader', async t => {
  let cancelled = false;
  const { service } = harness(t, { timeoutMs: 20, provider: { streamChat: async () => ({ body: new ReadableStream({ cancel() { cancelled = true; } }) }) } });
  const r = await service.answer('番茄保存', { asOf });
  assert.equal(r.reason, 'timeout'); assert.ok(cancelled);
});
test('explicit cancellation stops streaming and suppresses final answer events', async t => {
  const controller = new AbortController(), events = []; let started;
  const ready = new Promise(resolve => started = resolve);
  let cancelled = false;
  const { service } = harness(t, { provider: { streamChat: async () => { started(); return { body: new ReadableStream({ cancel() { cancelled = true; } }) }; } } });
  const promise = service.answer('番茄保存', { asOf, signal: controller.signal, onEvent: e => events.push(e) });
  await ready; await new Promise(resolve => setImmediate(resolve)); controller.abort();
  const r = await promise;
  assert.equal(r.mode, 'cancelled'); assert.ok(cancelled);
  assert.ok(events.every(e => !['answer', 'done'].includes(e.type)));
});
test('already-cancelled request makes zero provider calls', async t => {
  const controller = new AbortController(); controller.abort(); const calls = [];
  const r = await harness(t, { provider: organizer(calls) }).service.answer('番茄保存', { asOf, signal: controller.signal });
  assert.equal(r.mode, 'cancelled'); assert.equal(calls.length, 0);
});
test('no evidence and catalog-only requests skip model calls', async t => {
  const calls = [], { service } = harness(t, { provider: organizer(calls) });
  await service.answer('番茄多少钱', { asOf }); await service.answer('胡萝卜保存', { asOf });
  assert.equal(calls.length, 0);
});
test('SSE handles split UTF-8, CRLF and DONE and releases its reader', async () => {
  const body = sse(['农🌱', '业'], { split: true }).body;
  const tokens = []; for await (const token of parseStream(body)) tokens.push(token);
  assert.equal(tokens.join(''), '农🌱业'); assert.equal(body.locked, false);
});
test('SSE rejects malformed JSON, premature EOF, provider errors and truncation', async () => {
  for (const content of ['data: {bad}\n\n', 'data: {"error":{"message":"private"}}\n\n', 'data: {"choices":[{"finish_reason":"length"}]}\n\n']) {
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(content)); c.close(); } });
    await assert.rejects(async () => { for await (const token of parseStream(body)) void token; });
    assert.equal(body.locked, false);
  }
  await assert.rejects(async () => { for await (const token of parseStream(sse(['partial'], { finish: false }).body)) void token; }, { code: 'STREAM_PREMATURE_CLOSE' });
});
test('midstream transport failure discards model partial selection and uses local evidence', async t => {
  const { service } = harness(t, { provider: { streamChat: async () => ({ body: new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')); },
    pull(c) { c.error(Error('private body terminated')); },
  }) }) } });
  const r = await service.answer('番茄保存', { asOf }); assert.equal(r.mode, 'fallback'); assert.doesNotMatch(r.answer, /partial|private/);
});
test('real compatible adapter issues one POST, forwards abort, sanitizes HTTP failures', async () => {
  const calls = [], controller = new AbortController();
  const provider = createStreamingLLM({ baseURL: 'https://example.invalid/v1/', model: 'stub-model', apiKey: 'test-only', fetchImpl: async (url, opts) => {
    calls.push({ url, opts }); return { ok: false, status: 503, body: { cancel: async () => {} }, text() { throw Error('body must never be read'); } };
  } });
  await assert.rejects(provider.streamChat([{ role: 'user', content: 'test' }], { signal: controller.signal }), { code: 'HTTP_503' });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://example.invalid/v1/chat/completions');
  assert.equal(calls[0].opts.signal, controller.signal); assert.equal(JSON.parse(calls[0].opts.body).stream, true);
});
test('real adapter success travels through service and strict parser with fetch stub', async t => {
  let requests = 0;
  const provider = createStreamingLLM({ baseURL: 'https://example.invalid/v1', model: 'stub-model', apiKey: 'test-only', fetchImpl: async () => {
    requests++; return { ok: true, ...sse(['{"evidenceIds":["tomato-storage","tomato-storage-extra"]}']) };
  } });
  const r = await harness(t, { provider }).service.answer('番茄保存', { asOf });
  assert.equal(r.mode, 'model-organized'); assert.equal(requests, 1);
});

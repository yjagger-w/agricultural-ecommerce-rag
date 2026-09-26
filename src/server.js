'use strict';
const http = require('node:http');
const { StringDecoder } = require('node:string_decoder');
const path = require('node:path');
const { Catalog } = require('./catalog');
const { Knowledge } = require('./knowledge');
const { ConsultationService } = require('./service');
const { createStreamingLLM } = require('./providers/compatible');

function createServer(service) {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'ok', license: 'GPL-3.0-only', warranty: 'none' })); return;
    }
    if (req.method !== 'POST' || !['/ask', '/ask/stream'].includes(req.url)) { res.writeHead(404); res.end(); return; }
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort('cancelled'); });
    const stream = req.url === '/ask/stream';
    try {
      let body = '', bytes = 0;
      const decoder = new StringDecoder('utf8');
      for await (const part of req) {
        bytes += part.length;
        if (bytes > 8192) { res.writeHead(413); res.end(); return; }
        body += decoder.write(part);
      }
      body += decoder.end();
      const input = JSON.parse(body);
      if (!input || typeof input.question !== 'string' || !input.question.trim()) throw new Error('Invalid question');
      const onEvent = event => {
        if (res.destroyed) return;
        if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };
      const result = await service.answer(input.question, { asOf: input.asOf, signal: controller.signal, onEvent: stream ? onEvent : undefined });
      if (res.destroyed) return;
      if (!stream) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(result)); }
      else res.end();
    } catch {
      if (res.destroyed) return;
      if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid request or local data unavailable' })); }
      else res.end('event: error\ndata: {"error":"Request failed"}\n\n');
    }
  });
}
function loadService(env = process.env) {
  const root = path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data'));
  const catalog = new Catalog(path.join(root, 'catalog.sqlite'));
  try {
    const knowledge = new Knowledge(path.join(root, 'knowledge'), catalog);
    const config = [env.MODEL_API_KEY, env.MODEL_BASE_URL, env.MODEL_NAME];
    if (config.some(Boolean) && !config.every(Boolean)) throw new Error('Incomplete model configuration');
    const provider = config.every(Boolean) ? createStreamingLLM({ apiKey: env.MODEL_API_KEY, baseURL: env.MODEL_BASE_URL, model: env.MODEL_NAME, maxCompletionTokens: 2048 }) : null;
    return new ConsultationService({ catalog, knowledge, provider, timeoutMs: Number(env.MODEL_TIMEOUT_MS || 10000) });
  } catch (e) { catalog.close(); throw e; }
}
if (require.main === module) {
  try {
    const service = loadService();
    const server = createServer(service);
    server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('Agricultural consultation API ready; GPL-3.0-only, no warranty.'));
    const close = () => server.close(() => { service.catalog.close(); });
    process.on('SIGTERM', close); process.on('SIGINT', close);
  } catch { console.error('Startup failed: check local data and model configuration.'); process.exitCode = 1; }
}
module.exports = { createServer, loadService };

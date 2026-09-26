'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Catalog } = require('../src/catalog');
const { Knowledge } = require('../src/knowledge');
const { route } = require('../src/router');
const catalogFixture = require('../test/fixtures/catalog.json');
const knowledgeFixture = require('../test/fixtures/knowledge.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agriculture-benchmark-'));
const catalog = new Catalog(':memory:');
try {
  catalog.import(catalogFixture);
  const cards = Array.from({ length: 2000 }, (_, i) => ({ ...knowledgeFixture.cards[i % knowledgeFixture.cards.length], id: 'synthetic-' + i }));
  fs.writeFileSync(path.join(dir, 'synthetic.json'), JSON.stringify({ fictional: true, cards }));
  const loadStart = performance.now(); const knowledge = new Knowledge(dir, catalog); const loadMs = performance.now() - loadStart;
  const queries = ['西红柿多少钱及怎么保存', '番茄保存，白菜退货政策', '胡萝卜价格', '蔬菜保存'];
  const measure = i => {
    const start = performance.now(); const plan = route(queries[i % queries.length], catalog);
    plan.facts.filter(p => p.id).forEach(p => catalog.lookup(p, '2030-06-01'));
    const retrieval = knowledge.retrieve(plan.scopes, '2030-06-01');
    return { total: performance.now() - start, retrieval: retrieval.retrievalMs };
  };
  for (let i = 0; i < 100; i++) measure(i);
  const samples = Array.from({ length: 1000 }, (_, i) => measure(i));
  const stats = field => {
    const sorted = samples.map(s => s[field]).sort((a, b) => a - b);
    return { p50: sorted[Math.ceil(sorted.length * 0.50) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
  };
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), runtime: process.version, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length, memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(2),
    sqlite: catalog.db.prepare('select sqlite_version() version').get().version,
    cards: cards.length, products: catalogFixture.products.length, versions: catalogFixture.versions.length,
    warmup: 100, iterations: 1000, concurrency: 1, units: 'ms', coldLoadMs: loadMs,
    retrieval: stats('retrieval'), routeCatalogRetrieval: stats('total'),
    scope: 'Synthetic fictional data; warm in-memory lexical index and SQLite; excludes HTTP, cold database opening and provider network. No production latency SLA.' }, null, 2));
} finally { catalog.close(); fs.rmSync(dir, { recursive: true, force: true }); }

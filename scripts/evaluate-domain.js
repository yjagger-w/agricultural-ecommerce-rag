'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Catalog } = require('../src/catalog');
const { Knowledge } = require('../src/knowledge');
const { ConsultationService } = require('../src/service');

const root = path.join(__dirname, '..');
const catalogFixture = require('../test/fixtures/catalog.json');
const knowledgeFixture = require('../test/fixtures/knowledge.json');
const suite = require('../evaluation/cases.json');

function sameSet(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

async function evaluate() {
  if (!suite.fictional || !catalogFixture.fictional || !knowledgeFixture.fictional) throw new Error('Fictional fixture marker missing');
  const ids = suite.cases.map(c => c.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate evaluation case ID');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agriculture-evaluation-'));
  const catalog = new Catalog(path.join(directory, 'catalog.sqlite'));
  try {
    catalog.import(catalogFixture);
    const knowledgeDir = path.join(directory, 'knowledge');
    fs.mkdirSync(knowledgeDir);
    fs.writeFileSync(path.join(knowledgeDir, 'fictional.json'), JSON.stringify(knowledgeFixture));
    const service = new ConsultationService({ catalog, knowledge: new Knowledge(knowledgeDir, catalog) });
    const rows = [];
    for (const c of suite.cases) {
      const result = await service.answer(c.question, { asOf: c.asOf });
      const facts = Object.fromEntries(result.facts.filter(f => f.product.id).map(f => [f.product.id, f.status]));
      const sources = result.evidence.flatMap(g => g.cards.map(card => card.source.id));
      const expectedSources = c.sources || [];
      const checks = {
        route: result.route === c.route,
        facts: JSON.stringify(Object.entries(facts).sort()) === JSON.stringify(Object.entries(c.facts || {}).sort()),
        evidence: sameSet(sources, expectedSources),
        requiredText: (c.answerIncludes || []).every(s => result.answer.includes(s)),
        forbiddenText: (c.answerExcludes || []).every(s => !result.answer.includes(s)),
        noProvider: result.metrics.providerCalls === 0,
      };
      rows.push({ id: c.id, category: c.category, question: c.question, asOf: c.asOf,
        pass: Object.values(checks).every(Boolean), checks,
        expected: { route: c.route, facts: c.facts, sources: expectedSources },
        actual: { route: result.route, facts, sources, answer: result.answer } });
    }
    const categories = Object.fromEntries([...new Set(rows.map(r => r.category))].map(category => {
      const subset = rows.filter(r => r.category === category);
      return [category, { passed: subset.filter(r => r.pass).length, total: subset.length }];
    }));
    const report = { fixture: 'fictional', mode: 'local-deterministic', cases: rows.length,
      passed: rows.filter(r => r.pass).length, categories, results: rows };
    if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Domain evaluation: ${report.passed}/${report.cases} cases passed (fictional data; local mode)`);
      for (const [category, score] of Object.entries(categories)) console.log(`  ${category}: ${score.passed}/${score.total}`);
      for (const row of rows.filter(r => !r.pass)) {
        console.log(`FAIL ${row.id}: ${Object.entries(row.checks).filter(([, ok]) => !ok).map(([key]) => key).join(', ')}`);
        console.log(`  expected: ${JSON.stringify(row.expected)}`);
        console.log(`  actual:   ${JSON.stringify(row.actual)}`);
      }
    }
    if (process.argv.includes('--strict') && report.passed !== report.cases) process.exitCode = 1;
  } finally {
    catalog.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

evaluate().catch(error => { console.error(error); process.exitCode = 1; });

// SPDX-License-Identifier: GPL-3.0-only
// Portions of weighted lexical scoring and evidence budgets by Pickle Team;
// modified 2026-09-26 for product/facet isolation. See LICENSE.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { normalizeText, tokenize } = require('./text');
const v = require('./validation');

class Knowledge {
  constructor(directory, catalog) {
    this.cards = [];
    if (!fs.existsSync(directory)) return;
    const seen = new Set();
    for (const file of fs.readdirSync(directory).filter(n => n.endsWith('.json')).sort()) {
      if (fs.lstatSync(path.join(directory, file)).isSymbolicLink()) throw new Error('Knowledge symlinks forbidden');
      const data = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      if (!Array.isArray(data.cards)) throw new Error('Invalid knowledge document');
      for (const raw of data.cards) {
        const card = { id: v.id(raw.id), productId: raw.productId === null ? null : v.id(raw.productId),
          title: v.text(raw.title, 200), content: v.text(raw.content), source: v.source(raw.source),
          kind: raw.kind, facet: raw.facet, confirmed: raw.confirmed,
          validFrom: v.date(raw.validFrom), validTo: v.date(raw.validTo) };
        if (seen.has(card.id) || !['knowledge', 'policy'].includes(card.kind) || !['storage', 'general', 'policy', 'return', 'delivery'].includes(card.facet) ||
          (card.kind === 'policy') !== ['policy', 'return', 'delivery'].includes(card.facet) || typeof card.confirmed !== 'boolean' || card.validFrom >= card.validTo ||
          (card.productId !== null && !catalog.hasProduct(card.productId))) throw new Error('Invalid knowledge metadata');
        if (!Array.isArray(raw.keywords)) throw new Error('Keywords required');
        card.keywords = raw.keywords.map(k => v.text(k, 100)).join(' ');
        card.tokens = Object.fromEntries(['title', 'keywords', 'content'].map(field => [field, new Set(tokenize(card[field]))]));
        seen.add(card.id); this.cards.push(card);
      }
    }
  }
  // One call per request; all product/facet scopes are ranked in this call.
  retrieve(scopes, asOf) {
    const start = performance.now();
    const groups = scopes.map(scope => {
      const tokens = tokenize(scope.query), query = normalizeText(scope.query);
      const ranked = [];
      for (const card of this.cards) {
        // Exact scope equality deliberately excludes global policy inheritance.
        if (card.productId !== scope.productId || card.facet !== scope.facet || !card.confirmed || card.validFrom > asOf || card.validTo <= asOf) continue;
        let score = 0;
        for (const [field, weight] of Object.entries({ title: 12, keywords: 5, content: 0.5 })) {
          for (const token of tokens) if (card.tokens[field].has(token)) score += weight;
          if (query.length > 2 && normalizeText(card[field]).includes(query)) score += weight * 2;
        }
        if (score > 0 && tokens.some(t => card.tokens.title.has(t) || card.tokens.keywords.has(t))) ranked.push({ card, score });
      }
      ranked.sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
      let characters = 0;
      const cards = ranked.filter(item => {
        if (characters + item.card.content.length > 6000) return false;
        characters += item.card.content.length; return true;
      }).slice(0, 3).map(({ card }) => {
        const { tokens: unused, keywords: unusedKeywords, ...publicCard } = card;
        return publicCard;
      });
      return { ...scope, cards };
    });
    return { groups, retrievalMs: performance.now() - start };
  }
}
module.exports = { Knowledge };

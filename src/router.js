'use strict';
function route(question, catalog) {
  const clauses = question.split(/[，,。；;？?\n]+/).filter(s => s.trim());
  const all = catalog.identify(question), facts = new Map(), scopes = new Map(), clarifications = [];
  for (const clause of clauses) {
    const explicit = catalog.identify(clause);
    // Only unambiguous single-product questions may carry scope into a clause.
    const products = explicit.length ? explicit : all.length === 1 ? all : [];
    const catalogIntent = /价格|多少钱|规格|重量|可售|在售|有货|停售|price|cost|spec|available/i.test(clause);
    const facets = [];
    if (/保存|储存|冷藏|保鲜|storage|store/i.test(clause)) facets.push('storage');
    if (/退货|退款|退换|return/i.test(clause)) facets.push('return');
    if (/运费|配送|delivery/i.test(clause)) facets.push('delivery');
    if (/政策|policy/i.test(clause) && !facets.some(f => ['return', 'delivery'].includes(f))) facets.push('policy');
    if (!catalogIntent && !facets.length) facets.push('general');
    if (explicit.length > 1 && (facets.length + Number(catalogIntent)) > 1) {
      clarifications.push('多个商品与不同问题的对应关系不明确，请用逗号分别说明每个商品的问题。');
      continue;
    }
    if (catalogIntent) {
      if (!products.length) facts.set('unknown', { id: null, name: '未识别商品' });
      for (const p of products) facts.set(p.id, p);
    }
    for (const facet of facets) for (const p of products.length ? products : [{ id: null, name: '通用资料' }]) {
      const key = (p.id || 'global') + ':' + facet;
      const existing = scopes.get(key);
      scopes.set(key, { key, productId: p.id, productName: p.name, facet, query: existing ? existing.query + ' ' + clause : clause });
    }
  }
  return { products: all, facts: [...facts.values()], scopes: [...scopes.values()], clarifications,
    route: facts.size && scopes.size ? 'mixed' : facts.size ? 'catalog' : 'knowledge' };
}
module.exports = { route };

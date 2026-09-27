'use strict';
function isScopedFollowup(clause) {
  const text = clause.trim().replace(/\s+/g, ' ');
  // Only complete, subject-free question forms can inherit a named product.
  // Unknown subject words (e.g. a product absent from the catalog) fail closed.
  return /^(?:(?:请问|那|它|这个商品|该商品|这款商品)\s*)?(?:(?:怎么|如何|怎样)?(?:保存|储存|冷藏|保鲜)|(?:可以|能否|能|是否)?(?:退货|退款|退换)|有货|在售|停售|可售|价格|多少钱|什么规格|规格|重量|运费|配送|政策)(?:吗|呢|么|如何|怎样)?$/.test(text)
    || /^(?:and\s+)?(?:how (?:do i |to )?(?:store|return) (?:it|this product)|(?:is it )?available|what (?:is |about )?(?:the )?(?:price|cost|specifications|return policy|delivery policy))$/i.test(text);
}
function route(question, catalog) {
  const clauses = question.split(/[，,。；;？?\n]+/).filter(s => s.trim());
  const all = catalog.identify(question), facts = new Map(), scopes = new Map(), clarifications = [];
  for (const clause of clauses) {
    const explicit = catalog.identify(clause);
    if (!explicit.length && all.length && (all.length !== 1 || !isScopedFollowup(clause))) {
      clarifications.push('该分句的商品未识别或归属不明确，请明确每个商品名称后再咨询。');
      continue;
    }
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
      const scopedQuery = !explicit.length && p.id ? p.name + ' ' + clause : clause;
      scopes.set(key, { key, productId: p.id, productName: p.name, facet, query: existing ? existing.query + ' ' + scopedQuery : scopedQuery });
    }
  }
  return { products: all, facts: [...facts.values()], scopes: [...scopes.values()], clarifications,
    route: facts.size && scopes.size ? 'mixed' : facts.size ? 'catalog' : 'knowledge' };
}
module.exports = { route };

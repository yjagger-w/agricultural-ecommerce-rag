'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeText } = require('./text');
const v = require('./validation');

class Catalog {
  constructor(filename = ':memory:') {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS aliases(alias TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id));
      CREATE TABLE IF NOT EXISTS versions(
        product_id TEXT NOT NULL REFERENCES products(id), version TEXT NOT NULL,
        specification TEXT NOT NULL, price_minor INTEGER NOT NULL CHECK(price_minor>=0),
        currency TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT NOT NULL,
        saleable INTEGER NOT NULL CHECK(saleable IN (0,1)), source_id TEXT NOT NULL, source_title TEXT NOT NULL,
        CHECK(valid_from<valid_to), PRIMARY KEY(product_id,version));
      CREATE INDEX IF NOT EXISTS versions_effective ON versions(product_id,valid_from,valid_to);`);
  }
  import(data) {
    if (!data || !Array.isArray(data.products) || !Array.isArray(data.versions)) throw new Error('Invalid catalog');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const p of data.products) {
        const pid = v.id(p.id), name = v.text(p.name, 100);
        if (!Array.isArray(p.aliases)) throw new Error('Aliases required');
        this.db.prepare('INSERT INTO products VALUES (?,?)').run(pid, name);
        for (const alias of new Set([name, ...p.aliases.map(a => v.text(a, 100))].map(normalizeText))) {
          this.db.prepare('INSERT INTO aliases VALUES (?,?)').run(alias, pid);
        }
      }
      for (const r of data.versions) {
        const pid = v.id(r.productId), version = v.id(r.version), from = v.date(r.validFrom), to = v.date(r.validTo), src = v.source(r.source);
        if (from >= to || !Number.isSafeInteger(r.priceMinor) || r.priceMinor < 0 || !/^[A-Z]{3}$/.test(r.currency) || typeof r.saleable !== 'boolean') throw new Error('Invalid version');
        const overlap = this.db.prepare('SELECT 1 FROM versions WHERE product_id=? AND valid_from<? AND valid_to>?').get(pid, to, from);
        if (overlap) throw new Error('Overlapping effective dates');
        this.db.prepare('INSERT INTO versions VALUES (?,?,?,?,?,?,?,?,?,?)').run(pid, version, v.text(r.specification, 200), r.priceMinor, r.currency, from, to, Number(r.saleable), src.id, src.title);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  identify(query) {
    const q = normalizeText(query);
    const found = [];
    // Longest aliases take precedence: a short alias inside another product's
    // longer name must not attach that product's policies to the query.
    const occupied = [];
    for (const r of this.db.prepare('SELECT a.alias,p.id,p.name FROM aliases a JOIN products p ON p.id=a.product_id ORDER BY length(a.alias) DESC,a.alias').all()) {
      let start = q.indexOf(r.alias);
      while (start >= 0) {
        const end = start + r.alias.length;
        const boundary = !/[a-z0-9]/i.test(r.alias) || ((!start || !/[a-z0-9]/i.test(q[start - 1])) && (!q[end] || !/[a-z0-9]/i.test(q[end])));
        if (boundary && !occupied.some(([a, b]) => start < b && end > a)) {
          occupied.push([start, end]);
          if (!found.some(p => p.id === r.id)) found.push({ id: r.id, name: r.name });
        }
        start = q.indexOf(r.alias, start + 1);
      }
    }
    return found;
  }
  lookup(product, asOf) {
    v.date(asOf);
    const row = this.db.prepare(`SELECT * FROM versions WHERE product_id=? AND valid_from<=? AND valid_to>? ORDER BY valid_from DESC LIMIT 1`).get(product.id, asOf, asOf);
    if (!row) {
      const old = this.db.prepare('SELECT 1 FROM versions WHERE product_id=? AND valid_to<=? LIMIT 1').get(product.id, asOf);
      return { product, status: old ? 'expired' : 'missing', asOf };
    }
    return { product, status: row.saleable ? 'available' : 'unavailable', asOf,
      version: row.version, specification: row.specification, priceMinor: row.price_minor, currency: row.currency,
      validFrom: row.valid_from, validTo: row.valid_to,
      source: { id: row.source_id, title: row.source_title } };
  }
  hasProduct(pid) { return Boolean(this.db.prepare('SELECT 1 FROM products WHERE id=?').get(pid)); }
  close() { this.db.close(); }
}
module.exports = { Catalog };

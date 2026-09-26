'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Catalog } = require('../src/catalog');
const { Knowledge } = require('../src/knowledge');
function importFile(kind, filename, root = path.resolve(process.env.DATA_DIR || 'data')) {
  const raw = fs.readFileSync(filename, 'utf8');
  const data = JSON.parse(raw);
  const catalog = new Catalog(path.join(root, 'catalog.sqlite'));
  let temp;
  try {
    if (kind === 'catalog') catalog.import(data);
    else if (kind === 'knowledge') {
      temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agriculture-import-'));
      const folder = path.join(root, 'knowledge'); fs.mkdirSync(folder, { recursive: true });
      for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.json'))) fs.copyFileSync(path.join(folder, file), path.join(temp, file));
      const filename = 'import-' + require('node:crypto').createHash('sha256').update(raw).digest('hex').slice(0, 16) + '.json';
      if (fs.existsSync(path.join(folder, filename))) throw new Error('Knowledge file already imported');
      fs.writeFileSync(path.join(temp, filename), raw);
      new Knowledge(temp, catalog); // Validate whole prospective directory before writing.
      fs.writeFileSync(path.join(folder, filename), raw, { flag: 'wx' });
    } else throw new Error('Use catalog or knowledge');
  } finally { catalog.close(); if (temp) fs.rmSync(temp, { recursive: true, force: true }); }
}
if (require.main === module) {
  try { importFile(process.argv[2], process.argv[3]); console.log('Import complete: local data only.'); }
  catch { console.error('Import failed: invalid, duplicate or overlapping data. No input content logged.'); process.exitCode = 1; }
}
module.exports = { importFile };

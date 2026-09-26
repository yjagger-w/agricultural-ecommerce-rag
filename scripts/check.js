'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(?:js|cjs)$/.test(e.name) ? [path.join(dir, e.name)] : []); }
let checked = 0;
for (const folder of ['src', 'scripts', 'test']) for (const file of walk(path.join(root, folder))) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(path.relative(root, file), r.stderr); process.exit(1); }
  checked++;
}
console.log(`Syntax checked ${checked} JavaScript files.`);
